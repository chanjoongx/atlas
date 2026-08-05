import type { Octokit } from '@octokit/rest';
import type { FileNode, CodeStructure, ParsedFile, Dependency, RepoMetrics, FileType, AgentResult } from '../types';

/**
 * Input contract for Agent 2: Structure Parser
 */
export interface ParserInput {
  tree: FileNode[];
  owner: string;
  repo: string;
}

/**
 * Language mapping from file extensions
 */
export const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.hpp': 'cpp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.md': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.sql': 'sql',
};

/**
 * Entry point file patterns, relative to a package root
 */
export const ENTRY_POINT_PATTERNS = [
  'src/index.ts',
  'src/index.tsx',
  'src/index.js',
  'src/index.jsx',
  'src/main.ts',
  'src/main.tsx',
  'src/main.js',
  'src/main.jsx',
  'src/App.tsx',
  'src/App.jsx',
  'app/page.tsx',
  'app/page.jsx',
  'pages/index.tsx',
  'pages/index.jsx',
  'index.ts',
  'index.js',
  'main.ts',
  'main.js',
];

/**
 * Test file patterns
 */
export const TEST_PATTERNS = [
  '__tests__/',
  '.test.',
  '.spec.',
  'test/',
  'tests/',
  '__mocks__/',
];

/**
 * Config file patterns
 */
export const CONFIG_PATTERNS = [
  'package.json',
  'tsconfig',
  '.config.',
  '.eslintrc',
  '.prettierrc',
  'vite.config',
  'webpack.config',
  'rollup.config',
  'jest.config',
  'vitest.config',
  '.env',
  'Dockerfile',
  'docker-compose',
  '.gitignore',
  '.npmrc',
  '.yarnrc',
  'babel.config',
  'postcss.config',
  'tailwind.config',
];

/**
 * Documentation file patterns
 */
export const DOC_PATTERNS = [
  'README',
  'LICENSE',
  'CHANGELOG',
  'CONTRIBUTING',
  'CODE_OF_CONDUCT',
  'docs/',
  '.md',
  '.rst',
  '.txt',
];

/**
 * Asset directory patterns
 */
export const ASSET_PATTERNS = [
  'public/',
  'assets/',
  'static/',
  'images/',
  'img/',
  'fonts/',
  'media/',
];

/**
 * Extensions worth downloading. These either yield import edges or, at minimum,
 * an exact line count instead of a size based estimate.
 */
export const FETCHABLE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.rb', '.php',
];

/**
 * Extensions probed, in order, when an import specifier omits its extension.
 */
export const RESOLUTION_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.d.ts'];

/**
 * Hard ceiling on blob downloads per analysis.
 *
 * Every download is one Cloudflare subrequest (1000 per request on Workers Paid,
 * 50 on the free plan), so this number is the single lever for request cost.
 * The layout renders at most 500 nodes, and content for the highest value half
 * of those is enough to draw a representative dependency graph.
 */
export const MAX_CONTENT_FETCHES = 240;

/**
 * Blob requests kept in flight at once. Bounded so a large repo cannot open
 * hundreds of sockets at the same time.
 */
export const FETCH_CONCURRENCY = 14;

/**
 * Files larger than this (bytes) are never downloaded. Generated bundles and
 * lock style files cost time and add almost no dependency signal.
 */
export const MAX_FETCH_FILE_SIZE = 400 * 1024;

/**
 * Consecutive blob failures that end the download pass.
 *
 * One failure is a bad blob. A run of them means the runtime is rejecting
 * every further call, which is what hitting the subrequest budget looks like
 * from inside the request.
 */
export const CONSECUTIVE_FAILURE_LIMIT = 8;

/**
 * Most entry points a single repository may claim. Without a cap a monorepo
 * turns every package index into a landmark and drowns out everything else.
 */
export const MAX_ENTRY_POINTS = 20;

/**
 * Most tsconfig files read for path aliases, and how deep they may live.
 */
const MAX_TSCONFIG_FETCHES = 8;
const MAX_TSCONFIG_DEPTH = 3;
const MAX_TSCONFIG_SIZE = 64 * 1024;

/**
 * Path alias rule derived from a tsconfig `compilerOptions.paths` entry.
 */
