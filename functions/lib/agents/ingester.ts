import type { IngesterInput, RepoManifest, RepoMetadata, FileNode, AgentResult, AgentError } from '../types';
import { BINARY_EXTENSIONS, EXCLUDED_DIRS, GENERATED_FILES } from '../types';
import { readTar, type TarEntry, type TarReadResult } from '../tar';

/**
 * Host that serves repository archives. This is the endpoint `git clone` and
 * every package manager pull from, it needs no credentials for a public
 * repository, and one request replaces the 243 authenticated REST calls the
 * previous ingester made.
 */
export const CODELOAD_ORIGIN = 'https://codeload.github.com';

/** Ref requested when the caller does not name a branch. */
export const DEFAULT_REF = 'HEAD';

/**
 * Hard ceiling on decompressed bytes read from one archive.
 *
 * The largest demo repository, shadcn-ui/ui, decompresses to 48 MB, and
 * facebook/react to 44 MB, so this is roughly double the biggest real input.
 * Past it the read stops cleanly and the manifest reports `truncated`, rather
 * than the Worker being killed for exceeding its memory limit halfway through.
 */
export const MAX_ARCHIVE_BYTES = 96 * 1024 * 1024;

/**
 * Hard ceiling on entries read from one archive.
 *
 * facebook/react has 7,200 files, so this leaves a wide margin for a genuine
 * monorepo while refusing an archive of a million one byte files, which would
 * otherwise spin through millions of 512 byte headers. It also keeps the file
 * arrays small enough for `Math.max(...paths)` in the metrics pass, which
 * throws above roughly 120,000 arguments.
 */
export const MAX_ARCHIVE_ENTRIES = 40_000;

/**
 * Hard ceiling on files that keep their decoded content.
 *
 * Content is what turns a file into real line counts and real import edges,
 * and it is the only thing in the pipeline that is retained in proportion to
 * repository size. The measured populations are 356 parseable files for
 * honojs/hono, 969 for drizzle-team/drizzle-orm, 3,835 for shadcn-ui/ui and
 * 4,555 for facebook/react, so this covers every one of them.
 */
export const MAX_CONTENT_FILES = 5_000;

/**
 * Hard ceiling on total retained content, in bytes.
 *
 * The file count above is the ordinary limit; this is the backstop for a
 * repository of unusually large sources. facebook/react retains 24 MB, the
 * largest measured, so 32 MB clears it while leaving most of the Worker's
 * 128 MB memory budget for the layout simulation.
 */
export const MAX_CONTENT_BYTES = 32 * 1024 * 1024;

/**
 * Largest single file that keeps its content.
 *
 * Generated bundles, minified vendor drops and lock style files cost time and
 * memory and add almost no dependency signal. Two files in drizzle-orm and one
 * in shadcn-ui/ui exceed this; everything else in the demo set is far below it.
 */
export const MAX_CONTENT_FILE_BYTES = 400 * 1024;

/**
 * Extensions worth decoding. These either yield import edges or, at minimum,
 * an exact line count instead of a size based estimate.
 *
 * The list is also a safety rule rather than only a budget: TextDecoder turns
 * a binary file into replacement characters instead of failing, so decoding is
 * restricted to extensions that are text by definition.
 */
export const CONTENT_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.rb', '.php',
] as const;

/**
 * Files that are read for configuration rather than for their own sake.
 *
 * `tsconfig.json` carries the path aliases that resolve non relative imports,
 * and `package.json` marks a package root. They are retained under their own
 * budget so a large repository's sources cannot crowd them out: they arrive in
 * archive order, and a repo root `tsconfig.json` sorts after most directories.
 */
export const CONFIG_CONTENT_FILES = ['tsconfig.json', 'package.json'] as const;

/**
 * Ceiling on retained configuration files, and on the size of each.
 *
 * These sit outside MAX_CONTENT_BYTES on purpose, since the point of the
 * separate budget is that sources cannot crowd them out. The two together are
 * the real memory ceiling: 32 MB of sources plus at most 12.8 MB here.
 */
export const MAX_CONFIG_CONTENT_FILES = 200;
export const MAX_CONFIG_CONTENT_FILE_BYTES = 64 * 1024;

/** A full git object name, which is what a root directory holds when the caller asked for a commit. */
const COMMIT_SHA = /^[0-9a-f]{40}$/;

