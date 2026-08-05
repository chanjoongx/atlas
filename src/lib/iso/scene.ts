/**
 * Turns the backend's `AnnotatedLayout` into a renderable city.
 *
 * Pure and DOM free, so the same scene feeds the interactive canvas, the PNG
 * exporter and the unit tests.
 *
 * ## Visual encoding
 *
 * The single most important decision here is that **footprint and height
 * encode different things**. The old 2D renderer scaled a rectangle by lines
 * of code in both axes, so a large file was simply a large blob and the
 * picture carried one variable pretending to be two.
 *
 *   footprint  ->  what kind of file it is, lightly modulated by weight
 *   height     ->  lines of code, log scaled
 *   hue        ->  which district (top level directory) it belongs to
 *   landmark   ->  why it matters: entry point, core module, hotspot
 *
 * Height therefore becomes the one dominant read: a skyline you can scan.
 *
 * Footprints are derived from the layout's own node dimensions and kept
 * strictly inside the separation the force simulation guaranteed, because a
 * painter's algorithm is only correct when no two solids intersect.
 *
 * The bound is less obvious than it looks. `forceCollide` guarantees a
 * **Euclidean** separation of `max(w, h) / 2 + padding` between centres, while
 * a footprint is an **axis aligned** square. Two centres that are a full
 * collision radius apart on the diagonal are only `1/sqrt(2)` of that distance
 * apart along each axis, so the safe half extent is `radius / sqrt(2)`, not
 * `radius`. See `SAFE_FOOTPRINT_RATIO` below.
 */

import type { AnnotatedLayout, FileType, LayoutNode } from '../../types';
import { SIGNAL_LABEL, SIGNAL_ORDER, type SignalKind } from '../palette';
import { boundsOf, depthOf, project, rotate, rotateExtent, type Azimuth, type Bounds } from './projection';

/* -------------------------------------------------------------------------- */
/* Tuning                                                                      */
/* -------------------------------------------------------------------------- */

/** Shortest a building can be, so a one line file still reads as a building. */
const MIN_HEIGHT = 9;
/** Tallest a building can be at 1x exaggeration, in layout units. */
const MAX_HEIGHT = 104;
/** Pulls the middle of the distribution down so towers actually stand out. */
const HEIGHT_GAMMA = 1.18;

/** Preferred footprint half extent, as a fraction of `min(width, height)`. */
const FOOTPRINT_RATIO = 0.42;

/**
 * Hard ceiling on a footprint half extent, as a fraction of
 * `max(width, height)`. Equals `1 / (2 * sqrt(2))`: half the collision radius
 * the simulation guaranteed, projected onto the worst case diagonal. Nothing
 * may exceed this, including the minimum below, or buildings can intersect and
 * the depth sort starts producing visible tears.
 */
const SAFE_FOOTPRINT_RATIO = 1 / (2 * Math.SQRT2);

/** Smallest footprint worth drawing, itself capped by the ratio above. */
const MIN_FOOTPRINT = 5.5;

/**
 * District name given to a node the backend placed in no district at all.
 * `draw.ts` keys its neutral material off this exact string.
 */
export const UNCLASSIFIED = 'unknown';

/** Per type footprint trim, so tests and config read as low rise outbuildings. */
const TYPE_FOOTPRINT: Record<FileType, number> = {
  source: 1,
  test: 0.86,
  config: 0.8,
  docs: 0.8,
  asset: 0.74,
};

/** Thickness of the slab a district sits on. */
export const PLATE_THICKNESS = 7;
/** Breathing room between the outermost building and the plate edge. */
const PLATE_PADDING = 26;

/** Dependency arcs float just clear of the plate so they are never z-fighting. */
export const EDGE_ELEVATION = 2.5;