interface AliasRule {
  /** Directory the tsconfig governs. Empty string means the repo root. */
  scope: string;
  /** Specifier text before the wildcard, for example `@/`. */
  prefix: string;
  /** True when the pattern contained a `*` wildcard. */
  wildcard: boolean;
  /** Repo relative directory prefixes the alias maps to. */
  targets: string[];
}

/**
 * Agent 2: Structure Parser
 *
 * Extracts code structure, dependencies, and metrics from a file tree.
 * Downloads content for the highest value source files (bounded by
 * MAX_CONTENT_FETCHES) and resolves every import against the real file tree,
 * so an edge is only emitted when its target actually exists in the repo.
 *
 * @param input Parser input with file tree and repo coordinates
 * @param octokit Authenticated Octokit client
 * @returns CodeStructure with parsed files, dependencies, and metrics
 */
export async function parseStructure(
  input: ParserInput,
  octokit: Octokit
): Promise<AgentResult<CodeStructure>> {
  try {
    // Validate input
    if (!input.tree || input.tree.length === 0) {
      return {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'File tree is empty',
        },
      };
    }

    // Filter out directories, only process files
    const files = input.tree.filter(node => node.type === 'file');
    const filePaths = new Set(files.map(file => file.path));

    // Entry points are resolved against real package roots, then capped
    const packageRoots = collectPackageRoots(filePaths);
    const entryPoints = selectEntryPoints(files, packageRoots);

    // Identify files to fetch content for, then fetch them with bounded concurrency
    const filesToFetch = identifyFilesToFetch(files, entryPoints, packageRoots);
    const fileContents = await fetchFileContents(
      filesToFetch,
      input.owner,
      input.repo,
      octokit
    );

    // Path aliases (optional signal, silently skipped when tsconfig is unreadable)
    const aliasRules = buildAliasRules(fileContents);

    // Process each file
    const parsedFiles: ParsedFile[] = [];
    const dependencies: Dependency[] = [];
    const seenDependencies = new Set<string>();

    for (const file of files) {
      const content = fileContents.get(file.path);
      const parsedFile = parseFile(file, entryPoints.has(file.path), content);

      // Extract dependencies if content is available
      if (content !== undefined) {
        const fileDeps = extractDependencies(
          file.path,
          content,
          parsedFile.language,
          filePaths,
          aliasRules
        );

        for (const dependency of fileDeps) {
          // A newline cannot appear in a git path, so it is a safe separator
          const key = `${dependency.from}\n${dependency.to}`;
          if (seenDependencies.has(key)) {
            continue;
          }
          seenDependencies.add(key);
          dependencies.push(dependency);
          parsedFile.imports.push(dependency.to);
        }
      }

      parsedFiles.push(parsedFile);
    }

    // Calculate metrics
    const metrics = calculateMetrics(parsedFiles);

    return {
      success: true,
      data: {
        files: parsedFiles,
        dependencies,
        metrics,
      },
    };

  } catch (error: unknown) {
    return {
      success: false,
      error: {
        code: 'UNKNOWN',
        message: error instanceof Error ? error.message : 'Failed to parse structure',
        details: error,
      },
    };
  }
}

/**
 * Collect the directories that own an entry point: the repo root plus every
 * directory that has its own package.json (the package roots of a monorepo).
 *
 * @param filePaths Every file path in the repository
 * @returns Set of repo relative directories, with the empty string for the root
 */
export function collectPackageRoots(filePaths: ReadonlySet<string>): Set<string> {
  const roots = new Set<string>(['']);
  const suffix = '/package.json';

  for (const path of Array.from(filePaths)) {
    if (path.endsWith(suffix)) {
      roots.add(path.slice(0, path.length - suffix.length));
    }
  }

  return roots;
}

/**
 * Check whether a path is `<package root>/<entry point pattern>`.
 *
 * The previous implementation matched any path ending in an entry pattern, so
 * every `src/middleware/foo/index.ts` in a large repo counted as an entry point.
 *
 * @param path Repo relative file path
 * @param packageRoots Directories that may own an entry point
 * @returns True when the file is a genuine entry point
 */
