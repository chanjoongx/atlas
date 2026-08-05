/**
 * Backend-specific types for agent pipeline
 * Shared types are in src/types/index.ts
 */

import type {
  RepoManifest,
  RepoMetadata,
  FileNode,
  CodeStructure,
  ParsedFile,
  Dependency,
  RepoMetrics,
  FileType,
  LayoutData,
  LayoutNode,
  LayoutEdge,
  District,
  AnnotatedLayout,
  LayoutMeta,
  Highlight,
  Label
} from '../../src/types/index';

// Re-export shared types for convenience
export type {
  RepoManifest,
  RepoMetadata,
  FileNode,
  CodeStructure,
  ParsedFile,
  Dependency,
  RepoMetrics,
  FileType,
  LayoutData,
  LayoutNode,
  LayoutEdge,
  District,
  AnnotatedLayout,
  LayoutMeta,
  Highlight,
  Label
};

/**
 * Cloudflare Functions environment.
 *
 * Deliberately empty of anything the analysis path needs. The ingester reads
 * repositories from codeload, which serves public archives to anonymous
 * callers, so /api/analyze holds no credential and cannot be broken by one
 * expiring. GITHUB_TOKEN stays declared, and optional, only so a deployment
 * that still has the variable set keeps type checking; nothing reads it.
 */
export interface Env {
  GITHUB_TOKEN?: string;
}

/**
 * Input contract for Agent 1: Repo Ingester
 */
export interface IngesterInput {
  owner: string;
  repo: string;
  branch?: string;
}

/**
 * Error types for agent operations
 */
export interface AgentError {
  code: 'NOT_FOUND' | 'RATE_LIMIT' | 'AUTH_FAILED' | 'SERVER_ERROR' | 'REPO_TOO_LARGE' | 'INVALID_INPUT' | 'UNKNOWN';
  message: string;
  details?: unknown;
}

/**
 * Result type for agent operations
 */
export type AgentResult<T> = 
  | { success: true; data: T }
  | { success: false; error: AgentError };

/**
 * File extensions to exclude (binary files)
 */
export const BINARY_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.bmp', '.tiff', '.webp', '.svg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.mov', '.avi', '.wmv', '.flv', '.webm',
  '.exe', '.dll', '.so', '.dylib',
  '.bin', '.dat', '.db', '.sqlite',
  // Design documents. Their line count is a file size divided by a guess, and
  // hono's logo source was landing on the map as a 19,700 line tower, which
  // made a binary the tallest thing in the city.
  '.psd', '.ai', '.sketch', '.fig', '.xcf', '.pxm', '.pxd', '.afdesign', '.afphoto',
  // Compiled output that sometimes gets committed.
  '.wasm', '.pyc', '.pyo', '.class', '.jar', '.o', '.a', '.lib', '.pdb', '.node',
] as const;

/**
 * Files that are generated rather than written.
 *
 * A lockfile is real text and it is genuinely in the repository, so nothing
 * upstream filters it out, but it is a build artifact with a line count that
 * describes a dependency resolver rather than the software. Left in, shadcn/ui's
 * second tallest building was `pnpm-lock.yaml` and hono's third was `bun.lock`,
 * which is the opposite of what a map claiming to show "the code inside" is for.
 *
 * Matched on the whole file name, because none of these has an extension that
 * distinguishes it from files worth keeping.
 */
export const GENERATED_FILES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'deno.lock',
  'Cargo.lock',
  'composer.lock',
  'Gemfile.lock',
  'poetry.lock',
  'Pipfile.lock',
  'packages.lock.json',
  'pubspec.lock',
  'mix.lock',
  'flake.lock',
  'go.sum',
] as const;

/**
 * Directories to exclude
 */
export const EXCLUDED_DIRS = [
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'out',
  'coverage',
  '.cache',
  // Editor and coding agent configuration. Not the project's own code, and a
  // two file directory of tool settings does not deserve a district on a map
  // of the software.
  '.vscode',
  '.idea',
  '.claude',
  '.cursor',
  '.devcontainer',
  '.husky',
  '__pycache__',
  '.pytest_cache',
  'vendor',
  'target',
] as const;

// Made with Bob
