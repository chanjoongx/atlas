// Core data structures shared between frontend and backend

export interface RepoManifest {
  metadata: RepoMetadata;
  tree: FileNode[];
  /** Decoded text for every file worth parsing. Absent entries were skipped. */
  contents: Map<string, string>;
}

export interface RepoMetadata {
  owner: string;
  repo: string;
  /** Ref that was requested. `HEAD` when the caller did not name a branch. */
  branch: string;
  /**
   * Ref the archive was actually cut at, read from its root directory.
   * Evidence from the archive rather than from the request.
   */
  resolvedRef?: string;
  /**
   * Commit the archive was cut from. Present only when the caller asked for a
   * commit: GitHub names the archive root after the ref it was given, so a
   * branch or HEAD request never reveals the commit it resolved to.
   */
  commitSha?: string;
  /** True when a read budget stopped the ingest before the archive ended. */
  truncated?: boolean;
  /**
   * These three came from the GitHub REST API, which the ingester no longer
   * calls: the repository now arrives as one anonymous archive download. They
   * were never rendered anywhere, so they are left absent rather than paying a
   * rate limited request for them, and stay declared so a layout cached before
   * the change still deserialises.
   */
  defaultBranch?: string;
  description?: string;
  stars?: number;
  lastCommitDate?: string;
}

export interface FileNode {
  path: string;
  type: 'file' | 'dir';
  size: number;
  /**
   * Git blob name. A tar archive does not carry one, so the ingester leaves it
   * absent; nothing downstream reads it now that content arrives with the tree.
   */
  sha?: string;
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
  // Optional: cached layouts written before this field existed still deserialise
  meta?: LayoutMeta;
}

/**
 * Repository statistics that accompany a generated layout.
 * Produced by the API pipeline, not by the layout or annotator agents.
 */
export interface LayoutMeta {
  owner: string;
  repo: string;
  branch: string;
  /** Commit the archive was cut from, when the request named one. */
  commitSha?: string;
  /**
   * True when a read budget stopped the ingest early, so the counts below
   * describe part of the repository rather than all of it.
   */
  truncated: boolean;
  totalFiles: number;      // Files in the repo the parser saw, not just rendered nodes
  renderedNodes: number;   // Nodes that survived selection
  totalLOC: number;
  languageBreakdown: Record<string, number>;
  edgeCount: number;
  droppedEdges: number;
  generatedAt: string;     // ISO 8601
  /** No longer produced. Present on layouts cached before the REST ingester was removed. */
  description?: string;
  stars?: number;
  lastCommitDate?: string;
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