export function isEntryPoint(path: string, packageRoots: ReadonlySet<string>): boolean {
  for (const pattern of ENTRY_POINT_PATTERNS) {
    if (path === pattern) {
      return packageRoots.has('');
    }

    if (!path.endsWith(`/${pattern}`)) {
      continue;
    }

    const root = path.slice(0, path.length - pattern.length - 1);
    if (packageRoots.has(root)) {
      return true;
    }
  }

  return false;
}

/**
 * Select the entry points of a repository, shallowest first, capped at
 * MAX_ENTRY_POINTS so one repo cannot claim every landmark.
 *
 * @param files Files in the repository
 * @param packageRoots Directories that may own an entry point
 * @returns Set of entry point paths
 */
export function selectEntryPoints(
  files: FileNode[],
  packageRoots: ReadonlySet<string>
): Set<string> {
  const candidates = files
    .filter(file => isEntryPoint(file.path, packageRoots))
    .map(file => file.path)
    .sort((a, b) => {
      const depthDiff = a.split('/').length - b.split('/').length;
      if (depthDiff !== 0) {
        return depthDiff;
      }
      return a.localeCompare(b);
    });

  return new Set(candidates.slice(0, MAX_ENTRY_POINTS));
}

/**
 * Identify which files to download content for.
 *
 * Ranking mirrors prioritizeFiles() in layout.ts so the downloaded files
 * overlap the nodes that actually get rendered. Without that overlap an edge
 * is discarded because one of its endpoints was never selected as a node.
 */
function identifyFilesToFetch(
  files: FileNode[],
  entryPoints: ReadonlySet<string>,
  packageRoots: ReadonlySet<string>
): FileNode[] {
  const selected: FileNode[] = [];
  const selectedPaths = new Set<string>();

  function take(file: FileNode): void {
    if (selectedPaths.has(file.path) || selected.length >= MAX_CONTENT_FETCHES) {
      return;
    }
    selectedPaths.add(file.path);
    selected.push(file);
  }

  // 1. Root manifest: cheap, and callers expect it to be present
  const rootManifest = files.find(file => file.path === 'package.json');
  if (rootManifest) {
    take(rootManifest);
  }

  // 2. tsconfig files carry the path aliases used to resolve non relative imports
  const tsconfigs = files
    .filter(file => isAliasConfigCandidate(file, packageRoots))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))
    .slice(0, MAX_TSCONFIG_FETCHES);

  for (const tsconfig of tsconfigs) {
    take(tsconfig);
  }

  // 3. Source files, highest value first
  const candidates = files
    .filter(file => isFetchableSource(file, entryPoints))
    .map(file => ({ file, score: scoreFetchCandidate(file, entryPoints.has(file.path)) }))
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));

  for (const candidate of candidates) {
    if (selected.length >= MAX_CONTENT_FETCHES) {
      break;
    }
    take(candidate.file);
  }

  return selected;
}

/**
 * Check whether a file is a source file worth downloading
 */
function isFetchableSource(file: FileNode, entryPoints: ReadonlySet<string>): boolean {
  if (file.size > MAX_FETCH_FILE_SIZE) {
    return false;
  }

  const ext = getFileExtension(file.path);
  if (!ext || !FETCHABLE_EXTENSIONS.includes(ext)) {
    return false;
  }

  if (entryPoints.has(file.path)) {
    return true;
  }

  return classifyFileType(file.path) === 'source';
}

/**
 * Check whether a file is a tsconfig worth reading for path aliases
 */
function isAliasConfigCandidate(file: FileNode, packageRoots: ReadonlySet<string>): boolean {
  if (getBaseName(file.path) !== 'tsconfig.json' || file.size > MAX_TSCONFIG_SIZE) {
    return false;
  }

  const dir = dirName(file.path);
  if (dir === '') {
    return true;
  }

  return packageRoots.has(dir) && dir.split('/').length <= MAX_TSCONFIG_DEPTH;
}

/**
 * Score a file for download priority.
 *
 * Mirrors the scoring in prioritizeFiles() (layout.ts): entry points first,
 * then large-but-shallow source files, with examples, fixtures, and legacy code
 * pushed to the back.
 */
