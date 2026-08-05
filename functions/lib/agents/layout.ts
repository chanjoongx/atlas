/**
 * Agent 3: Layout Engine
 * 
 * Transforms CodeStructure into positioned LayoutData for D3 rendering.
 * Uses force-directed simulation to position nodes on a 2D canvas.
 * 
 * Complexity: L (Large) - Force simulation with district clustering
 */

import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum,
  type SimulationLinkDatum
} from 'd3-force';
import { scaleSqrt, scaleOrdinal } from 'd3-scale';
import { schemeTableau10 } from 'd3-scale-chromatic';
import type {
  CodeStructure,
  Dependency,
  LayoutData,
  LayoutNode,
  LayoutEdge,
  District,
  ParsedFile,
  FileType,
  AgentResult
} from '../types';

/**
 * Configuration for layout generation
 */
export interface LayoutConfig {
  canvasWidth?: number;
  canvasHeight?: number;
  maxNodes?: number;
}

/**
 * Constants for layout algorithm
 */
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const MAX_NODES = 500;
const FORCE_REPULSION = -100;
const FORCE_LINK_DISTANCE = 50;
const FORCE_COLLISION_PADDING = 4;
const SIMULATION_TICKS = 300;
const MIN_NODE_SIZE = 20;
const MAX_NODE_WIDTH = 60;
const MAX_NODE_HEIGHT = 100;
const ENTRY_POINT_SCALE = 1.5;
const TEST_FILE_SCALE = 0.7;
const CONFIG_FILE_SCALE = 0.8;
const BOUNDS_PADDING = 50;

/**
 * Hard ceiling on rendered edges.
 *
 * A 500 node map stays readable up to roughly this many links; past it the
 * force layout collapses into a hairball. Edges beyond the cap are dropped
 * lowest value first and the drop count is reported to the caller.
 */
export const MAX_RENDERED_EDGES = 1500;

/**
 * Result of edge selection: the edges that will be drawn plus how many
 * renderable edges the cap discarded.
 */
export interface EdgeSelection {
  edges: LayoutEdge[];
  dropped: number;
}

/**
 * Internal node type for D3 simulation
 */
interface SimNode extends SimulationNodeDatum {
  id: string;
  path: string;
  type: FileType;
  loc: number;
  language: string;
  width: number;
  height: number;
  district: string;
  isEntryPoint: boolean;
}

/**
 * Internal edge type for D3 simulation
 */
interface SimEdge extends SimulationLinkDatum<SimNode> {
  strength: number;
}

/**
 * Generate layout data from code structure
 */
