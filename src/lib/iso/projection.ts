/**
 * Isometric camera maths.
 *
 * Everything here is pure and side effect free so it can be unit tested and
 * reused by the PNG exporter without touching the DOM.
 *
 * World space is the layout plane the backend produces: `x` and `y` are ground
 * coordinates in layout units, `z` is elevation, positive upward.
 *
 * The projection is 2:1 ("game") isometric rather than a true 30 degree
 * dimetric. A 2:1 tile puts every edge on a 1/2 slope, which lands on whole
 * pixels far more often and keeps the skyline crisp at small zoom levels.
 */

/** Screen units consumed by one world unit along the ground x axis. */
export const TILE_X = 0.5;
/** Screen units consumed by one world unit along the ground y axis. */
export const TILE_Y = 0.25;
/** Screen units consumed by one world unit of elevation. */
export const Z_SCALE = 1;

/** Camera orientation, in 90 degree steps counter clockwise. */
export type Azimuth = 0 | 1 | 2 | 3;

export const AZIMUTHS: Azimuth[] = [0, 1, 2, 3];

export interface Point {
  x: number;
  y: number;
}

/**
 * Rotate a ground point by whole quarter turns.
 *
 * Restricting the camera to quarter turns is a deliberate constraint: every
 * building footprint stays axis aligned in camera space, so a box is always
 * exactly three flat quads and never a skewed mess. It also makes the depth
 * sort exact instead of approximate.
 */
export function rotate(x: number, y: number, azimuth: Azimuth): Point {
  switch (azimuth) {
    case 1:
      return { x: -y, y: x };
    case 2:
      return { x: -x, y: -y };
    case 3:
      return { x: y, y: -x };
    default:
      return { x, y };
  }
}

/** Half extents swap on odd quarter turns. */
export function rotateExtent(hx: number, hy: number, azimuth: Azimuth): Point {
  return azimuth % 2 === 1 ? { x: hy, y: hx } : { x: hx, y: hy };
}

/** Project a camera space ground point plus elevation into screen space. */
export function project(rx: number, ry: number, z = 0): Point {
  return {
    x: (rx - ry) * TILE_X,
    y: (rx + ry) * TILE_Y - z * Z_SCALE,
  };
}

/** Project straight from world space. Convenience for one-off points. */
export function projectWorld(x: number, y: number, z: number, azimuth: Azimuth): Point {
  const r = rotate(x, y, azimuth);
  return project(r.x, r.y, z);
}

/**
 * Painter's algorithm key. Larger means nearer to the camera, so ascending
 * order draws back to front.
 *
 * Keying on the near corner rather than the centre is what stops a large, low
 * building from punching through a small one standing in front of it.
 */
export function depthOf(rx: number, ry: number, hx = 0, hy = 0): number {
  return rx + hx + (ry + hy);
}

/**
 * The four screen points of a footprint diamond at a given elevation.
 * Order is top, right, bottom, left, which is also the winding order the
 * quad builders below expect.
 */
export function diamond(rx: number, ry: number, hx: number, hy: number, z: number): Point[] {
  return [
    project(rx - hx, ry - hy, z), // far corner, highest on screen
    project(rx + hx, ry - hy, z), // right
    project(rx + hx, ry + hy, z), // near corner, lowest on screen
    project(rx - hx, ry + hy, z), // left
  ];
}

export interface BoxFaces {
  /** Diamond of the roof. */
  top: Point[];
  /** Quad facing down-left. */
  left: Point[];
  /** Quad facing down-right. */
  right: Point[];
  /** Roof centre, useful for labels and beacons. */
  apex: Point;
  /** Ground centre, useful for shadows and dependency arcs. */
  anchor: Point;
}

/**
 * Build the three visible faces of an axis aligned box.
 *
 * `base` is the elevation the box stands on, `height` how far it rises. Only
 * three of the six faces can ever face this camera, so the other three are
 * never generated.
 */
export function boxFaces(
  rx: number,
  ry: number,
  hx: number,
  hy: number,
  base: number,
  height: number,
): BoxFaces {
  const lo = diamond(rx, ry, hx, hy, base);
  const hi = diamond(rx, ry, hx, hy, base + height);

  return {
    top: hi,
    // left face spans the left vertex to the near vertex
    left: [lo[3], lo[2], hi[2], hi[3]],
    // right face spans the near vertex to the right vertex
    right: [lo[2], lo[1], hi[1], hi[2]],
    apex: project(rx, ry, base + height),
    anchor: project(rx, ry, base),
  };
}

/** Screen space bounding box of a set of points. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(points: Point[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

/** Serialise points as an SVG `points` attribute, rounded to sub pixel. */
export function polygonPoints(points: Point[]): string {
  let out = '';
  for (let i = 0; i < points.length; i += 1) {
    if (i > 0) out += ' ';
    out += `${r(points[i].x)},${r(points[i].y)}`;
  }
  return out;
}

/** Two decimals is below the visible threshold and keeps the markup small. */
export function r(value: number): number {
  return Math.round(value * 100) / 100;
}