function scoreFetchCandidate(file: FileNode, isEntry: boolean): number {
  const estimatedLoc = Math.max(Math.floor(file.size / 35), 1);
  let score = Math.sqrt(estimatedLoc);

  if (isEntry) {
    score += 1000;
  }

  const path = file.path.toLowerCase();
  if (path.includes('example')) score -= 50;
  if (path.includes('test') || path.includes('spec')) score -= 30;
  if (path.includes('fixture') || path.includes('mock')) score -= 30;
  if (path.includes('__')) score -= 20;
  if (path.includes('legacy') || path.includes('deprecated')) score -= 40;

  const fileName = path.split('/').pop() || '';
  if (fileName.length < 15) score += 10;

  if (file.path.split('/').length <= 3) score += 15;

  return score;
}

/**
 * Fetch file contents from the GitHub blob API with bounded concurrency.
 * Failures are logged and skipped: partial results beat a failed analysis.
 */
async function fetchFileContents(
  files: FileNode[],
  owner: string,
  repo: string,
  octokit: Octokit
): Promise<Map<string, string>> {
  const contents = new Map<string, string>();
  let cursor = 0;
  let consecutiveFailures = 0;
  let exhausted = false;

  async function worker(): Promise<void> {
    while (cursor < files.length && !exhausted) {
      const file = files[cursor];
      cursor += 1;

      try {
        const response = await octokit.rest.git.getBlob({
          owner,
          repo,
          file_sha: file.sha,
        });

        // GitHub reports encoding 'none' for blobs it refuses to inline
        const encoding = (response.data as { encoding?: string }).encoding;
        if (encoding !== undefined && encoding !== 'base64') {
          continue;
        }

        contents.set(file.path, decodeBase64Content(response.data.content));
        consecutiveFailures = 0;
      } catch (error) {
        // Partial results beat no results, so one bad blob never stops the run.
        // A run of failures is different: it means the runtime is refusing
        // every further call, which on Cloudflare is the per-request subrequest
        // budget (50 on the free plan, 1000 on paid). Once that happens the
        // remaining hundreds of attempts can only add latency and log noise, so
        // the pool stops and the analysis continues with whatever it has.
        consecutiveFailures += 1;
        if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
          exhausted = true;
          console.warn(
            `Stopping blob downloads after ${consecutiveFailures} consecutive failures; ` +
              `${contents.size} of ${files.length} files were retrieved.`
          );
          return;
        }
        console.warn(`Failed to fetch content for ${file.path}:`, error);
      }
    }
  }

  const workerCount = Math.min(FETCH_CONCURRENCY, files.length);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i += 1) {
    workers.push(worker());
  }

  await Promise.all(workers);

  return contents;
}

/**
 * Decode a GitHub blob payload into a UTF-8 string.
 *
 * Runtime agnostic: Cloudflare Workers have no Buffer, so this uses atob plus
 * TextDecoder. GitHub wraps blob content at 60 characters, so whitespace is
 * stripped before decoding, and multi-byte UTF-8 survives because the decoding
 * happens over raw bytes rather than per character.
 *
 * @param encoded Base64 payload, possibly containing newlines
 * @returns Decoded UTF-8 text, or an empty string when the payload is empty
 */
