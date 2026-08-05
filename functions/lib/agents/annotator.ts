/**
 * Agent 4: Annotator
 * 
 * Adds highlights and labels to positioned layout for City Map visualization.
 * Calculates node centrality and identifies important nodes (entry points, core modules, hotspots).
 * 
 * Complexity: S (Small) - Simple graph metrics and rule-based labeling
 */

import type {
  LayoutData,
  CodeStructure,
  AnnotatedLayout,
  Highlight,
  Label,
  LayoutNode,
  ParsedFile,
  AgentResult
} from '../types';

/**
 * Configuration constants for annotation
 */
const TOP_CORE_PERCENT = 0.1;        // Core candidates: top 10% by inDegree
const TOP_HOTSPOT_PERCENT = 0.05;    // Hotspot candidates: top 5% by LOC
const MAX_HIGHLIGHTS = 50;           // Cap total highlights
const MAX_LABEL_LENGTH = 15;         // District label max length
const MAX_NODE_LABEL_LENGTH = 12;    // Node label max length
const TOP_SIZE_PERCENT = 0.1;        // Top 10% by visual size for node labels

/**
 * Per kind highlight quotas.
 *
 * A single shared cap let entry points consume every slot on large repos, so
 * maps came back with 50 landmarks that were all the same colour. Each kind now
 * gets its own budget, and any budget a kind cannot use is handed to the other
 * kinds instead of being wasted. The three quotas add up to MAX_HIGHLIGHTS.
 */
const MAX_ENTRY_HIGHLIGHTS = 12;
const MAX_CORE_HIGHLIGHTS = 22;
const MAX_HOTSPOT_HIGHLIGHTS = 16;

/**
 * Node centrality metrics
 */
interface NodeCentrality {
  inDegree: number;   // How many files import this node
  outDegree: number;  // How many imports this node makes
}

/**
 * Highlight counts per kind, used for both availability and allocation
 */
export interface HighlightQuota {
  entry: number;
  core: number;
  hotspot: number;
}

/**
 * Annotate layout with highlights and labels
 * 
 * @param layout - Positioned layout from Agent 3
 * @param structure - Code structure from Agent 2 (for centrality and entry points)
 * @returns Promise<AgentResult<AnnotatedLayout>>
 */