/** Above this the graph stops informing and starts smearing. */
const MAX_EDGES = 900;

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export interface SceneNode {
  id: string;
  path: string;
  label: string;
  type: FileType;
  language: string;
  loc: number;
  /** World ground position. */
  wx: number;
  wy: number;
  /** World half extents of the footprint. */
  hx: number;
  hy: number;
  /** World elevation of the roof. */
  height: number;
  districtIndex: number;
  districtName: string;
  signals: SignalKind[];
  /** Why the annotator flagged it, if it did. */
  reason?: string;
  inDegree: number;
  outDegree: number;
}

export interface SceneDistrict {
  name: string;
  index: number;
  nodeIds: string[];
  fileCount: number;
  loc: number;
  /** World bounds of the plate, already padded. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SceneEdge {
  source: string;
  target: string;
  strength: number;
  districtIndex: number;
}

export interface SceneStats {
  fileCount: number;
  totalLoc: number;
  districtCount: number;
  edgeCount: number;
  droppedEdges: number;
  languages: Array<{ name: string; files: number; share: number }>;
  landmarks: Record<SignalKind, number>;
  /** Deepest directory nesting seen among rendered files. */
  maxDepth: number;
  medianLoc: number;
}

export interface Scene {
  nodes: SceneNode[];
  nodeById: Map<string, SceneNode>;
  districts: SceneDistrict[];
  edges: SceneEdge[];
  edgesByNode: Map<string, SceneEdge[]>;
  stats: SceneStats;
}

export interface BuildSceneOptions {
  /** Multiplies every building height. 1 is the designed default. */
  exaggeration?: number;
}

/* -------------------------------------------------------------------------- */
/* Build                                                                       */
/* -------------------------------------------------------------------------- */