export function decodeBase64Content(encoded: string): string {
  if (!encoded) {
    return '';
  }

  const normalized = encoded.replace(/\s+/g, '');
  if (normalized.length === 0) {
    return '';
  }

  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Parse a single file into ParsedFile structure
 */
function parseFile(file: FileNode, isEntry: boolean, content?: string): ParsedFile {
  const language = detectLanguage(file.path);
  const type = classifyFileType(file.path);

  // Calculate LOC
  let loc: number;
  if (content !== undefined) {
    // Actual line count from content
    loc = Math.max(content.split('\n').length, 1);
  } else {
    // Estimate from file size (35 bytes per line average)
    loc = Math.max(Math.floor(file.size / 35), 1);
  }

  return {
    path: file.path,
    type,
    language,
    loc,
    imports: [], // Populated from resolved dependencies
    exports: [], // Out of MVP scope
    isEntryPoint: isEntry,
  };
}

/**
 * Detect programming language from file extension
 */
function detectLanguage(path: string): string {
  const ext = getFileExtension(path);
  return ext ? LANGUAGE_MAP[ext] || 'unknown' : 'unknown';
}

/**
 * Classify file type based on path patterns
 */
function classifyFileType(path: string): FileType {
  // Check test patterns
  for (const pattern of TEST_PATTERNS) {
    if (path.includes(pattern)) {
      return 'test';
    }
  }

  // Check config patterns
  for (const pattern of CONFIG_PATTERNS) {
    if (path.includes(pattern)) {
      return 'config';
    }
  }

  // Check doc patterns
  for (const pattern of DOC_PATTERNS) {
    if (path.includes(pattern)) {
      return 'docs';
    }
  }

  // Check asset patterns
  for (const pattern of ASSET_PATTERNS) {
    if (path.startsWith(pattern) || path.includes(`/${pattern}`)) {
      return 'asset';
    }
  }

  // Default to source
  return 'source';
}

/**
 * Extract file extension from path
 */
function getFileExtension(path: string): string | null {
  const match = path.match(/\.([^./]+)$/);
  return match ? `.${match[1].toLowerCase()}` : null;
}

/**
 * Extract the last path segment
 */
function getBaseName(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

/**
 * Extract the directory of a path. Returns an empty string for root level files.
 */
function dirName(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

/**
 * Join two path fragments without introducing a leading slash
 */
function joinPath(base: string, relative: string): string {
  if (base === '') {
    return relative;
  }
  if (relative === '') {
    return base;
  }
  return `${base}/${relative}`;
}

/**
 * Normalize a repo relative path, resolving `.` and `..` segments.
 *
 * @returns Normalized path, or null when the path is empty or escapes the repo root
 */
export function normalizePath(path: string): string | null {
  const segments: string[] = [];

  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (segments.length === 0) {
        return null;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return segments.length > 0 ? segments.join('/') : null;
}

/**
 * Extract dependencies (imports) from file content.
 *
 * JavaScript and TypeScript cover ES imports, dynamic imports, re-exports, and
 * CommonJS requires. Python covers relative imports. Other languages contribute
 * an exact line count but no edges.
 */
function extractDependencies(
  filePath: string,
  content: string,
  language: string,
  filePaths: ReadonlySet<string>,
  aliases: readonly AliasRule[]
): Dependency[] {
  if (language === 'typescript' || language === 'javascript') {
    return extractScriptDependencies(filePath, content, filePaths, aliases);
  }

  if (language === 'python') {
    return extractPythonDependencies(filePath, content, filePaths);
  }

  return [];
}

/**
 * Extract JavaScript and TypeScript dependencies
 */
function extractScriptDependencies(
  filePath: string,
  content: string,
  filePaths: ReadonlySet<string>,
  aliases: readonly AliasRule[]
): Dependency[] {
  const dependencies: Dependency[] = [];

  function add(specifier: string, type: 'import' | 'dynamic'): void {
    const resolved = resolveImportPath(filePath, specifier, filePaths, aliases);
    if (resolved !== null) {
      dependencies.push({ from: filePath, to: resolved, type });
    }
  }

  // ES imports and re-exports: import ... from '...', export ... from '...', import '...'
  //
  // This runs over file contents downloaded from any public repository on
  // GitHub, so it has to be safe against input written specifically to break
  // it. The previous pattern was not:
  //
  //   /(?:^|[\s;}])(?:import|export)\s+(?:[\w*${}\s,]*?\s+from\s+)?['"]...['"]/
  //
  // Three whitespace matching constructs, `\s+` then a class containing `\s`
  // then `\s+`, all competing to consume the same run. A file containing
  // `import` followed by a long run of spaces and no quote made the engine
  // re-partition that run: measured at 68ms for 800 spaces, 502ms for 1600,
  // and 4.5 seconds for 3200, roughly nine times worse per doubling. The fetch
  // budget allows 400 KB per file, which is seven more doublings, so one
  // crafted file in one public repository could pin a production CPU core for
  // as long as the runtime allowed.
  //
  // The replacement has a single bounded lazy class and no adjacent quantifier
  // competing with it, so the work per starting position is capped at the
  // bound rather than growing with the input. Excluding `=` and `;` keeps it
  // to real import and export-from statements rather than matching the first
  // string literal after any `export const`.
  // `(` is excluded as well, so `import('./x')` is left to the dynamic import
  // matcher below and keeps its own edge type rather than being swallowed here.
  const importRegex = /(?:^|[\s;}])(?:import|export)\b[^'"=;(]{0,300}?['"]([^'"\n]{1,512})['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    add(match[1], 'import');
  }

  // Dynamic imports: import('...')
  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicImportRegex.exec(content)) !== null) {
    add(match[1], 'dynamic');
  }

  // CommonJS require: require('...')
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(content)) !== null) {
    add(match[1], 'import');
  }

  return dependencies;
}