const CONTENT_EXTENSION_SET: ReadonlySet<string> = new Set(CONTENT_EXTENSIONS);
const BINARY_EXTENSION_SET: ReadonlySet<string> = new Set<string>(BINARY_EXTENSIONS);
const EXCLUDED_DIR_SET: ReadonlySet<string> = new Set<string>(EXCLUDED_DIRS);
const GENERATED_FILE_SET: ReadonlySet<string> = new Set<string>(GENERATED_FILES);
const CONFIG_CONTENT_SET: ReadonlySet<string> = new Set<string>(CONFIG_CONTENT_FILES);

/**
 * Agent 1: Repo Ingester
 *
 * Streams the repository's source archive from codeload, decompresses it and
 * parses the tar as it arrives, producing both the file tree and the decoded
 * text of every file worth parsing. One unauthenticated request, no token, and
 * nothing larger than a single file is ever held in memory.
 *
 * @param input Repository coordinates (owner, repo, optional branch)
 * @returns RepoManifest with metadata, the filtered file tree and file contents
 */
export async function ingestRepo(input: IngesterInput): Promise<AgentResult<RepoManifest>> {
  if (!input.owner || !input.repo) {
    return {
      success: false,
      error: {
        code: 'INVALID_INPUT',
        message: 'Owner and repo are required',
      },
    };
  }

  const ref = input.branch || DEFAULT_REF;

  let response: Response;
  try {
    response = await fetch(archiveUrl(input.owner, input.repo, ref), {
      headers: { 'User-Agent': 'atlas-repo-visualizer/1.0.0' },
    });
  } catch (error: unknown) {
    return {
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Could not reach the GitHub archive service',
        details: error instanceof Error ? error.message : error,
      },
    };
  }

  if (!response.ok) {
    // The body is a short plain text reason and is of no use to the caller.
    await response.body?.cancel().catch(() => undefined);
    return { success: false, error: describeStatus(response.status) };
  }

  if (response.body === null) {
    return {
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'GitHub returned an empty archive',
      },
    };
  }

  const tree: FileNode[] = [];
  const contents = new Map<string, string>();
  const decoder = new TextDecoder();

  // Every path in the archive sits under a single generated root directory.
  // It is read from the first entry rather than assumed, because its name
  // depends on the ref that was requested.
  let rootPrefix: string | null = null;
  let contentBytes = 0;
  let configFiles = 0;

  /**
   * Strip the archive's root directory and reject anything the map does not
   * show. Returns null when the entry should be ignored entirely.
   */
  function repoPath(entry: TarEntry): string | null {
    if (rootPrefix === null) {
      const slash = entry.path.indexOf('/');
      rootPrefix = slash === -1 ? '' : entry.path.slice(0, slash + 1);
    }

    const path = entry.path.startsWith(rootPrefix) ? entry.path.slice(rootPrefix.length) : entry.path;
    if (path === '' || path.endsWith('/')) {
      return null;
    }

    for (const segment of path.split('/')) {
      if (EXCLUDED_DIR_SET.has(segment)) {
        return null;
      }
    }

    const extension = getFileExtension(path);
    if (extension !== null && BINARY_EXTENSION_SET.has(extension)) {
      return null;
    }

    if (GENERATED_FILE_SET.has(getBaseName(path))) {
      return null;
    }

    return path;
  }

  /** Decide whether a kept file is worth decoding, and under which budget. */
  function contentBudget(path: string, size: number): 'source' | 'config' | null {
    if (CONFIG_CONTENT_SET.has(getBaseName(path))) {
      if (configFiles < MAX_CONFIG_CONTENT_FILES && size <= MAX_CONFIG_CONTENT_FILE_BYTES) {
        return 'config';
      }
      return null;
    }

    const extension = getFileExtension(path);
    if (extension === null || !CONTENT_EXTENSION_SET.has(extension)) {
      return null;
    }
    if (size > MAX_CONTENT_FILE_BYTES) {
      return null;
    }
    if (contents.size >= MAX_CONTENT_FILES || contentBytes + size > MAX_CONTENT_BYTES) {
      return null;
    }

    return 'source';
  }

  // The reader calls wantBody exactly once per entry and onFile immediately
  // after, so the classification is done once and carried across rather than
  // splitting every path twice. The guard on the path keeps that an
  // optimisation rather than an assumption the two calls can ever disagree.
  let decided: { source: string; path: string | null; budget: 'source' | 'config' | null } = {
    source: '',
    path: null,
    budget: null,
  };

  function classify(entry: TarEntry): { path: string | null; budget: 'source' | 'config' | null } {
    if (decided.source !== entry.path) {
      const path = repoPath(entry);
      decided = {
        source: entry.path,
        path,
        budget: path === null ? null : contentBudget(path, entry.size),
      };
    }
    return decided;
  }

  let read: TarReadResult;
  try {
    read = await readTar(
      response.body.pipeThrough(new DecompressionStream('gzip')) as ReadableStream<Uint8Array>,
      {
        wantBody(entry: TarEntry): boolean {
          return classify(entry).budget !== null;
        },
        onFile(entry: TarEntry, body: Uint8Array | null): void {
          const { path, budget } = classify(entry);
          if (path === null) {
            return;
          }

          tree.push({ path, type: 'file', size: entry.size });

          if (body === null || budget === null) {
            return;
          }

          contents.set(path, decoder.decode(body));
          if (budget === 'config') {
            configFiles += 1;
          } else {
            contentBytes += entry.size;
          }
        },
      },
      { maxBytes: MAX_ARCHIVE_BYTES, maxEntries: MAX_ARCHIVE_ENTRIES }
    );
  } catch (error: unknown) {
    // A corrupt gzip stream surfaces here, as does a connection dropped mid
    // archive. Neither is the caller's fault and neither is retryable by them.
    return {
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'The repository archive could not be read',
        details: error instanceof Error ? error.message : error,
      },
    };
  }

  const metadata: RepoMetadata = {
    owner: input.owner,
    repo: input.repo,
    branch: ref,
    truncated: read.truncated,
  };

  const resolvedRef = readResolvedRef(rootPrefix, input.repo);
  if (resolvedRef !== null) {
    metadata.resolvedRef = resolvedRef;
    if (COMMIT_SHA.test(resolvedRef)) {
      metadata.commitSha = resolvedRef;
    }
  }

  return {
    success: true,
    data: { metadata, tree, contents },
  };
}

