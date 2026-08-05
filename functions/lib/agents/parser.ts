import type { FileNode, CodeStructure, ParsedFile, Dependency, RepoMetrics, FileType, AgentResult } from '../types';

/**
 * Input contract for Agent 2: Structure Parser
 *
 * The parser fetches nothing. Both the tree and the file contents arrive from
 * the ingester, which reads them out of a single repository archive.
 */
export interface ParserInput {
  tree: FileNode[];
  /** Decoded text, keyed by repo relative path. Missing entries were skipped. */
  contents: ReadonlyMap<string, string>;
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
 * Extensions probed, in order, when an import specifier omits its extension.
 */
export const RESOLUTION_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.d.ts'];

/**
 * How a TypeScript file is spelled in a modern ESM import.
 *
 * Under NodeNext resolution an import must name the file that will be *emitted*,
 * so a `.ts` module is imported as `./core/Ky.js`. That is not a quirk of one
 * project, it is what TypeScript requires of every package that sets
 * `"moduleResolution": "NodeNext"`, which is most new ones.
 *
 * Without this mapping such a repository resolves nothing at all: every import
 * points at a `.js` file that does not exist in the source tree, so the map
 * comes back with zero dependency arcs. sindresorhus/ky is 65 files and drew
 * none of them.
 */
const EMITTED_TO_SOURCE: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['.js', ['.ts', '.tsx', '.d.ts']],
  ['.jsx', ['.tsx']],
  ['.mjs', ['.mts', '.d.mts']],
  ['.cjs', ['.cts', '.d.cts']],
];

/**
 * Most entry points a single repository may claim. Without a cap a monorepo
 * turns every package index into a landmark and drowns out everything else.
 */
export const MAX_ENTRY_POINTS = 20;

/**
 * Most tsconfig files read for path aliases, and how deep they may live.
 *
 * The ingester retains every tsconfig it meets, cheaply. This is the narrower
 * question of which ones are allowed to define aliases: one belonging to a real
 * package root, near the top of the tree. A tsconfig buried in a test fixture
 * describes that fixture, not the repository.
 */
const MAX_ALIAS_CONFIGS = 8;
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
 * Extracts code structure, dependencies, and metrics from a file tree and the
 * file contents the ingester already read. Every import is resolved against the
 * real file tree, so an edge is only emitted when its target actually exists in
 * the repo.
 *
 * @param input File tree and the contents that came with it
 * @returns CodeStructure with parsed files, dependencies, and metrics
 */
export async function parseStructure(input: ParserInput): Promise<AgentResult<CodeStructure>> {
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
    const fileContents = input.contents;

    // Entry points are resolved against real package roots, then capped
    const packageRoots = collectPackageRoots(filePaths);
    const entryPoints = selectEntryPoints(files, packageRoots);

    // Path aliases (optional signal, silently skipped when tsconfig is unreadable)
    const aliasRules = buildAliasRules(selectAliasConfigs(files, packageRoots), fileContents);

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
 * Select the tsconfig files allowed to define path aliases.
 *
 * A tsconfig only governs its own directory, so the candidates are the repo
 * root and real package roots near the top of the tree, shallowest first. The
 * cap keeps a monorepo with a hundred packages from turning alias resolution
 * into a hundred rule sets consulted for every bare specifier.
 *
 * @param files Every file in the repository
 * @param packageRoots Directories that own a package
 * @returns Paths of the tsconfig files to read, shallowest first
 */
function selectAliasConfigs(files: FileNode[], packageRoots: ReadonlySet<string>): string[] {
  return files
    .filter(file => isAliasConfigCandidate(file, packageRoots))
    .map(file => file.path)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    .slice(0, MAX_ALIAS_CONFIGS);
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

  // An emitted extension standing in for a source one, before trying to append
  // anything: `./core/Ky.js` is how `./core/Ky.ts` has to be written under
  // NodeNext. A real `.js` file of the same name still wins, because the exact
  // match above is tested first.
  for (const [emitted, sources] of EMITTED_TO_SOURCE) {
    if (!base.endsWith(emitted)) {
      continue;
    }
    const stem = base.slice(0, -emitted.length);
    for (const ext of sources) {
      const candidate = `${stem}${ext}`;
      if (filePaths.has(candidate)) {
        return candidate;
      }
    }
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
 * Build path alias rules from the selected tsconfig files.
 * Any tsconfig that is missing or fails to parse is skipped: aliases are a
 * bonus signal, and relative import resolution does not depend on them.
 *
 * @param configPaths Tsconfig paths allowed to define aliases
 * @param contents File contents from the ingester
 * @returns Alias rules, most specific scope first
 */
function buildAliasRules(configPaths: readonly string[], contents: ReadonlyMap<string, string>): AliasRule[] {
  const rules: AliasRule[] = [];

  for (const path of configPaths) {
    const text = contents.get(path);
    if (text === undefined) {
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
