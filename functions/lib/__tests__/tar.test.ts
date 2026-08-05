import { describe, it, expect } from 'vitest';
import { readTar, TAR_BLOCK_SIZE, MAX_METADATA_ENTRY_BYTES, type TarEntry } from '../tar';
import {
  buildArchive,
  directoryEntry,
  END_OF_ARCHIVE,
  fileEntry,
  gnuLongNameEntry,
  paxPathEntry,
  streamOf,
  type ArchivePart,
} from './tar-fixtures';

/** Limits high enough that nothing in these fixtures can reach them. */
const NO_LIMITS = { maxBytes: 8 * 1024 * 1024, maxEntries: 1_000 };

const decoder = new TextDecoder();

/**
 * Read an archive, keeping every body the filter accepts.
 *
 * @param parts Archive fragments, concatenated in order
 * @param options Chunk size the stream is delivered in, body filter, limits
 */
async function read(
  parts: ArchivePart[],
  options: {
    chunkSize?: number;
    wantBody?: (entry: TarEntry) => boolean;
    limits?: { maxBytes: number; maxEntries: number };
  } = {}
) {
  const seen: Array<{ path: string; size: number; body: string | null }> = [];

  const result = await readTar(
    streamOf(buildArchive(parts), options.chunkSize),
    {
      wantBody: options.wantBody ?? (() => true),
      onFile(entry, body) {
        seen.push({
          path: entry.path,
          size: entry.size,
          body: body === null ? null : decoder.decode(body),
        });
      },
    },
    options.limits ?? NO_LIMITS
  );

  return { seen, result };
}