/**
 * Extract Python relative imports (`from .module import name`)
 */
function extractPythonDependencies(
  filePath: string,
  content: string,
  filePaths: ReadonlySet<string>
): Dependency[] {
  const dependencies: Dependency[] = [];
  const relativeImportRegex = /^[ \t]*from\s+(\.+)([A-Za-z_][\w.]*)?\s+import\s+/gm;

  let match: RegExpExecArray | null;
  while ((match = relativeImportRegex.exec(content)) !== null) {
    const dots = match[1];
    const moduleName = match[2] ?? '';

    // One dot is the current package, each extra dot walks one level up
    const upward = '../'.repeat(dots.length - 1);
    const modulePath = moduleName.replace(/\./g, '/');
    const base = normalizePath(joinPath(dirName(filePath), `${upward}${modulePath}`));
    if (base === null) {
      continue;
    }

    const target = [`${base}.py`, `${base}/__init__.py`].find(
      candidate => filePaths.has(candidate) && candidate !== filePath
    );

    if (target !== undefined) {
      dependencies.push({ from: filePath, to: target, type: 'import' });
    }
  }

  return dependencies;
}

/**
 * Resolve an import specifier to a real file in the repository.
 *
 * Resolution is evidence based: the candidate path is probed against the set of
 * paths that actually exist in the tree, trying the exact path, then each known
 * extension, then `<path>/index.<ext>`. Bare specifiers (npm packages) resolve
 * only through a tsconfig path alias, and unresolvable specifiers return null so
 * no phantom edge is emitted.
 *
 * @param fromPath Path of the importing file
 * @param importPath Raw specifier as written in the source
 * @param filePaths Every file path in the repository
 * @param aliases Path alias rules from tsconfig files
 * @returns Repo relative path of the imported file, or null
 */
export function resolveImportPath(
  fromPath: string,
  importPath: string,
  filePaths: ReadonlySet<string>,
  aliases: readonly AliasRule[] = []
): string | null {
  const specifier = importPath.trim();
  if (specifier === '') {
    return null;
  }

  const candidates: string[] = [];

  if (specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../')) {
    // Relative import, resolved against the importing file's directory
    const base = normalizePath(joinPath(dirName(fromPath), specifier));
    if (base === null) {
      return null;
    }
    candidates.push(base);
  } else if (specifier.startsWith('/')) {
    // Absolute import, resolved from the repo root
    const base = normalizePath(specifier);
    if (base === null) {
      return null;
    }
    candidates.push(base);
  } else {
    // Bare specifier: only a tsconfig alias can point it back into the repo
    candidates.push(...resolveAliasCandidates(fromPath, specifier, aliases));
  }

  for (const candidate of candidates) {
    const resolved = probeFilePath(candidate, filePaths);
    if (resolved !== null && resolved !== fromPath) {
      return resolved;
    }
  }

  return null;
}

/**
 * Probe a candidate path against the real file tree
 */
function probeFilePath(base: string, filePaths: ReadonlySet<string>): string | null {
  if (base === '') {
    return null;
  }

  if (filePaths.has(base)) {
    return base;
  }

  for (const ext of RESOLUTION_EXTENSIONS) {
    const withExtension = `${base}${ext}`;
    if (filePaths.has(withExtension)) {
      return withExtension;
    }
  }

  for (const ext of RESOLUTION_EXTENSIONS) {
    const indexFile = `${base}/index${ext}`;
    if (filePaths.has(indexFile)) {
      return indexFile;
    }
  }

  return null;
}

/**
 * Expand a bare specifier into candidate paths using tsconfig path aliases
 */