export async function generateLayout(
  structure: CodeStructure,
  config: LayoutConfig = {}
): Promise<AgentResult<LayoutData>> {
  try {
    const canvasWidth = config.canvasWidth ?? CANVAS_WIDTH;
    const canvasHeight = config.canvasHeight ?? CANVAS_HEIGHT;
    const maxNodes = config.maxNodes ?? MAX_NODES;

    // Step 1: Prioritize and select nodes
    const selectedFiles = prioritizeFiles(structure.files, maxNodes);

    if (selectedFiles.length === 0) {
      // Empty structure - return empty layout
      return {
        success: true,
        data: {
          nodes: [],
          edges: [],
          districts: [],
          bounds: { width: 0, height: 0 }
        }
      };
    }

    // Step 2: Create simulation nodes with sizing
    const simNodes = createSimulationNodes(selectedFiles);

    // Step 3: Calculate districts and anchor positions
    const districtMap = calculateDistricts(simNodes);
    const districtAnchors = calculateDistrictAnchors(
      districtMap,
      canvasWidth,
      canvasHeight
    );

    // Step 4: Create edges (filter to only selected nodes)
    const selectedPaths = new Set(selectedFiles.map(f => f.path));
    const simEdges = createSimulationEdges(structure.dependencies, selectedPaths);

    // Step 5: Run force simulation
    runForceSimulation(
      simNodes,
      simEdges,
      districtAnchors,
      canvasWidth,
      canvasHeight
    );

    // Step 6: Convert to output format
    const nodes = simNodes.map(convertToLayoutNode);
    const edges = simEdges.map(convertToLayoutEdge);
    const districts = createDistricts(districtMap, simNodes);

    // Step 7: Calculate bounds and scale if needed
    const bounds = calculateBounds(nodes, canvasWidth, canvasHeight);

    return {
      success: true,
      data: {
        nodes,
        edges,
        districts,
        bounds
      }
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to generate layout',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    };
  }
}

/**
 * Prioritize files to fit within node limit
 */
function prioritizeFiles(files: ParsedFile[], maxNodes: number): ParsedFile[] {
  // Separate files by type
  const entryPoints = files.filter(f => f.isEntryPoint);
  const sourceFiles = files.filter(f => f.type === 'source' && !f.isEntryPoint);
  const testFiles = files.filter(f => f.type === 'test');
  const configFiles = files.filter(f => f.type === 'config');
  const docFiles = files.filter(f => f.type === 'docs');
  // Skip asset files entirely

  // If total is within limit, use all (except assets)
  const nonAssetFiles = [...entryPoints, ...sourceFiles, ...testFiles, ...configFiles, ...docFiles];
  if (nonAssetFiles.length <= maxNodes) {
    return nonAssetFiles;
  }

  // Prioritization strategy:
  // 1. All entry points (always include)
  // 2. Top source files by score (LOC + path quality)
  // 3. Sample remaining proportionally

  const selected: ParsedFile[] = [...entryPoints];
  let remaining = maxNodes - selected.length;

  if (remaining <= 0) {
    return selected;
  }

  // Score function to prioritize core components over examples/legacy
  function scoreFile(file: ParsedFile): number {
    let score = Math.sqrt(file.loc);  // Dampen LOC influence

    const path = file.path.toLowerCase();
    // Penalties
    if (path.includes('example') || path.includes('examples/')) score -= 50;
    if (path.includes('test') || path.includes('spec')) score -= 30;
    if (path.includes('fixture') || path.includes('mock')) score -= 30;
    if (path.includes('__')) score -= 20;
    if (path.includes('legacy') || path.includes('deprecated')) score -= 40;

    // Bonus: short filename (likely core component)
    const fileName = path.split('/').pop() || '';
    if (fileName.length < 15) score += 10;

    // Bonus: shallow path (top-level)
    const depth = file.path.split('/').length;
    if (depth <= 3) score += 15;

    return score;
  }

  // Sort source files by score (descending)
  const sortedSource = [...sourceFiles].sort((a, b) => scoreFile(b) - scoreFile(a));

  // Take top source files
  const sourceToTake = Math.min(remaining, sortedSource.length);
  selected.push(...sortedSource.slice(0, sourceToTake));
  remaining -= sourceToTake;

  if (remaining <= 0) {
    return selected;
  }

  // Distribute remaining slots proportionally
  const otherFiles = [...configFiles, ...testFiles, ...docFiles];
  if (otherFiles.length > 0) {
    // Group by directory for balanced sampling
    const byDirectory = new Map<string, ParsedFile[]>();
    for (const file of otherFiles) {
      const dir = getTopLevelDirectory(file.path);
      if (!byDirectory.has(dir)) {
        byDirectory.set(dir, []);
      }
      byDirectory.get(dir)!.push(file);
    }

    // Sample proportionally from each directory
    const dirs = Array.from(byDirectory.keys());
    let idx = 0;
    while (remaining > 0 && selected.length < maxNodes) {
      const dir = dirs[idx % dirs.length];
      const dirFiles = byDirectory.get(dir)!;
      if (dirFiles.length > 0) {
        selected.push(dirFiles.shift()!);
        remaining--;
      }
      idx++;
      
      // Stop if all directories are empty
      if (Array.from(byDirectory.values()).every(arr => arr.length === 0)) {
        break;
      }
    }
  }

  return selected;
}

/**
 * Create simulation nodes with proper sizing
 */
function createSimulationNodes(files: ParsedFile[]): SimNode[] {
  // Create scale for node sizing based on LOC
  const locValues = files.map(f => f.loc);
  const minLoc = Math.min(...locValues, 1);
  const maxLoc = Math.max(...locValues, 1);

  const widthScale = scaleSqrt()
    .domain([minLoc, maxLoc])
    .range([MIN_NODE_SIZE, MAX_NODE_WIDTH]);

  const heightScale = scaleSqrt()
    .domain([minLoc, maxLoc])
    .range([MIN_NODE_SIZE, MAX_NODE_HEIGHT]);

  return files.map(file => {
    let width = widthScale(file.loc);
    let height = heightScale(file.loc);

    // Apply type-based scaling
    if (file.isEntryPoint) {
      width *= ENTRY_POINT_SCALE;
      height *= ENTRY_POINT_SCALE;
    } else if (file.type === 'test') {
      width *= TEST_FILE_SCALE;
      height *= TEST_FILE_SCALE;
    } else if (file.type === 'config' || file.type === 'docs') {
      width *= CONFIG_FILE_SCALE;
      height *= CONFIG_FILE_SCALE;
    }

    return {
      id: file.path,
      path: file.path,
      type: file.type,
      loc: file.loc,
      language: file.language,
      width: Math.max(MIN_NODE_SIZE, width),
      height: Math.max(MIN_NODE_SIZE, height),
      district: getTopLevelDirectory(file.path),
      isEntryPoint: file.isEntryPoint,
      x: 0,
      y: 0
    };
  });
}

/**
 * Get top-level directory from path
 */
function getTopLevelDirectory(path: string): string {
  const parts = path.split('/');
  if (parts.length === 1) {
    return 'root';
  }
  return parts[0];
}

/**
 * Calculate districts from nodes
 */
function calculateDistricts(nodes: SimNode[]): Map<string, SimNode[]> {
  const districts = new Map<string, SimNode[]>();
  
  for (const node of nodes) {
    if (!districts.has(node.district)) {
      districts.set(node.district, []);
    }
    districts.get(node.district)!.push(node);
  }

  return districts;
}

/**
 * Calculate anchor positions for districts in a grid layout
 */
function calculateDistrictAnchors(
  districts: Map<string, SimNode[]>,
  canvasWidth: number,
  canvasHeight: number
): Map<string, { x: number; y: number }> {
  const anchors = new Map<string, { x: number; y: number }>();
  const districtNames = Array.from(districts.keys());
  const numDistricts = districtNames.length;

  if (numDistricts === 0) {
    return anchors;
  }

  // Calculate grid dimensions
  const cols = Math.ceil(Math.sqrt(numDistricts));
  const rows = Math.ceil(numDistricts / cols);

  const cellWidth = canvasWidth / cols;
  const cellHeight = canvasHeight / rows;

  districtNames.forEach((name, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    
    anchors.set(name, {
      x: (col + 0.5) * cellWidth,
      y: (row + 0.5) * cellHeight
    });
  });

  return anchors;
}

/**
 * Select the dependency edges that can be drawn for a set of nodes.
 *
 * Both endpoints have to be rendered nodes, and the result is capped at
 * MAX_RENDERED_EDGES. When the cap bites, the budget is split across targets in
 * proportion to how often each one is imported, and inside a target static
 * imports are kept ahead of dynamic ones.
 *
 * Proportional rather than ranked, and the difference is the whole point.
 * Ranking every edge by its target's in-degree sounds like it preserves hub
 * structure, and it destroys it: on drizzle-orm the 1,500 slots all went to the
 * 22 busiest targets out of 392, because a hub has hundreds of edges and they
 * all sort above everything else. The picture became two dozen files with
 * enormous fans and 370 files with no arcs at all, which is not what the
 * repository looks like. Proportional keeps the shape of the distribution: the
 * busiest target still keeps the most arcs, by the same ratio it had, and a
 * file imported once still keeps its one arc.
 *
 * @param dependencies Dependencies from Agent 2
 * @param nodeIds Ids of the nodes that will be rendered
 * @returns Edges to render and the number dropped by the cap
 */
export function selectRenderableEdges(
  dependencies: readonly Dependency[],
  nodeIds: ReadonlySet<string>
): EdgeSelection {
  const eligible = dependencies.filter(
    dep => nodeIds.has(dep.from) && nodeIds.has(dep.to)
  );

  if (eligible.length <= MAX_RENDERED_EDGES) {
    return { edges: eligible.map(toLayoutEdge), dropped: 0 };
  }

  // Group by target. Inside a group, strongest first, then by importer name so
  // the same repository always yields the same map.
  const byTarget = new Map<string, Dependency[]>();
  for (const dep of eligible) {
    const group = byTarget.get(dep.to);
    if (group) {
      group.push(dep);
    } else {
      byTarget.set(dep.to, [dep]);
    }
  }

  for (const group of byTarget.values()) {
    group.sort(
      (a, b) => edgeStrength(b) - edgeStrength(a) || a.from.localeCompare(b.from)
    );
  }

  // Most imported target first, so that when the budget is too small to give
  // every target even one arc, the ones that carry the structure are kept.
  const targets = [...byTarget.entries()]
    .map(([id, group]) => ({ id, group }))
    .sort((a, b) => b.group.length - a.group.length || a.id.localeCompare(b.id));

  const quotas = apportion(
    targets.map(target => target.group.length),
    MAX_RENDERED_EDGES
  );

  const kept: Dependency[] = [];
  targets.forEach((target, index) => {
    for (let i = 0; i < quotas[index]; i += 1) {
      kept.push(target.group[i]);
    }
  });

  return {
    edges: kept.map(toLayoutEdge),
    dropped: eligible.length - kept.length
  };
}

/**
 * Split a budget across groups in proportion to their size.
 *
 * Every group that can be represented at all is given at least one slot, then
 * the rounding error is settled one slot at a time: a slot goes to whichever
 * group sits furthest below its exact share, and is taken back from whichever
 * sits furthest above it. That is the largest remainder method, written as a
 * loop because the floor-with-a-minimum-of-one start can land on either side of
 * the budget and both directions have to be able to close the gap.
 *
 * @param sizes How many items each group has, largest first
 * @param budget Total number of items that may be kept
 * @returns How many items to keep from each group, index for index
 */
function apportion(sizes: readonly number[], budget: number): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0);

  if (total <= budget) {
    return [...sizes];
  }

  // More groups than slots: proportionality has nothing left to say, so spend
  // the budget on the largest groups at one apiece.
  if (sizes.length >= budget) {
    return sizes.map((_, index) => (index < budget ? 1 : 0));
  }

  const exact = sizes.map(size => (size * budget) / total);
  const quotas = exact.map((share, index) =>
    Math.min(sizes[index], Math.max(1, Math.floor(share)))
  );

  let assigned = quotas.reduce((sum, quota) => sum + quota, 0);

  while (assigned !== budget) {
    const step = assigned < budget ? 1 : -1;
    let pick = -1;
    let best = -Infinity;

    for (let index = 0; index < quotas.length; index += 1) {
      const room = step > 0 ? quotas[index] < sizes[index] : quotas[index] > 1;
      if (!room) {
        continue;
      }
      const score = step > 0 ? exact[index] - quotas[index] : quotas[index] - exact[index];
      if (score > best) {
        best = score;
        pick = index;
      }
    }

    if (pick === -1) {
      break;
    }

    quotas[pick] += step;
    assigned += step;
  }

  return quotas;
}

