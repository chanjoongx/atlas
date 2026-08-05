/**
 * Scene to SVG markup.
 *
 * The whole city is serialised as a single markup string and injected in one
 * write. Around five hundred buildings means a few thousand elements, and
 * building that many nodes through a data join costs far more than the string
 * concatenation does. Interaction is handled by event delegation against
 * `data-node` attributes rather than per element listeners, so the cost stays
 * flat as repositories grow.
 *
 * Nothing in here touches the DOM, which keeps it usable from the exporter.
 */

import {
  hotspotRoof,
  material,
  neutralMaterial,
  plateMaterial,
  signalColor,
  type Material,
  type ThemeName,
} from '../palette';
import type { MapTokens } from '../theme';
import {
  boxFaces,
  boundsOf,
  diamond,
  polygonPoints,
  project,
  r,
  rotate,
  type Azimuth,
  type Point,
} from './projection';
import {
  EDGE_ELEVATION,
  PLATE_THICKNESS,
  UNCLASSIFIED,
  placeDistricts,
  placeNodes,
  sceneBounds,
  type PlacedNode,
  type Scene,
  type SceneNode,
} from './scene';

/* -------------------------------------------------------------------------- */
/* Tuning                                                                      */
/* -------------------------------------------------------------------------- */

/** Ground grid spacing in world units, and how often a major line lands. */
const GRID_STEP = 110;
const GRID_MAJOR_EVERY = 4;
const GRID_OVERSCAN = 320;

/** How far a contact shadow slides per unit of building height. */
const SHADOW_SKEW = 0.055;
const SHADOW_SPREAD = 1.14;

/** Light column above an entry point, in world units. */
const BEACON_HEIGHT = 34;

/** Most labels a map may carry before it stops being a map. */
const MAX_LABELS = 18;
/**
 * No single district may take every label. Without this, a repository whose
 * landmarks all live under `src` returns a wall of text over one plate and
 * nothing anywhere else.
 */
const MAX_LABELS_PER_DISTRICT = 6;
const LABEL_FONT = 11.5;
const DISTRICT_FONT = 12;

/** Deterministic lightness jitter, in HSL percentage points either way. */
const TEXTURE = 3.5;

/** Canvas below which labels start tapering, and the floor they taper to. */
const COMFORTABLE_CANVAS = 900;
const MIN_LABEL_SCALE = 0.74;

/** Screen space rectangle used for label occupancy tests. */
interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface LabelDensity {
  /** Multiplies the constant screen size of every label. */
  scale: number;
  /** Ceiling on how many landmark names to draw. */
  max: number;
}

