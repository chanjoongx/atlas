/**
 * Builders for synthetic tar archives, shared by the tar reader tests and the
 * ingester tests.
 *
 * Real archives are the wrong fixture for this: they need the network, they
 * change under you, and they cannot produce the cases that matter here, such as
 * a metadata entry above the size cap or an archive that ends without a marker.
 * These builders write the same bytes GNU tar does, checksum included, so the
 * reader is exercised against the format rather than against a stub.
 */

const BLOCK = 512;
const encoder = new TextEncoder();

/** Header field offsets, from the ustar layout. */
const NAME_OFFSET = 0;
const MODE_OFFSET = 100;
const UID_OFFSET = 108;
const GID_OFFSET = 116;
const SIZE_OFFSET = 124;
const MTIME_OFFSET = 136;
const CHECKSUM_OFFSET = 148;
const CHECKSUM_LENGTH = 8;
const TYPEFLAG_OFFSET = 156;
const MAGIC_OFFSET = 257;
const VERSION_OFFSET = 263;
const PREFIX_OFFSET = 345;

/** A fragment of an archive: one header block, one padded body, or a marker. */
export type ArchivePart = Uint8Array;

/** The two zero blocks that end an archive. */
export const END_OF_ARCHIVE: ArchivePart = new Uint8Array(BLOCK * 2);

/**
 * Write a string into a fixed width header field, NUL padded
 */
function writeText(block: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = encoder.encode(value);
  block.set(bytes.subarray(0, length), offset);
}

/**
 * Write a value as the octal digits, NUL terminated, that tar uses for numbers
 */
function writeOctal(block: Uint8Array, offset: number, length: number, value: number): void {
  const digits = value.toString(8).padStart(length - 1, '0');
  writeText(block, offset, length - 1, digits);
  block[offset + length - 1] = 0;
}

/**
 * Write a value in the GNU base 256 encoding, used when a number does not fit
 * the octal field
 */
function writeBase256(block: Uint8Array, offset: number, length: number, value: number): void {
  let remaining = value;
  for (let i = offset + length - 1; i >= offset; i -= 1) {
    block[i] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  block[offset] |= 0x80;
}

/**
 * Build one header block.
 *
 * @param path Entry name, as it goes in the 100 byte name field
 * @param size Body length in bytes
 * @param typeflag Single character type, `0` for a regular file
 * @param options ustar prefix, and whether to write the size in base 256
 */
export function headerBlock(
  path: string,
  size: number,
  typeflag: string,
  options: { prefix?: string; base256Size?: boolean } = {}
): Uint8Array {
  const block = new Uint8Array(BLOCK);

  writeText(block, NAME_OFFSET, 100, path);
  writeOctal(block, MODE_OFFSET, 8, 0o644);
  writeOctal(block, UID_OFFSET, 8, 0);
  writeOctal(block, GID_OFFSET, 8, 0);
  if (options.base256Size === true) {
    writeBase256(block, SIZE_OFFSET, 12, size);
  } else {
    writeOctal(block, SIZE_OFFSET, 12, size);
  }
  writeOctal(block, MTIME_OFFSET, 12, 0);
  block[TYPEFLAG_OFFSET] = typeflag.charCodeAt(0);
  writeText(block, MAGIC_OFFSET, 6, 'ustar');
  writeText(block, VERSION_OFFSET, 2, '00');
  if (options.prefix !== undefined) {
    writeText(block, PREFIX_OFFSET, 155, options.prefix);
  }

  // The checksum is computed with its own field read as spaces, then written
  // back as six octal digits, a NUL and a space.
  block.fill(0x20, CHECKSUM_OFFSET, CHECKSUM_OFFSET + CHECKSUM_LENGTH);
  let sum = 0;
  for (let i = 0; i < block.length; i += 1) {
    sum += block[i];
  }
  writeText(block, CHECKSUM_OFFSET, 6, sum.toString(8).padStart(6, '0'));
  block[CHECKSUM_OFFSET + 6] = 0;
  block[CHECKSUM_OFFSET + 7] = 0x20;

  return block;
}

/**
 * Build a body padded out to a whole number of blocks
 */
function bodyBlocks(bytes: Uint8Array): Uint8Array[] {
  if (bytes.length === 0) {
    return [];
  }
  const padded = new Uint8Array(Math.ceil(bytes.length / BLOCK) * BLOCK);
  padded.set(bytes);
  return [padded];
}

/**
 * Build a file entry: its header and its padded body
 *
 * @param path Entry name
 * @param body File contents
 * @param typeflag Single character type, `0` for a regular file
 * @param options ustar prefix, and whether to write the size in base 256
 */
export function fileEntry(
  path: string,
  body: string | Uint8Array,
  typeflag: string = '0',
  options: { prefix?: string; base256Size?: boolean } = {}
): ArchivePart {
  const bytes = typeof body === 'string' ? encoder.encode(body) : body;
  return concat([headerBlock(path, bytes.length, typeflag, options), ...bodyBlocks(bytes)]);
}

/**
 * Build a directory entry, which carries no body
 */
export function directoryEntry(path: string): ArchivePart {
  return headerBlock(path, 0, '5');
}

/**
 * Build a PAX extended header carrying a path for the entry that follows.
 *
 * A PAX record is `"<length> <key>=<value>\n"` where the length counts the
 * whole record including its own digits, so the length is solved for rather
 * than guessed.
 */
export function paxPathEntry(path: string): ArchivePart {
  const payload = ` path=${path}\n`;
  const payloadBytes = encoder.encode(payload).length;

  let length = payloadBytes + 1;
  for (;;) {
    const digits = String(length).length;
    if (digits + payloadBytes === length) {
      break;
    }
    length = digits + payloadBytes;
  }

  return fileEntry('PaxHeaders/entry', `${length}${payload}`, 'x');
}

/**
 * Build a GNU long name entry, whose body is the path for the entry that follows
 */
export function gnuLongNameEntry(path: string): ArchivePart {
  return fileEntry('././@LongLink', `${path}\0`, 'L');
}

/**
 * Concatenate archive fragments into one buffer
 */
export function buildArchive(parts: readonly ArchivePart[]): Uint8Array {
  return concat(parts);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) {
    total += part.length;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Deliver a buffer as a stream, optionally split into fixed size chunks so a
 * reader that assumes chunk boundaries line up with the format fails here
 * rather than in production.
 *
 * @param bytes Whole archive
 * @param chunkSize Bytes per chunk, or undefined for a single chunk
 */
export function streamOf(bytes: Uint8Array, chunkSize?: number): ReadableStream<Uint8Array> {
  const size = chunkSize ?? bytes.length;
  let offset = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + size, bytes.length);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  });
}

/**
 * Gzip a buffer, the way codeload serves it
 */
export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const compressor = new CompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>;
  const chunks: Uint8Array[] = [];
  const reader = streamOf(bytes).pipeThrough(compressor).getReader();

  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
  }

  return concat(chunks);
}
