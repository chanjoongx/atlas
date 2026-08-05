import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import {
  ingestRepo,
  CODELOAD_ORIGIN,
  DEFAULT_REF,
  MAX_ARCHIVE_ENTRIES,
  MAX_CONTENT_FILE_BYTES,
} from '../ingester';
import type { IngesterInput } from '../../types';
import {
  buildArchive,
  directoryEntry,
  END_OF_ARCHIVE,
  fileEntry,
  gzip,
  streamOf,
  type ArchivePart,
} from '../../__tests__/tar-fixtures';

/**
 * Bytes per chunk the mocked archive arrives in.
 *
 * codeload streams, so the fixture streams too, and at a size that puts chunk
 * boundaries in the middle of headers and bodies rather than neatly between
 * them.
 */
const RESPONSE_CHUNK_BYTES = 8_192 - 7;

/**
 * Answer the next fetch with a gzipped archive, the way codeload does.
 *
 * @param parts Archive fragments
 * @returns The mock, so a test can assert on the request it received
 */
async function serveArchive(parts: ArchivePart[]): Promise<Mock> {
  const body = await gzip(buildArchive(parts));
  const fetchMock = vi.fn(
    async () => new Response(streamOf(body, RESPONSE_CHUNK_BYTES), { status: 200 })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Answer the next fetch with an error status, the way codeload does. */
function serveStatus(status: number): Mock {
  const fetchMock = vi.fn(async () => new Response('Not Found', { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const SMALL_REPO: ArchivePart[] = [
  directoryEntry('testrepo-main/'),
  fileEntry('testrepo-main/README.md', '# Test\n'),
  fileEntry('testrepo-main/package.json', '{ "name": "testrepo" }'),
  fileEntry('testrepo-main/src/index.ts', "import { helper } from './utils';\n"),
  fileEntry('testrepo-main/src/utils.ts', 'export const helper = 1;\n'),
  END_OF_ARCHIVE,
];

const input: IngesterInput = { owner: 'testuser', repo: 'testrepo', branch: 'main' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Agent 1: Repo Ingester', () => {
  describe('Success Cases', () => {
    it('should ingest a repository from one archive download', async () => {
      const fetchMock = await serveArchive(SMALL_REPO);
      const result = await ingestRepo(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata.owner).toBe('testuser');
        expect(result.data.metadata.repo).toBe('testrepo');
        expect(result.data.metadata.branch).toBe('main');
        expect(result.data.metadata.truncated).toBe(false);
        expect(result.data.tree.map(node => node.path)).toEqual([
          'README.md',
          'package.json',
          'src/index.ts',
          'src/utils.ts',
        ]);
      }

      // The whole repository cost exactly one subrequest.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should carry the byte size of every file', async () => {
      await serveArchive(SMALL_REPO);
      const result = await ingestRepo(input);

      expect(result.success).toBe(true);
      if (result.success) {
        const readme = result.data.tree.find(node => node.path === 'README.md');
        expect(readme?.size).toBe(7);
        expect(readme?.type).toBe('file');
      }
    });

    it('should keep content for parseable sources and for config files', async () => {
      await serveArchive([
        fileEntry('testrepo-main/src/index.ts', 'export const a = 1;\n'),
        fileEntry('testrepo-main/tsconfig.json', '{ "compilerOptions": {} }'),
        fileEntry('testrepo-main/package.json', '{ "name": "x" }'),
        fileEntry('testrepo-main/README.md', '# nope\n'),
        fileEntry('testrepo-main/styles.css', 'body { color: red }'),
        END_OF_ARCHIVE,
      ]);

      const result = await ingestRepo(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect([...result.data.contents.keys()].sort()).toEqual([
          'package.json',
          'src/index.ts',
          'tsconfig.json',
        ]);
        expect(result.data.contents.get('src/index.ts')).toBe('export const a = 1;\n');
        // Everything is still on the map, content or not.
        expect(result.data.tree).toHaveLength(5);
      }
    });

    it('should decode multi-byte UTF-8 content', async () => {
      const source = '// 도시 지도 렌더러 ✨\nconst café = "naïve";\n';
      await serveArchive([
        fileEntry('testrepo-main/src/index.ts', source),
        END_OF_ARCHIVE,
      ]);

      const result = await ingestRepo(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.contents.get('src/index.ts')).toBe(source);
      }
    });

    it('should keep a file above the content size cap on the map without its body', async () => {
      const huge = 'x'.repeat(MAX_CONTENT_FILE_BYTES + 1);
      await serveArchive([
        fileEntry('testrepo-main/bundle.js', huge),
        fileEntry('testrepo-main/src/index.ts', 'export const a = 1;\n'),
        END_OF_ARCHIVE,
      ]);

      const result = await ingestRepo(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tree.map(node => node.path)).toContain('bundle.js');
        expect(result.data.contents.has('bundle.js')).toBe(false);
        // The oversized body was walked past, not lost track of.
        expect(result.data.contents.get('src/index.ts')).toBe('export const a = 1;\n');
      }
    });

    it('should filter out excluded directories', async () => {
      await serveArchive([
        fileEntry('testrepo-main/src/index.ts', 'x'),
        fileEntry('testrepo-main/node_modules/package/index.js', 'x'),
        fileEntry('testrepo-main/.git/config', 'x'),
        fileEntry('testrepo-main/dist/bundle.js', 'x'),
        fileEntry('testrepo-main/build/output.js', 'x'),
        fileEntry('testrepo-main/packages/a/node_modules/dep/index.js', 'x'),
        END_OF_ARCHIVE,
      ]);

      const result = await ingestRepo(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tree).toHaveLength(1);
        expect(result.data.tree[0].path).toBe('src/index.ts');
      }
    });

    it('should filter out binary files', async () => {
      await serveArchive([
        fileEntry('testrepo-main/src/index.ts', 'x'),
        fileEntry('testrepo-main/assets/logo.png', 'x'),
        fileEntry('testrepo-main/docs/guide.pdf', 'x'),
        fileEntry('testrepo-main/fonts/font.woff2', 'x'),
        fileEntry('testrepo-main/video.mp4', 'x'),
        END_OF_ARCHIVE,
      ]);

      const result = await ingestRepo(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tree).toHaveLength(1);
        expect(result.data.tree[0].path).toBe('src/index.ts');
      }
    });

    it('should filter out design documents whose line count is meaningless', async () => {
      await serveArchive([
        fileEntry('testrepo-main/src/index.ts', 'x'),
        fileEntry('testrepo-main/docs/images/logo.pxm', 'x'),
        fileEntry('testrepo-main/design/mock.psd', 'x'),
        fileEntry('testrepo-main/design/board.fig', 'x'),
        END_OF_ARCHIVE,
      ]);

      const result = await ingestRepo(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tree.map(file => file.path)).toEqual(['src/index.ts']);
      }
    });

    it('should filter out lockfiles, which are generated rather than written', async () => {
      await serveArchive([
        fileEntry('testrepo-main/src/index.ts', 'x'),
        fileEntry('testrepo-main/pnpm-lock.yaml', 'x'),
        fileEntry('testrepo-main/bun.lock', 'x'),
        fileEntry('testrepo-main/Cargo.lock', 'x'),
        fileEntry('testrepo-main/go.sum', 'x'),
        fileEntry('testrepo-main/packages/ui/yarn.lock', 'x'),
        END_OF_ARCHIVE,
      ]);

      const result = await ingestRepo(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tree.map(file => file.path)).toEqual(['src/index.ts']);
      }
    });

    it('should keep files that only look like lockfiles', async () => {
      await serveArchive([
        fileEntry('testrepo-main/src/lock.ts', 'x'),
        fileEntry('testrepo-main/src/yarn.lock.ts', 'x'),
        fileEntry('testrepo-main/src/parse-pnpm-lock.yaml.ts', 'x'),
        END_OF_ARCHIVE,
      ]);

      const result = await ingestRepo(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tree).toHaveLength(3);
      }
    });

    it('should handle a large repository', async () => {
      const parts: ArchivePart[] = [];
      for (let i = 0; i < 500; i += 1) {
        parts.push(fileEntry(`testrepo-main/src/file${i}.ts`, `export const v${i} = ${i};\n`));
      }
      parts.push(END_OF_ARCHIVE);

      await serveArchive(parts);
      const result = await ingestRepo(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tree).toHaveLength(500);
        expect(result.data.contents.size).toBe(500);
        expect(result.data.metadata.truncated).toBe(false);
      }
    });

    it('should handle an archive with no files', async () => {
      await serveArchive([END_OF_ARCHIVE]);
      const result = await ingestRepo(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tree).toHaveLength(0);
        expect(result.data.contents.size).toBe(0);
      }
    });
  });

  describe('Provenance', () => {
    it('should read the resolved ref from the archive root directory', async () => {
      await serveArchive(SMALL_REPO);
      const result = await ingestRepo(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata.resolvedRef).toBe('main');
        // A branch archive is named after the branch, so no commit is known.
        expect(result.data.metadata.commitSha).toBeUndefined();
      }
    });

    it('should record the commit when the request named one', async () => {
      const sha = '0123456789abcdef0123456789abcdef01234567';
      await serveArchive([
        fileEntry(`testrepo-${sha}/src/index.ts`, 'export const a = 1;\n'),
        END_OF_ARCHIVE,
      ]);

      const result = await ingestRepo({ owner: 'testuser', repo: 'testrepo', branch: sha });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata.commitSha).toBe(sha);
        expect(result.data.metadata.resolvedRef).toBe(sha);
        expect(result.data.tree[0].path).toBe('src/index.ts');
      }
    });

    it('should leave the fields the REST API used to supply absent', async () => {
      await serveArchive(SMALL_REPO);
      const result = await ingestRepo(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata.description).toBeUndefined();
        expect(result.data.metadata.stars).toBeUndefined();
        expect(result.data.metadata.lastCommitDate).toBeUndefined();
      }
    });
  });

  describe('Requests', () => {
    it('should ask codeload for the branch, with no credential', async () => {
      const fetchMock = await serveArchive(SMALL_REPO);
      await ingestRepo(input);

      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(`${CODELOAD_ORIGIN}/testuser/testrepo/tar.gz/main`);

      const headers = new Headers(init?.headers);
      expect(headers.has('Authorization')).toBe(false);
    });

    it('should default to HEAD when no branch is given', async () => {
      const fetchMock = await serveArchive(SMALL_REPO);
      const result = await ingestRepo({ owner: 'testuser', repo: 'testrepo' });

      expect(fetchMock.mock.calls[0][0]).toBe(`${CODELOAD_ORIGIN}/testuser/testrepo/tar.gz/${DEFAULT_REF}`);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata.branch).toBe(DEFAULT_REF);
      }
    });

    it('should keep the slashes in a branch name that has them', async () => {
      const fetchMock = await serveArchive(SMALL_REPO);
      await ingestRepo({ owner: 'testuser', repo: 'testrepo', branch: 'release/2.0' });

      // Escaping the ref whole would turn the slash into %2F and never resolve.
      expect(fetchMock.mock.calls[0][0]).toBe(`${CODELOAD_ORIGIN}/testuser/testrepo/tar.gz/release/2.0`);
    });
  });

  describe('Error Cases', () => {
    it('should return error for missing owner', async () => {
      const fetchMock = serveStatus(200);
      const result = await ingestRepo({ owner: '', repo: 'testrepo' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_INPUT');
        expect(result.error.message).toContain('Owner and repo are required');
      }
      // Rejected before it cost a request.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should return error for missing repo', async () => {
      serveStatus(200);
      const result = await ingestRepo({ owner: 'testuser', repo: '' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_INPUT');
      }
    });

    it('should handle 404 repository not found', async () => {
      serveStatus(404);
      const result = await ingestRepo({ owner: 'testuser', repo: 'nonexistent' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toBe('Repository not found or not accessible');
      }
    });

    it('should handle 429 rate limiting', async () => {
      serveStatus(429);
      const result = await ingestRepo(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('RATE_LIMIT');
        expect(result.error.message).toContain('rate limiting');
      }
    });

    it('should handle 403 as rate limiting', async () => {
      serveStatus(403);
      const result = await ingestRepo(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('RATE_LIMIT');
      }
    });

    it('should handle 500 server error', async () => {
      serveStatus(500);
      const result = await ingestRepo(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('SERVER_ERROR');
        expect(result.error.message).toContain('server error');
      }
    });

    it('should handle an unexpected status', async () => {
      serveStatus(418);
      const result = await ingestRepo(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('UNKNOWN');
      }
    });

    it('should handle a network failure', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => {
        throw new Error('Network error');
      }));

      const result = await ingestRepo(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('SERVER_ERROR');
        expect(result.error.message).toContain('Could not reach');
      }
    });

    it('should handle an archive that is not valid gzip', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })));

      const result = await ingestRepo(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('SERVER_ERROR');
        expect(result.error.message).toContain('could not be read');
      }
    });
  });

  describe('Budgets', () => {
    it('should stop and report truncation at the entry ceiling', async () => {
      // Zero length entries, so the archive is only its headers: this is the
      // shape that made an entry ceiling necessary in the first place.
      const parts: ArchivePart[] = [];
      for (let i = 0; i <= MAX_ARCHIVE_ENTRIES; i += 1) {
        parts.push(fileEntry(`testrepo-main/f${i}.txt`, ''));
      }
      parts.push(END_OF_ARCHIVE);

      await serveArchive(parts);
      const result = await ingestRepo(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata.truncated).toBe(true);
        expect(result.data.tree).toHaveLength(MAX_ARCHIVE_ENTRIES);
      }
    }, 60_000);
  });
});

// Made with Bob