describe('Tar reader', () => {
  it('reads a regular file', async () => {
    const { seen, result } = await read([
      fileEntry('repo-main/src/index.ts', 'export const a = 1;\n'),
      END_OF_ARCHIVE,
    ]);

    expect(seen).toEqual([
      { path: 'repo-main/src/index.ts', size: 20, body: 'export const a = 1;\n' },
    ]);
    expect(result.entries).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('reads several files in order, padding each body to a whole block', async () => {
    // The bodies are deliberately not multiples of 512: a reader that forgets
    // the padding finds the next header one byte early and loses the archive.
    const { seen } = await read([
      fileEntry('repo-main/a.ts', 'a'),
      fileEntry('repo-main/b.ts', 'b'.repeat(513)),
      fileEntry('repo-main/c.ts', 'c'.repeat(1024)),
      END_OF_ARCHIVE,
    ]);

    expect(seen.map(file => file.path)).toEqual(['repo-main/a.ts', 'repo-main/b.ts', 'repo-main/c.ts']);
    expect(seen[1].body).toBe('b'.repeat(513));
    expect(seen[2].body).toBe('c'.repeat(1024));
  });

  it('applies a PAX extended header to the entry that follows it', async () => {
    const longPath = `repo-main/${'nested/'.repeat(20)}component.tsx`;
    expect(longPath.length).toBeGreaterThan(100);

    const { seen } = await read([
      paxPathEntry(longPath),
      // The regular header carries the truncated name PAX is there to replace.
      fileEntry(longPath.slice(0, 99), 'export default 1;\n'),
      END_OF_ARCHIVE,
    ]);

    expect(seen).toHaveLength(1);
    expect(seen[0].path).toBe(longPath);
  });

  it('does not carry a PAX path past the entry it describes', async () => {
    const longPath = `repo-main/${'deep/'.repeat(30)}first.ts`;

    const { seen } = await read([
      paxPathEntry(longPath),
      fileEntry('repo-main/truncated-name.ts', 'first'),
      fileEntry('repo-main/second.ts', 'second'),
      END_OF_ARCHIVE,
    ]);

    expect(seen.map(file => file.path)).toEqual([longPath, 'repo-main/second.ts']);
  });

  it('reads a PAX path containing multi-byte characters', async () => {
    // PAX record lengths count bytes. Walking the records over a decoded
    // string instead puts the scan out of step on any non-ASCII path.
    const longPath = `repo-main/${'경로/'.repeat(20)}지도.ts`;

    const { seen } = await read([
      paxPathEntry(longPath),
      fileEntry('repo-main/short.ts', 'x'),
      END_OF_ARCHIVE,
    ]);

    expect(seen[0].path).toBe(longPath);
  });

  it('applies a GNU long name to the entry that follows it', async () => {
    const longPath = `repo-main/${'gnu/'.repeat(30)}module.ts`;

    const { seen } = await read([
      gnuLongNameEntry(longPath),
      fileEntry('repo-main/truncated.ts', 'export const x = 1;'),
      END_OF_ARCHIVE,
    ]);

    expect(seen).toHaveLength(1);
    expect(seen[0].path).toBe(longPath);
  });

  it('ignores a metadata entry larger than the cap and keeps reading', async () => {
    const oversized = `repo-main/${'x'.repeat(MAX_METADATA_ENTRY_BYTES)}.ts`;

    const { seen } = await read([
      paxPathEntry(oversized),
      fileEntry('repo-main/fallback.ts', 'kept'),
      END_OF_ARCHIVE,
    ]);

    // The oversized header is skipped, so the entry keeps its own header name.
    expect(seen).toEqual([{ path: 'repo-main/fallback.ts', size: 4, body: 'kept' }]);
  });

  it('skips directory entries', async () => {
    const { seen, result } = await read([
      directoryEntry('repo-main/'),
      directoryEntry('repo-main/src/'),
      fileEntry('repo-main/src/index.ts', 'x'),
      END_OF_ARCHIVE,
    ]);

    expect(seen.map(file => file.path)).toEqual(['repo-main/src/index.ts']);
    expect(result.entries).toBe(1);
  });

  it('skips symlink entries', async () => {
    const { seen } = await read([
      fileEntry('repo-main/link.ts', '', '2'),
      fileEntry('repo-main/real.ts', 'real'),
      END_OF_ARCHIVE,
    ]);

    expect(seen.map(file => file.path)).toEqual(['repo-main/real.ts']);
  });

  it('reports a file whose body the caller refused, without losing the next entry', async () => {
    // This is how the size cap is enforced: the header gives the length before
    // the body arrives, so an oversized body is walked past rather than held.
    const { seen } = await read(
      [
        fileEntry('repo-main/huge.ts', 'h'.repeat(4096)),
        fileEntry('repo-main/small.ts', 'small'),
        END_OF_ARCHIVE,
      ],
      { wantBody: entry => entry.size <= 1024 }
    );

    expect(seen).toEqual([
      { path: 'repo-main/huge.ts', size: 4096, body: null },
      { path: 'repo-main/small.ts', size: 5, body: 'small' },
    ]);
  });

  it('treats a NUL typeflag as a regular file', async () => {
    const { seen } = await read([
      fileEntry('repo-main/historic.ts', 'old', '\0'),
      END_OF_ARCHIVE,
    ]);

    expect(seen.map(file => file.path)).toEqual(['repo-main/historic.ts']);
  });

  it('joins the ustar prefix field to the name', async () => {
    const prefix = 'repo-main/very/deeply/nested/directory';
    const { seen } = await read([
      fileEntry('module.ts', 'x', '0', { prefix }),
      END_OF_ARCHIVE,
    ]);

    expect(seen[0].path).toBe(`${prefix}/module.ts`);
  });

  it('reads a size written in GNU base 256', async () => {
    const { seen } = await read([
      fileEntry('repo-main/big-field.ts', 'body', '0', { base256Size: true }),
      END_OF_ARCHIVE,
    ]);

    expect(seen).toEqual([{ path: 'repo-main/big-field.ts', size: 4, body: 'body' }]);
  });

  it('stops at the end of archive marker and ignores trailing bytes', async () => {
    const { seen } = await read([
      fileEntry('repo-main/first.ts', 'first'),
      END_OF_ARCHIVE,
      // Some writers pad the archive well past the marker.
      fileEntry('repo-main/after-the-end.ts', 'never read'),
    ]);

    expect(seen.map(file => file.path)).toEqual(['repo-main/first.ts']);
  });

  it('does not end the archive on a single zero block', async () => {
    const parts: ArchivePart[] = [
      fileEntry('repo-main/first.ts', 'first'),
      new Uint8Array(TAR_BLOCK_SIZE),
      fileEntry('repo-main/second.ts', 'second'),
      END_OF_ARCHIVE,
    ];

    const { seen } = await read(parts);
    expect(seen.map(file => file.path)).toEqual(['repo-main/first.ts', 'repo-main/second.ts']);
  });

  it('survives chunk boundaries anywhere in the stream', async () => {
    const parts: ArchivePart[] = [
      paxPathEntry(`repo-main/${'nested/'.repeat(20)}deep.ts`),
      fileEntry('repo-main/truncated.ts', 'deep body'),
      fileEntry('repo-main/plain.ts', 'p'.repeat(700)),
      directoryEntry('repo-main/dir/'),
      fileEntry('repo-main/dir/last.ts', 'last'),
      END_OF_ARCHIVE,
    ];

    const expected = (await read(parts)).seen;

    // One byte at a time splits every header, every body and every PAX record.
    for (const chunkSize of [1, 7, 511, 512, 513, 1024]) {
      const { seen } = await read(parts, { chunkSize });
      expect(seen, `chunk size ${chunkSize}`).toEqual(expected);
    }
  });

  it('truncates on the entry limit rather than reading on', async () => {
    const parts: ArchivePart[] = [];
    for (let i = 0; i < 10; i += 1) {
      parts.push(fileEntry(`repo-main/file${i}.ts`, `body ${i}`));
    }
    parts.push(END_OF_ARCHIVE);

    const { seen, result } = await read(parts, { limits: { maxBytes: 1024 * 1024, maxEntries: 4 } });

    expect(seen).toHaveLength(4);
    expect(result.entries).toBe(4);
    expect(result.truncated).toBe(true);
  });

  it('truncates on the byte limit rather than reading on', async () => {
    const parts: ArchivePart[] = [];
    for (let i = 0; i < 40; i += 1) {
      parts.push(fileEntry(`repo-main/file${i}.ts`, 'x'.repeat(1000)));
    }
    parts.push(END_OF_ARCHIVE);

    const { seen, result } = await read(parts, {
      chunkSize: 1024,
      limits: { maxBytes: 8 * 1024, maxEntries: 1_000 },
    });

    expect(result.truncated).toBe(true);
    expect(result.bytesRead).toBeLessThanOrEqual(8 * 1024 + 1024);
    // Whatever it did read is still complete and usable.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.length).toBeLessThan(40);
    for (const file of seen) {
      expect(file.body).toBe('x'.repeat(1000));
    }
  });

  it('reports an archive that ends without a marker', async () => {
    const { seen, result } = await read([fileEntry('repo-main/only.ts', 'only')]);

    expect(seen.map(file => file.path)).toEqual(['repo-main/only.ts']);
    expect(result.truncated).toBe(false);
  });

  it('handles an empty archive', async () => {
    const { seen, result } = await read([END_OF_ARCHIVE]);

    expect(seen).toEqual([]);
    expect(result.entries).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('handles a zero length file', async () => {
    const { seen } = await read([
      fileEntry('repo-main/empty.ts', ''),
      fileEntry('repo-main/next.ts', 'next'),
      END_OF_ARCHIVE,
    ]);

    expect(seen).toEqual([
      { path: 'repo-main/empty.ts', size: 0, body: '' },
      { path: 'repo-main/next.ts', size: 4, body: 'next' },
    ]);
  });
});
