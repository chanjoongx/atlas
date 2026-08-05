/**
 * Streaming tar reader.
 *
 * Reads a tar archive out of a ReadableStream and hands each regular file to a
 * handler, without ever holding the whole archive. Written against the APIs
 * that exist in the Cloudflare Workers runtime: ReadableStream, TextDecoder and
 * typed arrays. No Node built-ins, no Buffer.
 *
 * The reader supports the header variants GitHub's archives actually use:
 * the historic 100 byte name field, the ustar prefix field, GNU long names
 * (typeflag `L`) and PAX extended headers (typeflag `x` or `g`), both of which
 * carry the path of the entry that follows them.
 */

/** Tar is a block format. Headers are one block; bodies are padded to a whole number of them. */
export const TAR_BLOCK_SIZE = 512;

/** Header field offsets and widths, from the ustar layout. */
const NAME_OFFSET = 0;
const NAME_LENGTH = 100;
const SIZE_OFFSET = 124;
const SIZE_LENGTH = 12;
const TYPEFLAG_OFFSET = 156;
const MAGIC_OFFSET = 257;
const MAGIC_LENGTH = 5;
const PREFIX_OFFSET = 345;
const PREFIX_LENGTH = 155;

/** Byte values the header parser tests for. */
const NUL = 0x00;
const SPACE = 0x20;
const NEWLINE = 0x0a;
const EQUALS = 0x3d;
const ASCII_ZERO = 0x30;

/** Typeflags this reader acts on. Everything else is skipped. */
const TYPE_REGULAR = '0';
const TYPE_GNU_LONG_NAME = 'L';
const TYPE_PAX_NEXT = 'x';
const TYPE_PAX_GLOBAL = 'g';

/**
 * The end of a tar archive is two consecutive blocks of zeroes.
 */
const END_OF_ARCHIVE_BLOCKS = 2;

/**
 * Largest metadata entry (GNU long name, PAX header) read into memory.
 *
 * These entries are a few hundred bytes in every real archive. The cap exists
 * so a hostile archive cannot declare a one gigabyte "long name" and make the
 * reader buffer it: past this size the entry is skipped and the following file
 * keeps whatever name its own header carries.
 */
export const MAX_METADATA_ENTRY_BYTES = 64 * 1024;

/**
 * One entry from the archive.
 */
export interface TarEntry {
  /** Path as the archive records it, with any long name already applied. */
  path: string;
  /** Body length in bytes, taken from the header. */
  size: number;
}

/**
 * Limits that stop a read before the archive ends.
 */
export interface TarLimits {
  /** Hard ceiling on bytes pulled from the stream. */
  maxBytes: number;
  /** Hard ceiling on regular file entries handed to the handler. */
  maxEntries: number;
}

/**
 * Caller side of a read. `wantBody` runs first, with the path and the byte
 * length already known, so the caller can refuse a body before it is buffered.
 */
export interface TarHandler {
  /** Return true to receive this entry's body in `onFile`. */
  wantBody(entry: TarEntry): boolean;
  /**
   * Called once per regular file entry. `body` is null unless `wantBody`
   * asked for it. The body may be a view into an internal buffer, so decode or
   * copy it before returning.
   */
  onFile(entry: TarEntry, body: Uint8Array | null): void;
}

/**
 * What a read did.
 */
export interface TarReadResult {
  /** Bytes pulled from the stream. */
  bytesRead: number;
  /** Regular file entries handed to the handler. */
  entries: number;
  /** True when a limit stopped the read before the archive ended. */
  truncated: boolean;
}

/** Reusable empty result for a zero length take. */
const EMPTY = new Uint8Array(0);

/**
 * A queue of the chunks that have arrived but not been consumed.
 *
 * The obvious implementation, one growing Uint8Array that every chunk is
 * copied into, is O(n^2): the 48 MB of a large repository would be copied
 * roughly a thousand times over. Here each byte is copied at most once, and
 * only when a read spans a chunk boundary, so the whole scan is linear.
 */
class ByteQueue {
  private chunks: Uint8Array[] = [];
  /** Bytes already consumed from the chunk at the front of the queue. */
  private head = 0;
  private available = 0;

  push(chunk: Uint8Array): void {
    if (chunk.length === 0) {
      return;
    }
    this.chunks.push(chunk);
    this.available += chunk.length;
  }

  get size(): number {
    return this.available;
  }

  /**
   * Take exactly `count` contiguous bytes, or null when fewer are buffered.
   *
   * The result can be a view into a queued chunk rather than a copy, so it is
   * only valid until the next push.
   */
  take(count: number): Uint8Array | null {
    if (count > this.available) {
      return null;
    }
    if (count === 0) {
      return EMPTY;
    }

    const front = this.chunks[0];
    if (front.length - this.head >= count) {
      const view = front.subarray(this.head, this.head + count);
      this.advance(count);
      return view;
    }

    const out = new Uint8Array(count);
    let filled = 0;
    while (filled < count) {
      const chunk = this.chunks[0];
      const step = Math.min(chunk.length - this.head, count - filled);
      out.set(chunk.subarray(this.head, this.head + step), filled);
      filled += step;
      this.advance(step);
    }
    return out;
  }

