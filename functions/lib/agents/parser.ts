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
 * Entry point file patterns
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
 * Agent 2: Structure Parser
 * 
 * Extracts code structure, dependencies, and metrics from file tree.
 * Fetches content only for entry points and top-level source files.
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

    // Classify and parse files
    const parsedFiles: ParsedFile[] = [];
    const dependencies: Dependency[] = [];

    // Identify files to fetch content for
    const filesToFetch = identifyFilesToFetch(files);

    // Fetch content for selected files
    const fileContents = await fetchFileContents(
      filesToFetch,
      input.owner,
      input.repo,
      octokit
    );

    // Process each file
    for (const file of files) {
      const parsedFile = await parseFile(file, fileContents.get(file.path));
      parsedFiles.push(parsedFile);

      // Extract dependencies if content is available
      if (fileContents.has(file.path)) {
        const content = fileContents.get(file.path)!;
        const fileDeps = extractDependencies(file.path, content, parsedFile.language);
        dependencies.push(...fileDeps);
      }
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
 * Identify which files to fetch content for (entry points + top-level source files)
 */
function identifyFilesToFetch(files: FileNode[]): FileNode[] {
  const toFetch: FileNode[] = [];

  for (const file of files) {
    // Always fetch package.json
    if (file.path === 'package.json') {
      toFetch.push(file);
      continue;
    }

    // Check if it's an entry point
    if (isEntryPoint(file.path)) {
      toFetch.push(file);
      continue;
    }

    // Fetch top-level source files (src/*.{ts,tsx,js,jsx}, max depth 2)
    const pathParts = file.path.split('/');
    if (pathParts.length <= 2 && pathParts[0] === 'src') {
      const ext = getFileExtension(file.path);
      if (ext && ['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
        toFetch.push(file);
      }
    }
  }

  return toFetch;
}

/**
 * Fetch file contents from GitHub blob API
 */
async function fetchFileContents(
  files: FileNode[],
  owner: string,
  repo: string,
  octokit: Octokit
): Promise<Map<string, string>> {
  const contents = new Map<string, string>();

  // Fetch in parallel with error handling per file
  await Promise.all(
    files.map(async (file) => {
      try {
        const response = await octokit.rest.git.getBlob({
          owner,
          repo,
          file_sha: file.sha,
        });

        // Decode base64 content
        const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
        contents.set(file.path, content);
      } catch (error) {
        // Log error but continue (partial results better than failure)
        console.warn(`Failed to fetch content for ${file.path}:`, error);
      }
    })
  );

  return contents;
}

/**
 * Parse a single file into ParsedFile structure
 */
async function parseFile(file: FileNode, content?: string): Promise<ParsedFile> {
  const language = detectLanguage(file.path);
  const type = classifyFileType(file.path);
  const isEntry = isEntryPoint(file.path);

  // Calculate LOC
  let loc: number;
  if (content) {
    // Actual line count from content
    loc = content.split('\n').length;
  } else {
    // Estimate from file size (35 bytes per line average)
    loc = Math.max(Math.floor(file.size / 35), 1);
  }

  return {
    path: file.path,
    type,
    language,
    loc,
    imports: [], // Will be populated by extractDependencies
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
 * Check if file is an entry point
 */
function isEntryPoint(path: string): boolean {
  return ENTRY_POINT_PATTERNS.some(pattern => path === pattern || path.endsWith(`/${pattern}`));
}

/**
 * Extract file extension from path
 */
function getFileExtension(path: string): string | null {
  const match = path.match(/\.([^.]+)$/);
  return match ? `.${match[1].toLowerCase()}` : null;
}

/**
 * Extract dependencies (imports) from file content
 */
function extractDependencies(
  filePath: string,
  content: string,
  language: string
): Dependency[] {
  const dependencies: Dependency[] = [];

  if (language === 'typescript' || language === 'javascript') {
    // ES6 import statements: import ... from '...'
    const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      const resolvedPath = resolveImportPath(filePath, importPath);
      if (resolvedPath) {
        dependencies.push({
          from: filePath,
          to: resolvedPath,
          type: 'import',
        });
      }
    }

    // Dynamic imports: import('...')
    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicImportRegex.exec(content)) !== null) {
      const importPath = match[1];
      const resolvedPath = resolveImportPath(filePath, importPath);
      if (resolvedPath) {
        dependencies.push({
          from: filePath,
          to: resolvedPath,
          type: 'dynamic',
        });
      }
    }

    // CommonJS require: require('...')
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
      const importPath = match[1];
      const resolvedPath = resolveImportPath(filePath, importPath);
      if (resolvedPath) {
        dependencies.push({
          from: filePath,
          to: resolvedPath,
          type: 'import',
        });
      }
    }
  }

  return dependencies;
}

/**
 * Resolve relative import paths to absolute paths within repo
 * Returns null for external packages (bare specifiers)
 */
function resolveImportPath(fromPath: string, importPath: string): string | null {
  // Filter out external packages (bare specifiers like 'react', 'lodash')
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    return null;
  }

  // Get directory of the importing file
  const fromDir = fromPath.split('/').slice(0, -1).join('/');

  // Resolve relative path
  let resolvedPath: string;
  if (importPath.startsWith('./') || importPath.startsWith('../')) {
    // Relative import
    const parts = fromDir.split('/');
    const importParts = importPath.split('/');

    for (const part of importParts) {
      if (part === '..') {
        parts.pop();
      } else if (part !== '.') {
        parts.push(part);
      }
    }

    resolvedPath = parts.join('/');
  } else if (importPath.startsWith('/')) {
    // Absolute import (from repo root)
    resolvedPath = importPath.slice(1);
  } else {
    // Shouldn't happen, but handle gracefully
    return null;
  }

  // Add common extensions if missing
  if (!getFileExtension(resolvedPath)) {
    // Try common extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.json'];
    for (const ext of extensions) {
      // For now, just append .ts as default (we don't have file system access to check)
      resolvedPath += '.ts';
      break;
    }
  }

  return resolvedPath;
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