/**
 * Edge weight by dependency kind
 */
function edgeStrength(dependency: Dependency): number {
  return dependency.type === 'import' ? 1.0 : 0.5;
}

/**
 * Convert a dependency to a layout edge
 */
function toLayoutEdge(dependency: Dependency): LayoutEdge {
  return {
    source: dependency.from,
    target: dependency.to,
    strength: edgeStrength(dependency)
  };
}

/**
 * Create simulation edges from dependencies
 */
function createSimulationEdges(
  dependencies: readonly Dependency[],
  selectedPaths: Set<string>
): SimEdge[] {
  return selectRenderableEdges(dependencies, selectedPaths).edges.map(edge => ({
    source: edge.source,
    target: edge.target,
    strength: edge.strength
  }));
}

/**
 * Run force-directed simulation synchronously
 */
function runForceSimulation(
  nodes: SimNode[],
  edges: SimEdge[],
  districtAnchors: Map<string, { x: number; y: number }>,
  canvasWidth: number,
  canvasHeight: number
): void {
  if (nodes.length === 0) {
    return;
  }

  // Single node - center it
  if (nodes.length === 1) {
    nodes[0].x = canvasWidth / 2;
    nodes[0].y = canvasHeight / 2;
    return;
  }

  const simulation = forceSimulation<SimNode>(nodes)
    .force('charge', forceManyBody<SimNode>().strength(FORCE_REPULSION))
    .force('link', forceLink<SimNode, SimEdge>(edges)
      .id(d => d.id)
      .distance(FORCE_LINK_DISTANCE)
      .strength(d => d.strength))
    .force('center', forceCenter<SimNode>(canvasWidth / 2, canvasHeight / 2))
    .force('collide', forceCollide<SimNode>()
      .radius(d => Math.max(d.width, d.height) / 2 + FORCE_COLLISION_PADDING))
    .force('x', forceX<SimNode>()
      .x(d => districtAnchors.get(d.district)?.x ?? canvasWidth / 2)
      .strength(0.25))
    .force('y', forceY<SimNode>()
      .y(d => districtAnchors.get(d.district)?.y ?? canvasHeight / 2)
      .strength(0.25))
    .stop();

  // Run simulation synchronously
  for (let i = 0; i < SIMULATION_TICKS; i++) {
    simulation.tick();
  }
}

