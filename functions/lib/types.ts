/**
 * Backend-specific types for agent pipeline
 * Shared types are in src/types/index.ts
 */

import type {
  RepoManifest,
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