  /** Discard up to `count` bytes. Returns how many were actually discarded. */
  discard(count: number): number {
    const total = Math.min(count, this.available);
    let left = total;
    while (left > 0) {
      const chunk = this.chunks[0];
      const step = Math.min(chunk.length - this.head, left);
      left -= step;
      this.advance(step);
    }
    return total;
  }

  private advance(count: number): void {
    this.head += count;
    this.available -= count;
    if (this.head === this.chunks[0].length) {
      this.chunks.shift();
      this.head = 0;
    }
  }
}

/**
 * Read a tar archive from a stream.
 *
 * @param stream Decompressed tar bytes
 * @param handler Receives every regular file entry
 * @param limits Ceilings that stop the read early
 * @returns Byte and entry counts, and whether a limit cut the read short
 */
export async function readTar(
  stream: ReadableStream<Uint8Array>,
  handler: TarHandler,
  limits: TarLimits
): Promise<TarReadResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  let bytesRead = 0;
  let entries = 0;
  let truncated = false;
  let stop = false;

  // What the loop is waiting for. `collect` needs the whole body contiguously,
  // `skip` only needs to walk past it, which is what lets a 40 MB file inside
  // the archive cost nothing but a counter.
  let mode: 'header' | 'collect' | 'skip' = 'header';
  let pendingEntry: TarEntry = { path: '', size: 0 };
  let pendingKind: 'file' | 'gnu-long-name' | 'pax-header' = 'file';
  let pendingPadding = 0;
  let skipRemaining = 0;

  // A GNU long name or PAX header describes the entry that follows it.
  let overridePath: string | null = null;
  let zeroBlocks = 0;

  const queue = new ByteQueue();

  try {
    while (!stop) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      bytesRead += value.length;
      queue.push(value);

      if (bytesRead > limits.maxBytes) {
        // Drain what is already buffered, then stop: the bytes are paid for.
        truncated = true;
        stop = true;
      }

      // Consume every complete structure the buffer now holds.
      for (;;) {
        if (mode === 'skip') {
          skipRemaining -= queue.discard(skipRemaining);
          if (skipRemaining > 0) {
            break;
          }
          mode = 'header';
          continue;
        }

        if (mode === 'collect') {
          const body = queue.take(pendingEntry.size);
          if (body === null) {
            break;
          }

          if (pendingKind === 'file') {
            entries += 1;
            handler.onFile(pendingEntry, body);
          } else if (pendingKind === 'gnu-long-name') {
            overridePath = readGnuLongName(body, decoder);
          } else {
            overridePath = readPaxPath(body, decoder);
          }

          skipRemaining = pendingPadding;
          mode = 'skip';

          if (pendingKind === 'file' && entries >= limits.maxEntries) {
            truncated = true;
            stop = true;
            break;
          }
          continue;
        }

        const header = queue.take(TAR_BLOCK_SIZE);
        if (header === null) {
          break;
        }

        if (isZeroBlock(header)) {
          zeroBlocks += 1;
          if (zeroBlocks >= END_OF_ARCHIVE_BLOCKS) {
            stop = true;
            break;
          }
          continue;
        }
        zeroBlocks = 0;

        const size = parseNumericField(header.subarray(SIZE_OFFSET, SIZE_OFFSET + SIZE_LENGTH));
        const typeflag = readTypeflag(header);
        const padding = (TAR_BLOCK_SIZE - (size % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;

        if (typeflag === TYPE_GNU_LONG_NAME || typeflag === TYPE_PAX_NEXT || typeflag === TYPE_PAX_GLOBAL) {
          overridePath = null;
          if (size > MAX_METADATA_ENTRY_BYTES) {
            skipRemaining = size + padding;
            mode = 'skip';
            continue;
          }
          pendingEntry = { path: '', size };
          pendingKind = typeflag === TYPE_GNU_LONG_NAME ? 'gnu-long-name' : 'pax-header';
          pendingPadding = padding;
          mode = 'collect';
          continue;
        }

        const path = overridePath ?? readHeaderPath(header, decoder);
        overridePath = null;

        // A NUL typeflag is the historic spelling of a regular file. Anything
        // else (directory, symlink, device) has no content worth reading.
        if (typeflag !== TYPE_REGULAR) {
          skipRemaining = size + padding;
          mode = 'skip';
          continue;
        }

        const entry: TarEntry = { path, size };
        if (!handler.wantBody(entry)) {
          entries += 1;
          handler.onFile(entry, null);
          skipRemaining = size + padding;
          mode = 'skip';
          if (entries >= limits.maxEntries) {
            truncated = true;
            stop = true;
            break;
          }
          continue;
        }

        pendingEntry = entry;
        pendingKind = 'file';
        pendingPadding = padding;
        mode = 'collect';
      }
    }
  } finally {
    // Releases the connection when a limit stopped the read mid archive.
    await reader.cancel().catch(() => undefined);
  }

  return { bytesRead, entries, truncated };
}