function labelDensity(width: number, height: number): LabelDensity {
  const shorter = Math.min(width, height);
  const t = Math.min(1, Math.max(0, shorter / COMFORTABLE_CANVAS));
  return {
    scale: MIN_LABEL_SCALE + (1 - MIN_LABEL_SCALE) * t,
    // Roughly one name per ninety thousand square pixels of canvas. A phone
    // held upright has plenty of area and almost no width, and width is what
    // a label needs, so the count has to come down with it.
    max: Math.max(3, Math.min(MAX_LABELS, Math.floor((width * height) / 90_000))),
  };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

export interface DrawOptions {
  scene: Scene;
  theme: ThemeName;
  tokens: MapTokens;
  azimuth: Azimuth;
  width: number;
  height: number;
  showEdges: boolean;
  showLabels: boolean;
  showGrid: boolean;
  /** Fraction of the viewport kept clear around the city. */
  padding?: number;
}

export interface DrawResult {
  markup: string;
  /** Static transform that fits the projected city into the viewport. */
  fit: { scale: number; x: number; y: number };
}

export function drawScene(options: DrawOptions): DrawResult {
  const { scene, theme, tokens, azimuth, width, height } = options;
  const fit = fitCity(scene, azimuth, width, height, options.padding ?? 0.08);

  const nodes = placeNodes(scene.nodes, azimuth);
  const districts = placeDistricts(scene.districts, azimuth);

  const parts: string[] = [];
  parts.push(defs(theme, tokens, scene));
  parts.push(
    `<rect class="atlas-sky" x="0" y="0" width="${r(width)}" height="${r(height)}" fill="url(#atlas-sky)"/>`,
  );
  parts.push(
    `<rect class="atlas-halo" x="0" y="0" width="${r(width)}" height="${r(height)}" fill="url(#atlas-halo)"/>`,
  );

  parts.push('<g class="atlas-camera">');
  parts.push(`<g class="atlas-fit" transform="translate(${r(fit.x)} ${r(fit.y)}) scale(${r(fit.scale)})">`);

  // Labels hold a constant screen size, which is right until the canvas is a
  // phone: then a full strength label set covers the city it is annotating.
  // Both the size and the count taper on a small canvas.
  const density = labelDensity(width, height);

  const plateNames = districtLabels(districts, theme, tokens, fit.scale, density);

  if (options.showGrid) parts.push(grid(scene, azimuth, tokens));
  parts.push(plates(districts, theme));
  parts.push(plateNames.markup);
  if (options.showEdges && scene.edges.length > 0) parts.push(edges(scene, azimuth, theme));
  parts.push(city(nodes, theme, tokens));
  if (options.showLabels) {
    parts.push(labels(nodes, tokens, fit.scale, density, plateNames.boxes));
  }

  parts.push('</g></g>');

  parts.push(
    `<rect class="atlas-vignette" x="0" y="0" width="${r(width)}" height="${r(height)}" fill="url(#atlas-vignette)" pointer-events="none"/>`,
  );

  return { markup: parts.join(''), fit };
}

/**
 * Screen space hexagon that outlines a building, used by the focus overlay.
 * Kept here so the overlay and the buildings can never disagree.
 */
export function silhouette(node: SceneNode, azimuth: Azimuth): Point[] {
  const placed = placeNodes([node], azimuth)[0];
  const lo = diamond(placed.rx, placed.ry, placed.rhx, placed.rhy, 0);
  const hi = diamond(placed.rx, placed.ry, placed.rhx, placed.rhy, placed.height);
  return [hi[0], hi[1], lo[1], lo[2], lo[3], hi[3]];
}

export function roofPolygon(node: SceneNode, azimuth: Azimuth): Point[] {
  const placed = placeNodes([node], azimuth)[0];
  return diamond(placed.rx, placed.ry, placed.rhx, placed.rhy, placed.height);
}

/** Where a building's roof centre lands on screen, before the camera moves. */
export function apexOf(node: SceneNode, azimuth: Azimuth): Point {
  const centre = rotate(node.wx, node.wy, azimuth);
  return project(centre.x, centre.y, node.height);
}

/* -------------------------------------------------------------------------- */
/* Camera fit                                                                  */
/* -------------------------------------------------------------------------- */

function fitCity(
  scene: Scene,
  azimuth: Azimuth,
  width: number,
  height: number,
  padding: number,
): { scale: number; x: number; y: number } {
  if (scene.nodes.length === 0) {
    return { scale: 1, x: width / 2, y: height / 2 };
  }
  const bounds = sceneBounds(scene.nodes, azimuth, scene.districts);
  const cityWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const cityHeight = Math.max(bounds.maxY - bounds.minY, 1);
  const usableWidth = width * (1 - padding * 2);
  const usableHeight = height * (1 - padding * 2);
  const scale = Math.min(usableWidth / cityWidth, usableHeight / cityHeight);

  return {
    scale,
    x: width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
    y: height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
  };
}

/* -------------------------------------------------------------------------- */
/* Layers                                                                      */
/* -------------------------------------------------------------------------- */

function defs(theme: ThemeName, tokens: MapTokens, scene: Scene): string {
  const beacon = signalColor('entry', theme);
  const hotspot = signalColor('hotspot', theme);

  const hotspotStops = scene.stats.landmarks.hotspot
    ? `<radialGradient id="atlas-hotspot-glow">
         <stop offset="0%" stop-color="${hotspot}" stop-opacity="${theme === 'carbon' ? 0.5 : 0.32}"/>
         <stop offset="55%" stop-color="${hotspot}" stop-opacity="${theme === 'carbon' ? 0.16 : 0.1}"/>
         <stop offset="100%" stop-color="${hotspot}" stop-opacity="0"/>
       </radialGradient>`
    : '';

  return `<defs>
    <linearGradient id="atlas-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${tokens.skyTop}"/>
      <stop offset="52%" stop-color="${tokens.skyMid}"/>
      <stop offset="100%" stop-color="${tokens.skyBottom}"/>
    </linearGradient>
    <radialGradient id="atlas-halo" cx="50%" cy="46%" r="62%">
      <stop offset="0%" stop-color="${tokens.halo}"/>
      <stop offset="100%" stop-color="${tokens.halo}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="atlas-vignette" cx="50%" cy="48%" r="72%">
      <stop offset="58%" stop-color="${tokens.vignette}" stop-opacity="0"/>
      <stop offset="100%" stop-color="${tokens.vignette}"/>
    </radialGradient>
    <linearGradient id="atlas-beacon" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="${beacon}" stop-opacity="0.95"/>
      <stop offset="45%" stop-color="${beacon}" stop-opacity="${theme === 'carbon' ? 0.5 : 0.62}"/>
      <stop offset="100%" stop-color="${beacon}" stop-opacity="${theme === 'carbon' ? 0 : 0.08}"/>
    </linearGradient>
    ${hotspotStops}
  </defs>`;
}

function grid(scene: Scene, azimuth: Azimuth, tokens: MapTokens): string {
  const xs = scene.nodes.map((n) => n.wx);
  const ys = scene.nodes.map((n) => n.wy);
  if (xs.length === 0) return '';

  const minX = Math.min(...xs) - GRID_OVERSCAN;
  const maxX = Math.max(...xs) + GRID_OVERSCAN;
  const minY = Math.min(...ys) - GRID_OVERSCAN;
  const maxY = Math.max(...ys) + GRID_OVERSCAN;
  const z = -PLATE_THICKNESS;

  const lines: string[] = [];
  const emit = (a: Point, b: Point, major: boolean) => {
    lines.push(
      `<line x1="${r(a.x)}" y1="${r(a.y)}" x2="${r(b.x)}" y2="${r(b.y)}" stroke="${
        major ? tokens.gridMajor : tokens.grid
      }" stroke-width="${major ? 1.25 : 0.75}"/>`,
    );
  };
  const at = (x: number, y: number) => {
    const p = rotate(x, y, azimuth);
    return project(p.x, p.y, z);
  };

  let i = 0;
  for (let x = Math.floor(minX / GRID_STEP) * GRID_STEP; x <= maxX; x += GRID_STEP, i += 1) {
    emit(at(x, minY), at(x, maxY), i % GRID_MAJOR_EVERY === 0);
  }
  i = 0;
  for (let y = Math.floor(minY / GRID_STEP) * GRID_STEP; y <= maxY; y += GRID_STEP, i += 1) {
    emit(at(minX, y), at(maxX, y), i % GRID_MAJOR_EVERY === 0);
  }

  return `<g class="atlas-grid" pointer-events="none">${lines.join('')}</g>`;
}

function plates(districts: ReturnType<typeof placeDistricts>, theme: ThemeName): string {
  const parts: string[] = ['<g class="atlas-plates">'];

  for (const district of districts) {
    const mat = plateMaterial(district.index, theme);
    const faces = boxFaces(
      district.rx,
      district.ry,
      district.rhx,
      district.rhy,
      -PLATE_THICKNESS,
      PLATE_THICKNESS,
    );
    parts.push(
      `<g class="atlas-plate" data-district="${escapeAttr(district.name)}">`,
      `<polygon points="${polygonPoints(faces.left)}" fill="${mat.left}"/>`,
      `<polygon points="${polygonPoints(faces.right)}" fill="${mat.right}"/>`,
      `<polygon points="${polygonPoints(faces.top)}" fill="${mat.top}" stroke="${mat.edge}" stroke-width="1"/>`,
      '</g>',
    );
  }

  parts.push('</g>');
  return parts.join('');
}

/**
 * `fitScale` divides out the static fit transform so a label is the same
 * number of screen pixels regardless of how far the camera had to pull back.
 * The live renderer overrides this with an inline style as the visitor zooms;
 * the exporter relies on the attribute being right on its own.
 */
function districtLabels(
  districts: ReturnType<typeof placeDistricts>,
  theme: ThemeName,
  tokens: MapTokens,
  fitScale: number,
  density: LabelDensity,
): { markup: string; boxes: Box[] } {
  const size = (DISTRICT_FONT * density.scale) / fitScale;
  const parts: string[] = [
    `<g class="atlas-district-labels" pointer-events="none" font-family="var(--font-sans)" font-size="${r(
      size,
    )}" font-weight="650" letter-spacing="0.1em" text-anchor="middle" paint-order="stroke" stroke="${
      tokens.labelHalo
    }" stroke-width="${r((3.5 * density.scale) / fitScale)}" stroke-linejoin="round">`,
  ];

  // Labels hold a constant screen size while the city shrinks to fit, so on a
  // small canvas they crowd. Biggest districts get first refusal, and anything
  // that would land on top of an already placed name is simply not drawn.
  const placed: Box[] = [];
  const byImportance = [...districts].sort((a, b) => b.fileCount - a.fileCount);

  for (const district of byImportance) {
    const near = project(district.rx, district.ry + district.rhy, -PLATE_THICKNESS);
    const name = district.name.toUpperCase();
    const halfWidth = (name.length * size * 0.68) / 2 + 4;
    const box = {
      x1: near.x - halfWidth,
      y1: near.y + size * 0.5,
      x2: near.x + halfWidth,
      y2: near.y + size * 3,
    };
    if (placed.some((other) => overlaps(other, box))) continue;
    placed.push(box);

    const mat = material(district.index, theme, theme === 'carbon' ? 4 : -4);
    parts.push(
      `<text x="${r(near.x)}" y="${r(near.y + size * 1.45)}" fill="${mat.base}">${escapeText(
        name,
      )}</text>`,
      // `em` so this line follows whatever font-size the group ends up with.
      `<text x="${r(near.x)}" y="${r(
        near.y + size * 2.6,
      )}" fill="${tokens.districtLabel}" font-size="0.82em" font-weight="500" letter-spacing="0.04em">${
        district.fileCount
      } files</text>`,
    );
  }

  parts.push('</g>');
  return { markup: parts.join(''), boxes: placed };
}

function edges(scene: Scene, azimuth: Azimuth, theme: ThemeName): string {
  const parts: string[] = ['<g class="atlas-edges" pointer-events="none" fill="none">'];

  for (const edge of scene.edges) {
    const from = scene.nodeById.get(edge.source);
    const to = scene.nodeById.get(edge.target);
    if (!from || !to) continue;

    const a = groundPoint(from, azimuth);
    const b = groundPoint(to, azimuth);
    const lift = Math.min(70, Math.hypot(b.x - a.x, b.y - a.y) * 0.18);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2 - lift;
    const mat = material(edge.districtIndex, theme);

    parts.push(
      `<path class="atlas-edge" data-from="${escapeAttr(edge.source)}" data-to="${escapeAttr(
        edge.target,
      )}" d="M${r(a.x)} ${r(a.y)}Q${r(cx)} ${r(cy)} ${r(b.x)} ${r(b.y)}" stroke="${
        mat.base
      }" stroke-width="${edge.strength >= 1 ? 1.1 : 0.8}" stroke-opacity="${
        theme === 'carbon' ? 0.22 : 0.24
      }" stroke-linecap="round"/>`,
    );
  }

  parts.push('</g>');
  return parts.join('');
}

function city(nodes: PlacedNode[], theme: ThemeName, tokens: MapTokens): string {
  const parts: string[] = ['<g class="atlas-city">'];

  for (const node of nodes) {
    const mat =
      node.districtName === UNCLASSIFIED
        ? neutralMaterial(theme)
        : material(node.districtIndex, theme, tone(node));
    const faces = boxFaces(node.rx, node.ry, node.rhx, node.rhy, 0, node.height);

    const isEntry = node.signals.includes('entry');
    const isCore = node.signals.includes('core');
    const isHotspot = node.signals.includes('hotspot');
    const flagged = node.signals.length > 0;

    parts.push(
      `<g class="atlas-b${flagged ? ' is-landmark' : ''}" data-node="${escapeAttr(
        node.id,
      )}" data-district="${escapeAttr(node.districtName)}">`,
    );

    // Contact shadow: leans further the taller the building, which is what
    // makes the ground read as ground instead of as a coloured rectangle.
    const skew = node.height * SHADOW_SKEW;
    parts.push(
      `<polygon class="atlas-shadow" points="${polygonPoints(
        diamond(node.rx + skew, node.ry + skew, node.rhx * SHADOW_SPREAD, node.rhy * SHADOW_SPREAD, 0.4),
      )}" fill="${tokens.groundShadow}" opacity="0.62"/>`,
    );

    if (isHotspot) {
      const glowR = (node.rhx + node.rhy) * 1.9;
      parts.push(
        `<ellipse class="atlas-glow" cx="${r(faces.anchor.x)}" cy="${r(faces.anchor.y)}" rx="${r(
          glowR,
        )}" ry="${r(glowR * 0.5)}" fill="url(#atlas-hotspot-glow)"/>`,
      );
    }

    parts.push(
      `<polygon class="atlas-f" points="${polygonPoints(faces.left)}" fill="${mat.left}"/>`,
      `<polygon class="atlas-f" points="${polygonPoints(faces.right)}" fill="${mat.right}"/>`,
      `<polygon class="atlas-f atlas-roof" points="${polygonPoints(faces.top)}" fill="${
        isHotspot ? hotspotRoof(theme, tone(node)) : mat.top
      }" stroke="${roofStroke(mat, theme, node)}" stroke-width="${flagged ? 1.1 : 0.7}"/>`,
    );

    if (isCore) {
      // A bright inset on the roof, the way a lit penthouse reads from above.
      parts.push(
        `<polygon class="atlas-crown" points="${polygonPoints(
          diamond(node.rx, node.ry, node.rhx * 0.5, node.rhy * 0.5, node.height + 0.4),
        )}" fill="${signalColor('core', theme)}" opacity="${theme === 'carbon' ? 0.62 : 0.34}"/>`,
      );
    }

    if (isEntry) {
      const tip = project(node.rx, node.ry, node.height + BEACON_HEIGHT);
      parts.push(
        `<line class="atlas-beacon" x1="${r(faces.apex.x)}" y1="${r(faces.apex.y)}" x2="${r(
          tip.x,
        )}" y2="${r(tip.y)}" stroke="url(#atlas-beacon)" stroke-width="2.6" stroke-linecap="round"/>`,
        `<polygon class="atlas-spark" points="${polygonPoints(
          diamond(node.rx, node.ry, 4, 4, node.height + BEACON_HEIGHT),
        )}" fill="${signalColor('entry', theme)}"/>`,
      );
    }

    parts.push('</g>');
  }

  parts.push('</g>');
  return parts.join('');
}

/**
 * Greedy label placement. Landmarks are sorted by how much they earn a name,
 * then each one is kept only if its box clears everything already placed, so a
 * dense repository degrades into fewer labels instead of a pile of overprints.
 */
function labels(
  nodes: PlacedNode[],
  tokens: MapTokens,
  fitScale: number,
  density: LabelDensity,
  reserved: Box[],
): string {
  const candidates = nodes
    .filter((node) => node.signals.length > 0)
    .sort((a, b) => labelWeight(b) - labelWeight(a));

  const names = uniqueNames(candidates);
  const size = (LABEL_FONT * density.scale) / fitScale;
  // District names are already on the canvas and outrank any single file, so
  // their boxes are occupied before the first landmark is considered.
  const placed: Box[] = [...reserved];
  const perDistrict = new Map<string, number>();
  const stems: string[] = [];
  const texts: string[] = [];

  let used = 0;
  for (const node of candidates) {
    if (used >= density.max) break;
    const taken = perDistrict.get(node.districtName) ?? 0;
    if (taken >= MAX_LABELS_PER_DISTRICT) continue;

    const text = names.get(node.id) ?? node.label;
    const lift = node.signals.includes('entry') ? BEACON_HEIGHT + 12 : 12;
    const anchor = project(node.rx, node.ry, node.height + lift);
    const halfWidth = (text.length * size * 0.52) / 2 + 4;
    const box = {
      x1: anchor.x - halfWidth,
      y1: anchor.y - size,
      x2: anchor.x + halfWidth,
      y2: anchor.y + size * 0.35,
    };
    if (placed.some((other) => overlaps(other, box))) continue;

    placed.push(box);
    perDistrict.set(node.districtName, taken + 1);
    used += 1;

    // A hairline back to the roof. Over a dense district a floating name is
    // ambiguous about which building it belongs to, and guessing wrong is
    // worse than having no label at all.
    const roof = project(node.rx, node.ry, node.height);
    if (roof.y - anchor.y > size * 0.9) {
      stems.push(
        `<line x1="${r(anchor.x)}" y1="${r(anchor.y + size * 0.3)}" x2="${r(roof.x)}" y2="${r(
          roof.y - 1,
        )}"/>`,
      );
    }

    texts.push(`<text x="${r(anchor.x)}" y="${r(anchor.y)}">${escapeText(text)}</text>`);
  }

  return `<g class="atlas-labels" pointer-events="none" font-family="var(--font-sans)" font-size="${r(
    size,
  )}" font-weight="600" text-anchor="middle" fill="${tokens.label}" paint-order="stroke" stroke="${
    tokens.labelHalo
  }" stroke-width="${r((3.25 * density.scale) / fitScale)}" stroke-linejoin="round"><g class="atlas-label-stems" stroke="${
    tokens.districtLabel
  }" stroke-width="${r((0.9 * density.scale) / fitScale)}" stroke-opacity="0.5" fill="none" paint-order="normal">${stems.join(
    '',
  )}</g>${texts.join('')}</g>`;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function groundPoint(node: SceneNode, azimuth: Azimuth): Point {
  const centre = rotate(node.wx, node.wy, azimuth);
  return project(centre.x, centre.y, EDGE_ELEVATION);
}

/**
 * How far a building's material moves from its district's base colour.
 *
 * Two ingredients. File type is the meaningful one: tests and config sit back
 * so source reads forward. The second is a deterministic jitter keyed on the
 * file path, worth roughly one shade either way. Without it a dense district
 * of similar files renders as a single mass with a bumpy top, and individual
 * buildings stop being findable. It is texture, not information, which is why
 * it is small enough never to be mistaken for a category.
 */
function tone(node: PlacedNode): number {
  let base = 0;
  if (node.type === 'test') base = -7;
  else if (node.type === 'config' || node.type === 'docs') base = -4;
  else if (node.signals.length > 0) base = 5;

  return base + (hash01(node.id) * 2 - 1) * TEXTURE;
}

/** Cheap, stable string hash normalised to [0, 1). FNV-1a. */
function hash01(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function roofStroke(mat: Material, theme: ThemeName, node: PlacedNode): string {
  if (node.signals.includes('core')) return signalColor('core', theme);
  if (node.signals.includes('entry')) return signalColor('entry', theme);
  if (node.signals.includes('hotspot')) return signalColor('hotspot', theme);
  return mat.edge;
}

function labelWeight(node: PlacedNode): number {
  const rank = node.signals.includes('entry') ? 3 : node.signals.includes('core') ? 2 : 1;
  return rank * 1_000_000 + node.inDegree * 1000 + node.loc;
}

/** Longest label a map should carry before it becomes a caption. */
const MAX_LABEL_CHARS = 30;

/**
 * Name each candidate so a reader can tell two of them apart.
 *
 * Repositories are full of `index.ts` and `page.tsx`, and one level of parent
 * directory is not enough in a monorepo where five templates each own an
 * `app/page.tsx`. The obvious fix, extending the suffix until it is unique,
 * produces things like `fixtures/frameworks/next-app-custom-alias/app/page.tsx`
 * on the canvas, which is worse than the ambiguity it solves.
 *
 * So instead of lengthening the path, this finds the nearest ancestor
 * directory that actually distinguishes the file and shows only that:
 * `next-app-custom-alias/page.tsx`. Skipped levels are marked so nobody reads
 * the result as a real path.
 */
function uniqueNames(nodes: PlacedNode[]): Map<string, string> {
  const names = new Map<string, string>();
  const buckets = new Map<string, PlacedNode[]>();

  for (const node of nodes) {
    const list = buckets.get(node.label);
    if (list) list.push(node);
    else buckets.set(node.label, [node]);
  }

  for (const group of buckets.values()) {
    if (group.length === 1) {
      names.set(group[0].id, clip(group[0].label));
      continue;
    }

    const paths = group.map((node) => node.path.split('/'));
    const deepest = Math.max(...paths.map((parts) => parts.length));

    // Walk outward from the file looking for a level whose directory names are
    // all distinct. Depth 1 is the filename itself, which we already know is
    // shared, so start one level up.
    let chosen = 0;
    for (let depth = 2; depth <= deepest; depth += 1) {
      const segments = paths.map((parts) => parts[parts.length - depth]);
      if (segments.every(Boolean) && new Set(segments).size === group.length) {
        chosen = depth;
        break;
      }
    }

    group.forEach((node, index) => {
      const parts = paths[index];
      if (chosen === 0) {
        // Nothing distinguishes them by name. Position on the map does.
        names.set(node.id, clip(parts.slice(-2).join('/')));
        return;
      }
      const ancestor = parts[parts.length - chosen];
      // An ellipsis marks skipped levels. `..` would read as a real relative
      // path and send someone looking for a directory that is not there.
      const gap = chosen > 2 ? '/…/' : '/';
      names.set(node.id, clip(`${ancestor}${gap}${node.label}`));
    });
  }

  return names;
}

function clip(text: string): string {
  if (text.length <= MAX_LABEL_CHARS) return text;
  return `${text.slice(0, MAX_LABEL_CHARS - 1)}…`;
}

function overlaps(a: Box, b: Box): boolean {
  return !(a.x2 < b.x1 || b.x2 < a.x1 || a.y2 < b.y1 || b.y2 < a.y1);
}

export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

export { boundsOf };