/**
 * Convert simulation node to layout node
 */
function convertToLayoutNode(node: SimNode): LayoutNode {
  return {
    id: node.id,
    x: node.x ?? 0,
    y: node.y ?? 0,
    width: node.width,
    height: node.height,
    type: node.type,
    label: node.path.split('/').pop() ?? node.path,
    metadata: {
      path: node.path,
      loc: node.loc,
      language: node.language
    }
  };
}

/**
 * Convert simulation edge to layout edge
 */
function convertToLayoutEdge(edge: SimEdge): LayoutEdge {
  const source = typeof edge.source === 'object' ? edge.source.id : String(edge.source);
  const target = typeof edge.target === 'object' ? edge.target.id : String(edge.target);
  
  return {
    source,
    target,
    strength: edge.strength
  };
}

/**
 * Create districts with bounds and colors
 */
function createDistricts(
  districtMap: Map<string, SimNode[]>,
  nodes: SimNode[]
): District[] {
  const colorScale = scaleOrdinal<string>()
    .domain(Array.from(districtMap.keys()))
    .range(schemeTableau10);

  return Array.from(districtMap.entries()).map(([name, districtNodes]) => {
    // Calculate bounds from node positions
    const nodeIds = districtNodes.map(n => n.id);
    const relevantNodes = nodes.filter(n => nodeIds.includes(n.id));

    if (relevantNodes.length === 0) {
      return {
        name,
        nodes: nodeIds,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        color: colorScale(name)
      };
    }

    const minX = Math.min(...relevantNodes.map(n => (n.x ?? 0) - n.width / 2));
    const maxX = Math.max(...relevantNodes.map(n => (n.x ?? 0) + n.width / 2));
    const minY = Math.min(...relevantNodes.map(n => (n.y ?? 0) - n.height / 2));
    const maxY = Math.max(...relevantNodes.map(n => (n.y ?? 0) + n.height / 2));

    return {
      name,
      nodes: nodeIds,
      bounds: {
        x: minX - BOUNDS_PADDING,
        y: minY - BOUNDS_PADDING,
        width: maxX - minX + 2 * BOUNDS_PADDING,
        height: maxY - minY + 2 * BOUNDS_PADDING
      },
      color: colorScale(name)
    };
  });
}