export async function annotateLayout(
  layout: LayoutData,
  structure: CodeStructure
): Promise<AgentResult<AnnotatedLayout>> {
  try {
    // Handle empty layout gracefully
    if (layout.nodes.length === 0) {
      return {
        success: true,
        data: {
          ...layout,
          highlights: [],
          labels: []
        }
      };
    }

    // Calculate centrality for all nodes
    const centrality = calculateCentrality(layout);

    // Generate highlights
    const highlights = generateHighlights(layout, structure, centrality);

    // Generate labels
    const labels = generateLabels(layout, structure);

    return {
      success: true,
      data: {
        ...layout,
        highlights,
        labels
      }
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to annotate layout',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    };
  }
}

/**
 * Calculate in-degree and out-degree centrality for all nodes
 */
function calculateCentrality(layout: LayoutData): Map<string, NodeCentrality> {
  const centrality = new Map<string, NodeCentrality>();

  // Initialize all nodes with zero centrality
  for (const node of layout.nodes) {
    centrality.set(node.id, { inDegree: 0, outDegree: 0 });
  }

  // Count degrees from edges
  for (const edge of layout.edges) {
    const sourceMetrics = centrality.get(edge.source);
    const targetMetrics = centrality.get(edge.target);

    if (sourceMetrics) {
      sourceMetrics.outDegree++;
    }
    if (targetMetrics) {
      targetMetrics.inDegree++;
    }
  }

  return centrality;
}

/**
 * Generate highlights for important nodes.
 *
 * Each kind draws from its own ranked candidate pool and its own quota, so a
 * map shows a mix of landmarks instead of 50 of whichever kind happens to come
 * first.
 */
function generateHighlights(
  layout: LayoutData,
  structure: CodeStructure,
  centrality: Map<string, NodeCentrality>
): Highlight[] {
  // Create lookup map for parsed files
  const fileMap = new Map<string, ParsedFile>();
  for (const file of structure.files) {
    fileMap.set(file.path, file);
  }

  // 1. Entry point candidates, shallowest first
  const entryPool = layout.nodes
    .filter(node => fileMap.get(node.id)?.isEntryPoint === true)
    .sort((a, b) => {
      const depthDiff = a.id.split('/').length - b.id.split('/').length;
      if (depthDiff !== 0) {
        return depthDiff;
      }
      return a.id.localeCompare(b.id);
    });

  const entryIds = new Set(entryPool.map(node => node.id));

  // 2. Core candidates: most imported files (top 10% by inDegree), excluding entries
  const importedNodes = layout.nodes
    .filter(node => !entryIds.has(node.id) && (centrality.get(node.id)?.inDegree ?? 0) > 0)
    .sort((a, b) => {
      const degreeDiff =
        (centrality.get(b.id)?.inDegree ?? 0) - (centrality.get(a.id)?.inDegree ?? 0);
      if (degreeDiff !== 0) {
        return degreeDiff;
      }
      return a.id.localeCompare(b.id);
    });

  const corePool = importedNodes.slice(
    0,
    Math.max(1, Math.ceil(importedNodes.length * TOP_CORE_PERCENT))
  );
  const coreIds = new Set(corePool.map(node => node.id));

  // 3. Hotspot candidates: largest remaining files (top 5% by LOC)
  const remainingNodes = layout.nodes
    .filter(node => !entryIds.has(node.id) && !coreIds.has(node.id))
    .sort((a, b) => {
      const locDiff = b.metadata.loc - a.metadata.loc;
      if (locDiff !== 0) {
        return locDiff;
      }
      return a.id.localeCompare(b.id);
    });

  const hotspotPool = remainingNodes.slice(
    0,
    Math.max(1, Math.ceil(remainingNodes.length * TOP_HOTSPOT_PERCENT))
  );

  // Split the highlight budget across the three kinds
  const allocation = allocateHighlightQuotas({
    entry: entryPool.length,
    core: corePool.length,
    hotspot: hotspotPool.length
  });

  const entryNodes = entryPool.slice(0, allocation.entry);
  const coreNodes = corePool.slice(0, allocation.core);
  const hotspotNodes = hotspotPool.slice(0, allocation.hotspot);

  const highlights: Highlight[] = [];

  for (const node of entryNodes) {
    highlights.push({
      nodeId: node.id,
      type: 'entry',
      reason: 'Entry point',
      intensity: 1.0
    });
  }

  // Normalize against the selected nodes so intensity stays within [0, 1]
  const maxInDegree = Math.max(
    ...coreNodes.map(node => centrality.get(node.id)?.inDegree ?? 0),
    1
  );

  for (const node of coreNodes) {
    const inDegree = centrality.get(node.id)?.inDegree ?? 0;
    highlights.push({
      nodeId: node.id,
      type: 'core',
      reason: `Imported by ${inDegree} file${inDegree === 1 ? '' : 's'}`,
      intensity: inDegree / maxInDegree
    });
  }

  const maxLOC = Math.max(
    ...hotspotNodes.map(node => node.metadata.loc),
    1
  );

  for (const node of hotspotNodes) {
    highlights.push({
      nodeId: node.id,
      type: 'hotspot',
      reason: `Largest source file (${node.metadata.loc} LOC)`,
      intensity: node.metadata.loc / maxLOC
    });
  }

  return highlights;
}

/**
 * Split the highlight budget across the three highlight kinds.
 *
 * Each kind first takes up to its own quota. Whatever is left over, either
 * because a kind ran out of candidates or because its quota was larger than its
 * pool, is handed round robin to the kinds that still have candidates, starting
 * with core (the most informative landmark) and ending with entry.
 *
 * @param available Number of candidates each kind can offer
 * @returns Number of highlights to emit per kind, never more than MAX_HIGHLIGHTS in total
 */
export function allocateHighlightQuotas(available: HighlightQuota): HighlightQuota {
  const allocated: HighlightQuota = {
    entry: Math.min(available.entry, MAX_ENTRY_HIGHLIGHTS),
    core: Math.min(available.core, MAX_CORE_HIGHLIGHTS),
    hotspot: Math.min(available.hotspot, MAX_HOTSPOT_HIGHLIGHTS)
  };

  const fillOrder: Array<keyof HighlightQuota> = ['core', 'hotspot', 'entry'];
  let total = allocated.entry + allocated.core + allocated.hotspot;

  // Hand out the leftover budget one slot at a time
  let progressed = true;
  while (total < MAX_HIGHLIGHTS && progressed) {
    progressed = false;

    for (const kind of fillOrder) {
      if (total >= MAX_HIGHLIGHTS) {
        break;
      }
      if (allocated[kind] >= available[kind]) {
        continue;
      }
      allocated[kind] += 1;
      total += 1;
      progressed = true;
    }
  }

  return allocated;
}

/**
 * Generate labels for districts and selected nodes
 */
function generateLabels(
  layout: LayoutData,
  structure: CodeStructure
): Label[] {
  const labels: Label[] = [];

  // Create lookup map for parsed files
  const fileMap = new Map<string, ParsedFile>();
  for (const file of structure.files) {
    fileMap.set(file.path, file);
  }

  // 1. District labels (one per district)
  for (const district of layout.districts) {
    if (district.nodes.length > 0) {
      const anchorNodeId = district.nodes[0];
      const truncatedName = truncateText(district.name, MAX_LABEL_LENGTH);
      
      labels.push({
        nodeId: anchorNodeId,
        text: truncatedName,
        position: 'top'
      });
    }
  }

  // 2. Node labels (selective: entry points + top 10% by visual size)
  const labeledNodes = new Set<string>();

  // Label all entry points
  for (const node of layout.nodes) {
    const file = fileMap.get(node.id);
    if (file?.isEntryPoint) {
      const fileName = getFileNameWithoutExtension(node.id);
      const truncatedName = truncateText(fileName, MAX_NODE_LABEL_LENGTH);
      const position = determineNodeLabelPosition(node, layout);
      
      labels.push({
        nodeId: node.id,
        text: truncatedName,
        position
      });
      labeledNodes.add(node.id);
    }
  }

  // Label top 10% by visual size (width * height)
  const nonLabeledNodes = layout.nodes.filter(node => !labeledNodes.has(node.id));
  const sortedBySize = [...nonLabeledNodes].sort((a, b) => {
    const aSize = a.width * a.height;
    const bSize = b.width * b.height;
    return bSize - aSize;
  });

  const topSizeCount = Math.ceil(sortedBySize.length * TOP_SIZE_PERCENT);
  const topSizeNodes = sortedBySize.slice(0, topSizeCount);

  for (const node of topSizeNodes) {
    const fileName = getFileNameWithoutExtension(node.id);
    const truncatedName = truncateText(fileName, MAX_NODE_LABEL_LENGTH);
    const position = determineNodeLabelPosition(node, layout);
    
    labels.push({
      nodeId: node.id,
      text: truncatedName,
      position
    });
  }

  return labels;
}

/**
 * Truncate text to max length with ellipsis
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 1) + '…';
}

/**
 * Extract filename without extension from path
 */
function getFileNameWithoutExtension(path: string): string {
  const parts = path.split('/');
  const fileName = parts[parts.length - 1];
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
}

/**
 * Determine optimal label position based on node location
 */
function determineNodeLabelPosition(
  node: LayoutNode,
  layout: LayoutData
): 'top' | 'bottom' | 'left' | 'right' {
  const canvasWidth = layout.bounds.width;
  const canvasHeight = layout.bounds.height;

  // Top if node is in upper 20% of canvas
  if (node.y < canvasHeight * 0.2) {
    return 'top';
  }

  // Left if node is in right 20% of canvas
  if (node.x > canvasWidth * 0.8) {
    return 'left';
  }

  // Default to right
  return 'right';
}

// Made with Bob