export function buildScene(layout: AnnotatedLayout, options: BuildSceneOptions = {}): Scene {
  const exaggeration = options.exaggeration ?? 1;

  // District identity is assigned by size rank rather than by the order the
  // backend happened to emit, so the largest area of a repo always lands on
  // the same hue and two repos stay comparable at a glance.
  const ranked = [...layout.districts]
    .map((d) => ({ district: d, count: d.nodes.length }))
    .sort((a, b) => b.count - a.count || a.district.name.localeCompare(b.district.name));

  const districtIndexByName = new Map<string, number>();
  ranked.forEach((entry, index) => districtIndexByName.set(entry.district.name, index));

  const districtByNode = new Map<string, string>();
  layout.districts.forEach((district) => {
    district.nodes.forEach((nodeId) => districtByNode.set(nodeId, district.name));
  });

  const signalsByNode = new Map<string, { kinds: Set<SignalKind>; reason?: string }>();
  layout.highlights.forEach((highlight) => {
    const kind = highlight.type as SignalKind;
    const existing = signalsByNode.get(highlight.nodeId);
    if (existing) {
      existing.kinds.add(kind);
      if (!existing.reason) existing.reason = highlight.reason;
    } else {
      signalsByNode.set(highlight.nodeId, { kinds: new Set([kind]), reason: highlight.reason });
    }
  });

  const degrees = new Map<string, { inDegree: number; outDegree: number }>();
  const bump = (id: string, key: 'inDegree' | 'outDegree') => {
    const entry = degrees.get(id) ?? { inDegree: 0, outDegree: 0 };
    entry[key] += 1;
    degrees.set(id, entry);
  };
  layout.edges.forEach((edge) => {
    bump(edge.source, 'outDegree');
    bump(edge.target, 'inDegree');
  });

  const maxLoc = layout.nodes.reduce((max, node) => Math.max(max, node.metadata.loc), 1);
  const heightOf = makeHeightScale(maxLoc, exaggeration);

  const nodes: SceneNode[] = layout.nodes.map((node) => {
    // Not `root`: a node the backend left out of every district is not part of
    // the root district, it is unclassified, and draw.ts paints that case in a
    // neutral material so it is visibly different rather than silently wearing
    // the first district's colour.
    const districtName = districtByNode.get(node.id) ?? UNCLASSIFIED;
    const signal = signalsByNode.get(node.id);
    const degree = degrees.get(node.id) ?? { inDegree: 0, outDegree: 0 };
    const half = footprintHalfExtent(node);

    return {
      id: node.id,
      path: node.metadata.path,
      label: node.label,
      type: node.type,
      language: node.metadata.language,
      loc: node.metadata.loc,
      wx: node.x,
      wy: node.y,
      hx: half,
      hy: half,
      height: heightOf(node.metadata.loc),
      districtIndex: districtIndexByName.get(districtName) ?? 0,
      districtName,
      signals: orderSignals(signal?.kinds),
      reason: signal?.reason,
      inDegree: degree.inDegree,
      outDegree: degree.outDegree,
    };
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const districts: SceneDistrict[] = [];
  ranked.forEach((entry, index) => {
    const members = entry.district.nodes
      .map((id) => nodeById.get(id))
      .filter((node): node is SceneNode => node !== undefined);
    if (members.length === 0) return; // the backend can emit districts with no surviving nodes

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let loc = 0;
    for (const node of members) {
      minX = Math.min(minX, node.wx - node.hx);
      maxX = Math.max(maxX, node.wx + node.hx);
      minY = Math.min(minY, node.wy - node.hy);
      maxY = Math.max(maxY, node.wy + node.hy);
      loc += node.loc;
    }

    districts.push({
      name: entry.district.name,
      index,
      nodeIds: members.map((node) => node.id),
      fileCount: members.length,
      loc,
      minX: minX - PLATE_PADDING,
      minY: minY - PLATE_PADDING,
      maxX: maxX + PLATE_PADDING,
      maxY: maxY + PLATE_PADDING,
    });
  });

  const { edges, dropped } = selectEdges(layout, nodeById);

  const edgesByNode = new Map<string, SceneEdge[]>();
  edges.forEach((edge) => {
    push(edgesByNode, edge.source, edge);
    push(edgesByNode, edge.target, edge);
  });

  return {
    nodes,
    nodeById,
    districts,
    edges,
    edgesByNode,
    stats: summarise(nodes, districts, edges, dropped),
  };
}

/* -------------------------------------------------------------------------- */
/* Camera space                                                                */
/* -------------------------------------------------------------------------- */

export interface PlacedNode extends SceneNode {
  /** Camera space ground position. */
  rx: number;
  ry: number;
  /** Camera space half extents. */
  rhx: number;
  rhy: number;
  depth: number;
}

/** Rotate every node into camera space and sort back to front. */
export function placeNodes(nodes: SceneNode[], azimuth: Azimuth): PlacedNode[] {
  const placed = nodes.map((node) => {
    const centre = rotate(node.wx, node.wy, azimuth);
    const extent = rotateExtent(node.hx, node.hy, azimuth);
    return {
      ...node,
      rx: centre.x,
      ry: centre.y,
      rhx: extent.x,
      rhy: extent.y,
      depth: depthOf(centre.x, centre.y, extent.x, extent.y),
    };
  });
  placed.sort((a, b) => a.depth - b.depth);
  return placed;
}

export interface PlacedDistrict extends SceneDistrict {
  rx: number;
  ry: number;
  rhx: number;
  rhy: number;
  depth: number;
}

export function placeDistricts(districts: SceneDistrict[], azimuth: Azimuth): PlacedDistrict[] {
  const placed = districts.map((district) => {
    const cx = (district.minX + district.maxX) / 2;
    const cy = (district.minY + district.maxY) / 2;
    const hx = (district.maxX - district.minX) / 2;
    const hy = (district.maxY - district.minY) / 2;
    const centre = rotate(cx, cy, azimuth);
    const extent = rotateExtent(hx, hy, azimuth);
    return {
      ...district,
      rx: centre.x,
      ry: centre.y,
      rhx: extent.x,
      rhy: extent.y,
      depth: depthOf(centre.x, centre.y, extent.x, extent.y),
    };
  });
  placed.sort((a, b) => a.depth - b.depth);
  return placed;
}

/**
 * Screen bounds of the whole city before any camera zoom.
 *
 * Districts are optional but should be passed by anything framing the canvas:
 * a plate extends `PLATE_PADDING` past its outermost building, so fitting to
 * the buildings alone crops the ground out from under them at the edges.
 */
export function sceneBounds(
  nodes: SceneNode[],
  azimuth: Azimuth,
  districts: SceneDistrict[] = [],
): Bounds {
  const points = [];

  for (const district of districts) {
    const corners: Array<[number, number]> = [
      [district.minX, district.minY],
      [district.maxX, district.minY],
      [district.maxX, district.maxY],
      [district.minX, district.maxY],
    ];
    for (const [x, y] of corners) {
      const r = rotate(x, y, azimuth);
      points.push(project(r.x, r.y, 0), project(r.x, r.y, -PLATE_THICKNESS));
    }
  }

  for (const node of nodes) {
    const centre = rotate(node.wx, node.wy, azimuth);
    const extent = rotateExtent(node.hx, node.hy, azimuth);
    points.push(
      project(centre.x - extent.x, centre.y - extent.y, node.height),
      project(centre.x + extent.x, centre.y - extent.y, node.height),
      project(centre.x + extent.x, centre.y + extent.y, -PLATE_THICKNESS),
      project(centre.x - extent.x, centre.y + extent.y, -PLATE_THICKNESS),
    );
  }
  return boundsOf(points);
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function makeHeightScale(maxLoc: number, exaggeration: number): (loc: number) => number {
  const ceiling = Math.log1p(Math.max(maxLoc, 2));
  return (loc: number) => {
    const t = Math.log1p(Math.max(loc, 0)) / ceiling;
    const eased = Math.pow(Math.min(Math.max(t, 0), 1), HEIGHT_GAMMA);
    return (MIN_HEIGHT + eased * (MAX_HEIGHT - MIN_HEIGHT)) * exaggeration;
  };
}

function footprintHalfExtent(node: LayoutNode): number {
  const limit = Math.max(node.width, node.height) * SAFE_FOOTPRINT_RATIO;
  const preferred = Math.min(Math.min(node.width, node.height) * FOOTPRINT_RATIO, limit);
  const typed = preferred * (TYPE_FOOTPRINT[node.type] ?? 1);
  // The minimum is itself clamped, so a tiny node can never be given a
  // footprint wider than the space the simulation left around it.
  return Math.max(typed, Math.min(MIN_FOOTPRINT, limit));
}

const SIGNAL_RANK: Record<SignalKind, number> = { entry: 0, core: 1, hotspot: 2 };

function orderSignals(kinds: Set<SignalKind> | undefined): SignalKind[] {
  if (!kinds || kinds.size === 0) return [];
  return [...kinds]
    // hasOwn, not `in`. Highlight types are a union in TypeScript but they
    // arrive as untrusted JSON, and `in` walks the prototype chain, so a
    // highlight typed "constructor" would otherwise sail through and land in
    // the landmark tallies as a stringified function.
    .filter((kind): kind is SignalKind => Object.hasOwn(SIGNAL_RANK, kind))
    .sort((a, b) => SIGNAL_RANK[a] - SIGNAL_RANK[b]);
}

/**
 * Keep the edges that carry the most information when a repo has more than the
 * canvas can show: strong imports first, then edges that touch a landmark,
 * then everything else.
 */
function selectEdges(
  layout: AnnotatedLayout,
  nodeById: Map<string, SceneNode>,
): { edges: SceneEdge[]; dropped: number } {
  const usable = layout.edges.filter(
    (edge) => edge.source !== edge.target && nodeById.has(edge.source) && nodeById.has(edge.target),
  );

  const seen = new Set<string>();
  const deduped = usable.filter((edge) => {
    const key = `${edge.source}\u0000${edge.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const scored = deduped.map((edge) => {
    const source = nodeById.get(edge.source)!;
    const target = nodeById.get(edge.target)!;
    const landmark = (source.signals.length > 0 ? 1 : 0) + (target.signals.length > 0 ? 1 : 0);
    return { edge, source, score: edge.strength * 2 + landmark };
  });

  scored.sort((a, b) => b.score - a.score);
  const kept = scored.slice(0, MAX_EDGES);

  return {
    edges: kept.map(({ edge, source }) => ({
      source: edge.source,
      target: edge.target,
      strength: edge.strength,
      districtIndex: source.districtIndex,
    })),
    dropped: Math.max(0, scored.length - kept.length),
  };
}

function summarise(
  nodes: SceneNode[],
  districts: SceneDistrict[],
  edges: SceneEdge[],
  dropped: number,
): SceneStats {
  const byLanguage = new Map<string, number>();
  const landmarks: Record<SignalKind, number> = { entry: 0, core: 0, hotspot: 0 };
  let totalLoc = 0;
  let maxDepth = 0;

  for (const node of nodes) {
    totalLoc += node.loc;
    const language = node.language && node.language !== 'unknown' ? node.language : 'other';
    byLanguage.set(language, (byLanguage.get(language) ?? 0) + 1);
    for (const signal of node.signals) landmarks[signal] += 1;
    maxDepth = Math.max(maxDepth, node.path.split('/').length);
  }

  const languages = [...byLanguage.entries()]
    .map(([name, files]) => ({ name, files, share: nodes.length ? files / nodes.length : 0 }))
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));

  const locs = nodes.map((node) => node.loc).sort((a, b) => a - b);
  const middle = locs.length >> 1;
  const medianLoc =
    locs.length === 0
      ? 0
      : locs.length % 2 === 1
        ? locs[middle]
        : Math.round((locs[middle - 1] + locs[middle]) / 2);

  return {
    fileCount: nodes.length,
    totalLoc,
    districtCount: districts.length,
    edgeCount: edges.length,
    droppedEdges: dropped,
    languages,
    landmarks,
    maxDepth,
    medianLoc,
  };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/* -------------------------------------------------------------------------- */
/* Description                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The map, in a sentence a screen reader can actually say.
 *
 * Three thousand SVG elements carrying no roles are three thousand pieces of
 * silence, so a visitor who cannot see the city was getting one aria-label and
 * no data at all. The answer is not an ARIA tree of five hundred buildings,
 * which would be unusable in a different way: it is the handful of facts a
 * sighted visitor takes from the shape in the first second, which are how big
 * it is, how it divides, and what stands out.
 *
 * Plain sentences rather than a list, because this is read aloud.
 */
export function describeScene(scene: Scene): string {
  const { stats, districts, nodes } = scene;
  if (nodes.length === 0) return 'The map is empty.';

  const parts: string[] = [];

  parts.push(
    `${stats.fileCount.toLocaleString()} files in ${stats.districtCount} ${
      stats.districtCount === 1 ? 'district' : 'districts'
    }, ${stats.totalLoc.toLocaleString()} lines in total.`,
  );

  const largest = [...districts].sort((a, b) => b.fileCount - a.fileCount).slice(0, 4);
  if (largest.length > 0) {
    parts.push(
      `Largest ${largest.length === 1 ? 'district' : 'districts'}: ${largest
        .map((district) => `${district.name}, ${district.fileCount} files`)
        .join('; ')}.`,
    );
  }

  const landmarks = SIGNAL_ORDER.filter((kind) => stats.landmarks[kind] > 0).map((kind) => {
    const count = stats.landmarks[kind];
    const noun = SIGNAL_LABEL[kind].toLowerCase();
    return `${count} ${count === 1 ? noun : `${noun}s`}`;
  });
  if (landmarks.length > 0) parts.push(`Landmarks: ${landmarks.join(', ')}.`);

  const tallest = [...nodes].sort((a, b) => b.loc - a.loc).slice(0, 5);
  parts.push(
    `Largest files: ${tallest
      .map((node) => `${node.path}, ${node.loc.toLocaleString()} lines`)
      .join('; ')}.`,
  );

  parts.push(`Median file is ${stats.medianLoc.toLocaleString()} lines.`);

  return parts.join(' ');
}