/**
 * Check whether a header block is all zeroes, which marks the end of the archive
 */
function isZeroBlock(block: Uint8Array): boolean {
  for (let i = 0; i < block.length; i += 1) {
    if (block[i] !== NUL) {
      return false;
    }
  }
  return true;
}

/**
 * Read the typeflag, normalising the historic NUL spelling of a regular file
 */
function readTypeflag(header: Uint8Array): string {
  const raw = header[TYPEFLAG_OFFSET];
  return String.fromCharCode(raw === NUL ? ASCII_ZERO : raw);
}

/**
 * Read the path out of a header block, joining the ustar prefix field when the
 * archive uses it to hold the leading directories of a long path
 */
function readHeaderPath(header: Uint8Array, decoder: TextDecoder): string {
  const name = readCString(header.subarray(NAME_OFFSET, NAME_OFFSET + NAME_LENGTH), decoder);
  const magic = readCString(header.subarray(MAGIC_OFFSET, MAGIC_OFFSET + MAGIC_LENGTH), decoder);
  if (magic !== 'ustar') {
    return name;
  }

  const prefix = readCString(header.subarray(PREFIX_OFFSET, PREFIX_OFFSET + PREFIX_LENGTH), decoder);
  return prefix === '' ? name : `${prefix}/${name}`;
}

/**
 * Read a NUL terminated string out of a fixed width header field
 */
function readCString(field: Uint8Array, decoder: TextDecoder): string {
  let end = field.indexOf(NUL);
  if (end === -1) {
    end = field.length;
  }
  return decoder.decode(field.subarray(0, end));
}

/**
 * Read a tar numeric field.
 *
 * Normally an octal string padded with spaces or NULs. GNU writers switch to
 * base 256, flagged by the high bit of the first byte, for values that do not
 * fit the field; a size misread as zero there would make the reader treat file
 * content as headers and lose the rest of the archive.
 *
 * @param field Fixed width header field
 * @returns The value, or 0 when the field is unreadable
 */
function parseNumericField(field: Uint8Array): number {
  if (field.length === 0) {
    return 0;
  }

  if ((field[0] & 0x80) !== 0) {
    let value = field[0] & 0x7f;
    for (let i = 1; i < field.length; i += 1) {
      value = value * 256 + field[i];
    }
    return Number.isSafeInteger(value) ? value : 0;
  }

  let start = 0;
  while (start < field.length && (field[start] === SPACE || field[start] === NUL)) {
    start += 1;
  }

  let digits = '';
  for (let i = start; i < field.length; i += 1) {
    const byte = field[i];
    if (byte === SPACE || byte === NUL) {
      break;
    }
    digits += String.fromCharCode(byte);
  }

  const value = Number.parseInt(digits, 8);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * Read the path out of a GNU long name entry, whose body is the path itself
 *
 * @returns The path, or null when the entry is empty
 */
function readGnuLongName(body: Uint8Array, decoder: TextDecoder): string | null {
  const path = readCString(body, decoder);
  return path === '' ? null : path;
}

/**
 * Read the path a PAX extended header carries for the entry that follows it.
 *
 * A PAX header is a sequence of `"<length> <key>=<value>\n"` records where the
 * length counts the whole record in bytes, so the records are walked over the
 * bytes rather than over a decoded string: a path with multi-byte characters
 * would put a string scan out of step with the declared lengths.
 *
 * @returns The path, or null when no `path` record is present
 */
function readPaxPath(body: Uint8Array, decoder: TextDecoder): string | null {
  let offset = 0;
  while (offset < body.length) {
    let cursor = offset;
    while (cursor < body.length && body[cursor] !== SPACE) {
      cursor += 1;
    }
    if (cursor >= body.length) {
      return null;
    }

    const length = Number.parseInt(decoder.decode(body.subarray(offset, cursor)), 10);
    if (!Number.isSafeInteger(length) || length <= 0 || offset + length > body.length) {
      return null;
    }

    const recordEnd = offset + length;
    let equals = -1;
    for (let i = cursor + 1; i < recordEnd; i += 1) {
      if (body[i] === EQUALS) {
        equals = i;
        break;
      }
    }

    if (equals !== -1 && decoder.decode(body.subarray(cursor + 1, equals)) === 'path') {
      const valueEnd = body[recordEnd - 1] === NEWLINE ? recordEnd - 1 : recordEnd;
      const path = decoder.decode(body.subarray(equals + 1, valueEnd));
      return path === '' ? null : path;
    }

    offset = recordEnd;
  }

  return null;
}