/**
 * Build the archive URL.
 *
 * Owner and repo are escaped whole, because neither may contain a slash. The
 * ref is escaped per segment, because a branch name legitimately can:
 * `release/2.0` has to stay two path segments to resolve.
 */
function archiveUrl(owner: string, repo: string, ref: string): string {
  const escapedRef = ref.split('/').map(encodeURIComponent).join('/');
  return `${CODELOAD_ORIGIN}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tar.gz/${escapedRef}`;
}

/**
 * Read the ref the archive was cut at from its root directory.
 *
 * codeload names that directory `{repo}-{ref}`, so the repository name is
 * stripped by length rather than by splitting on the separator, which a
 * repository name may itself contain.
 *
 * @param rootPrefix Root directory including its trailing slash, or null for an empty archive
 * @param repo Repository name as requested
 * @returns The ref, or null when the directory does not have the expected shape
 */
function readResolvedRef(rootPrefix: string | null, repo: string): string | null {
  if (rootPrefix === null || rootPrefix === '') {
    return null;
  }

  const directory = rootPrefix.slice(0, -1);
  const marker = `${repo}-`;
  if (!directory.startsWith(marker) || directory.length === marker.length) {
    return null;
  }

  return directory.slice(marker.length);
}

/**
 * Map a codeload status onto the pipeline's error vocabulary.
 *
 * codeload answers 404 both for a repository that does not exist and for one
 * that is private, which are deliberately indistinguishable to an anonymous
 * caller, so both keep the message the REST based ingester used.
 */
function describeStatus(status: number): AgentError {
  if (status === 404) {
    return {
      code: 'NOT_FOUND',
      message: 'Repository not found or not accessible',
      details: { status },
    };
  }

  if (status === 429 || status === 403) {
    return {
      code: 'RATE_LIMIT',
      message: 'GitHub is rate limiting archive downloads. Try again shortly.',
      details: { status },
    };
  }

  if (status >= 500) {
    return {
      code: 'SERVER_ERROR',
      message: 'GitHub archive server error',
      details: { status },
    };
  }

  return {
    code: 'UNKNOWN',
    message: `GitHub rejected the archive request (${status})`,
    details: { status },
  };
}

/**
 * Extract the last path segment
 */
function getBaseName(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

/**
 * Extract file extension from path
 */
function getFileExtension(path: string): string | null {
  const match = path.match(/\.([^./]+)$/);
  return match ? `.${match[1].toLowerCase()}` : null;
}

// Made with Bob