/**
 * Calculate overall bounds and scale if needed
 */
function calculateBounds(
  nodes: LayoutNode[],
  canvasWidth: number,
  canvasHeight: number
): { width: number; height: number } {
  if (nodes.length === 0) {
    return { width: 0, height: 0 };
  }

  // Find actual bounds
  const minX = Math.min(...nodes.map(n => n.x - n.width / 2));
  const maxX = Math.max(...nodes.map(n => n.x + n.width / 2));
  const minY = Math.min(...nodes.map(n => n.y - n.height / 2));
  const maxY = Math.max(...nodes.map(n => n.y + n.height / 2));

  const actualWidth = maxX - minX + 2 * BOUNDS_PADDING;
  const actualHeight = maxY - minY + 2 * BOUNDS_PADDING;

  // If exceeds canvas, scale down proportionally
  if (actualWidth > canvasWidth || actualHeight > canvasHeight) {
    const scaleX = canvasWidth / actualWidth;
    const scaleY = canvasHeight / actualHeight;
    const scale = Math.min(scaleX, scaleY);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    // Scale positions AND sizes.
    //
    // Rescaling only the positions was silently wrong: forceCollide had
    // separated the nodes by a radius derived from their width and height, and
    // pulling the centres closer while leaving the sizes alone broke that
    // guarantee. Measured across the three demo repositories, all of which take
    // this branch, neighbours ended up as close as 0.57 of the separation their
    // sizes claimed, and dozens of footprints overlapped. The renderer sorts by
    // depth with no z-buffer, so intersecting solids have no defined answer and
    // show up as one building slicing into its neighbour when zoomed in.
    for (const node of nodes) {
      node.x = (node.x - centerX) * scale + canvasWidth / 2;
      node.y = (node.y - centerY) * scale + canvasHeight / 2;
      node.width *= scale;
      node.height *= scale;
    }

    return { width: canvasWidth, height: canvasHeight };
  }

  return { width: actualWidth, height: actualHeight };
}

// Made with Bob