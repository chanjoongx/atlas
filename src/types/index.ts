// Core data structures shared between frontend and backend

export interface RepoManifest {
  metadata: RepoMetadata;
  tree: FileNode[];
}

export interface RepoMetadata {
  owner: string;
  repo: string;
  branch: string;
  defaultBranch: string;
  description: string;
  stars: number;
  lastCommitDate: string;
}

export interface FileNode {
  path: string;
  type: 'file' | 'dir';
  size: number;
  sha: string;
}

export interface CodeStructure {
  files: ParsedFile[];
  dependencies: Dependency[];
  metrics: RepoMetrics;
}

export interface ParsedFile {
  path: string;
  type: FileType;
  language: string;
  loc: number;
  imports: string[];
  exports: string[];
  isEntryPoint: boolean;
}

export interface Dependency {
  from: string;
  to: string;
  type: 'import' | 'dynamic';
}

export interface RepoMetrics {
  totalFiles: number;
  totalLOC: number;
  languageBreakdown: Record<string, number>;
  directoryDepth: number;
}

export type FileType = 'source' | 'test' | 'config' | 'docs' | 'asset';

export interface LayoutData {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  districts: District[];
  bounds: { width: number; height: number };
}

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: FileType;
  label: string;
  metadata: {
    path: string;
    loc: number;
    language: string;
  };
}

export interface LayoutEdge {
  source: string;
  target: string;
  strength: number;
}

export interface District {
  name: string;
  nodes: string[];
  bounds: { x: number; y: number; width: number; height: number };
  color: string;
}

export interface AnnotatedLayout extends LayoutData {
  highlights: Highlight[];
  labels: Label[];
}

export interface Highlight {
  nodeId: string;
  type: 'core' | 'entry' | 'hotspot';
  reason: string;
  intensity: number;
}

export interface Label {
  nodeId: string;
  text: string;
  position: 'top' | 'bottom' | 'left' | 'right';
}

// Made with Bob