function resolveAliasCandidates(
  fromPath: string,
  specifier: string,
  aliases: readonly AliasRule[]
): string[] {
  const candidates: string[] = [];

  for (const rule of aliases) {
    // A package level tsconfig only governs files inside its own directory
    if (rule.scope !== '' && !fromPath.startsWith(`${rule.scope}/`)) {
      continue;
    }

    if (rule.wildcard) {
      if (!specifier.startsWith(rule.prefix)) {
        continue;
      }
      const rest = specifier.slice(rule.prefix.length);
      for (const target of rule.targets) {
        const joined = normalizePath(joinPath(target, rest));
        if (joined !== null) {
          candidates.push(joined);
        }
      }
      continue;
    }

    if (specifier !== rule.prefix) {
      continue;
    }
    for (const target of rule.targets) {
      const joined = normalizePath(target);
      if (joined !== null) {
        candidates.push(joined);
      }
    }
  }

  return candidates;
}

/**
 * Build path alias rules from the tsconfig files that were downloaded.
 * Any tsconfig that fails to parse is skipped: aliases are a bonus signal, and
 * relative import resolution does not depend on them.
 */
function buildAliasRules(contents: ReadonlyMap<string, string>): AliasRule[] {
  const rules: AliasRule[] = [];

  for (const [path, text] of Array.from(contents.entries())) {
    if (getBaseName(path) !== 'tsconfig.json') {
      continue;
    }

    const config = parseJsonc(text) as {
      compilerOptions?: { baseUrl?: unknown; paths?: unknown };
    } | null;

    const compilerOptions = config?.compilerOptions;
    if (!compilerOptions || typeof compilerOptions !== 'object') {
      continue;
    }

    const paths = compilerOptions.paths;
    if (!paths || typeof paths !== 'object') {
      continue;
    }

    const scope = dirName(path);
    const baseUrl = typeof compilerOptions.baseUrl === 'string' ? compilerOptions.baseUrl : '.';
    const base = normalizePath(joinPath(scope, baseUrl)) ?? '';

    for (const [pattern, rawTargets] of Object.entries(paths as Record<string, unknown>)) {
      if (!Array.isArray(rawTargets)) {
        continue;
      }

      const wildcardIndex = pattern.indexOf('*');
      const prefix = wildcardIndex >= 0 ? pattern.slice(0, wildcardIndex) : pattern;
      const targets: string[] = [];

      for (const rawTarget of rawTargets) {
        if (typeof rawTarget !== 'string') {
          continue;
        }
        const targetWildcard = rawTarget.indexOf('*');
        const targetPrefix = targetWildcard >= 0 ? rawTarget.slice(0, targetWildcard) : rawTarget;
        targets.push(normalizePath(joinPath(base, targetPrefix)) ?? '');
      }

      if (targets.length > 0) {
        rules.push({ scope, prefix, wildcard: wildcardIndex >= 0, targets });
      }
    }
  }

  // Most specific scope first, so a package tsconfig wins over the repo root one
  rules.sort((a, b) => b.scope.length - a.scope.length);

  return rules;
}

/**
 * Parse JSON that may contain comments and trailing commas (tsconfig style)
 *
 * @returns Parsed value, or null when the text is not valid JSON
 */
function parseJsonc(text: string): unknown {
  try {
    return JSON.parse(stripJsonComments(text).replace(/,(\s*[}\]])/g, '$1'));
  } catch {
    return null;
  }
}

/**
 * Remove line and block comments from JSON text, leaving string literals intact
 */
function stripJsonComments(text: string): string {
  let result = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = i + 1 < text.length ? text[i + 1] : '';

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        result += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      result += char;
      if (char === '\\') {
        result += next;
        i += 1;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }

    result += char;
  }

  return result;
}

/**
 * Calculate repository metrics
 */
function calculateMetrics(files: ParsedFile[]): RepoMetrics {
  // Filter out asset files from metrics
  const nonAssetFiles = files.filter(f => f.type !== 'asset');

  const totalFiles = nonAssetFiles.length;
  const totalLOC = nonAssetFiles.reduce((sum, f) => sum + f.loc, 0);

  // Language breakdown
  const languageBreakdown: Record<string, number> = {};
  for (const file of nonAssetFiles) {
    if (file.language !== 'unknown') {
      languageBreakdown[file.language] = (languageBreakdown[file.language] || 0) + file.loc;
    }
  }

  // Directory depth
  const directoryDepth = Math.max(
    ...files.map(f => f.path.split('/').length),
    0
  );

  return {
    totalFiles,
    totalLOC,
    languageBreakdown,
    directoryDepth,
  };
}

// Made with Bob
