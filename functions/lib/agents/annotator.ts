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
const TOP_CORE_PERCENT = 0.1;        // Top 10% by inDegree
const TOP_HOTSPOT_PERCENT = 0.05;    // Top 5% by LOC
const MAX_HIGHLIGHTS = 50;           // Cap total highlights
const MAX_LABEL_LENGTH = 15;         // District label max length
const MAX_NODE_LABEL_LENGTH = 12;    // Node label max length
const TOP_SIZE_PERCENT = 0.1;        // Top 10% by visual size for node labels

/**
 * Node centrality metrics
 */
interface NodeCentrality {
  inDegree: number;   // How many files import this node
  outDegree: number;  // How many imports this node makes
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
 * Generate highlights for important nodes
 */
function generateHighlights(
  layout: LayoutData,
  structure: CodeStructure,
  centrality: Map<string, NodeCentrality>
): Highlight[] {
  const highlights: Highlight[] = [];
  const highlightedNodes = new Set<string>();

  // Create lookup map for parsed files
  const fileMap = new Map<string, ParsedFile>();
  for (const file of structure.files) {
    fileMap.set(file.path, file);
  }

  // 1. Always highlight entry points
  for (const node of layout.nodes) {
    const file = fileMap.get(node.id);
    if (file?.isEntryPoint) {
      highlights.push({
        nodeId: node.id,
        type: 'entry',
        reason: 'Entry point',
        intensity: 1.0
      });
      highlightedNodes.add(node.id);
    }
  }

  // 2. Highlight core nodes (top 10% by inDegree, excluding entries)
  const nonEntryNodes = layout.nodes.filter(node => !highlightedNodes.has(node.id));
  const sortedByInDegree = [...nonEntryNodes].sort((a, b) => {
    const aMetrics = centrality.get(a.id) || { inDegree: 0, outDegree: 0 };
    const bMetrics = centrality.get(b.id) || { inDegree: 0, outDegree: 0 };
    return bMetrics.inDegree - aMetrics.inDegree;
  });

  const coreCount = Math.ceil(sortedByInDegree.length * TOP_CORE_PERCENT);
  const coreNodes = sortedByInDegree.slice(0, coreCount);

  // Calculate max inDegree for normalization
  const maxInDegree = Math.max(
    ...coreNodes.map(node => centrality.get(node.id)?.inDegree || 0),
    1
  );

  for (const node of coreNodes) {
    const metrics = centrality.get(node.id);
    if (metrics && metrics.inDegree > 0) {
      const intensity = metrics.inDegree / maxInDegree;
      highlights.push({
        nodeId: node.id,
        type: 'core',
        reason: `Imported by ${metrics.inDegree} file${metrics.inDegree === 1 ? '' : 's'}`,
        intensity
      });
      highlightedNodes.add(node.id);
    }
  }

  // 3. Highlight hotspots (top 5% by LOC, excluding entries and cores)
  const remainingNodes = layout.nodes.filter(node => !highlightedNodes.has(node.id));
  const sortedByLOC = [...remainingNodes].sort((a, b) => 
    b.metadata.loc - a.metadata.loc
  );

  const hotspotCount = Math.ceil(sortedByLOC.length * TOP_HOTSPOT_PERCENT);
  const hotspotNodes = sortedByLOC.slice(0, hotspotCount);

  // Calculate max LOC for normalization
  const maxLOC = Math.max(
    ...hotspotNodes.map(node => node.metadata.loc),
    1
  );

  for (const node of hotspotNodes) {
    const intensity = node.metadata.loc / maxLOC;
    highlights.push({
      nodeId: node.id,
      type: 'hotspot',
      reason: `Largest source file (${node.metadata.loc} LOC)`,
      intensity
    });
    highlightedNodes.add(node.id);
  }

  // Cap at MAX_HIGHLIGHTS
  return highlights.slice(0, MAX_HIGHLIGHTS);
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