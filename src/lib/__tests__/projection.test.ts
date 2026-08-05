/**
 * Isometric camera maths.
 *
 * The renderer and the PNG exporter both treat this module as a contract:
 * quarter turns must be exact, the diamond winding order must be provable from
 * the numbers rather than from the comment next to them, and the depth key must
 * sort on the near corner or the painter's algorithm punches holes in the city.
 */

import { describe, it, expect } from 'vitest';
import {
  AZIMUTHS,
  TILE_X,
  TILE_Y,
  Z_SCALE,
  boundsOf,
  boxFaces,
  depthOf,
  diamond,
  polygonPoints,
  project,
  projectWorld,
  r,
  rotate,
  rotateExtent,
  type Azimuth,
  type Point,
} from '../iso/projection';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Sample ground points chosen to sit in all four quadrants and on the axes. */
const SAMPLES: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 13, y: 29 },
  { x: -7, y: 4 },
  { x: -11, y: -23 },
  { x: 6.5, y: -18.25 },
];

/** Signed area via the shoelace formula. Zero means the polygon is degenerate. */
function area(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function key(point: Point): string {
  return `${point.x}:${point.y}`;
}

/* -------------------------------------------------------------------------- */

describe('rotating the ground plane', () => {
  it('leaves every point exactly where it was at azimuth 0', () => {
    for (const p of SAMPLES) {
      expect(rotate(p.x, p.y, 0)).toEqual({ x: p.x, y: p.y });
    }
  });

  it('returns to the original point after four quarter turns, for every azimuth', () => {
    for (const azimuth of AZIMUTHS) {
      for (const p of SAMPLES) {
        let current = { x: p.x, y: p.y };
        for (let turn = 0; turn < 4; turn += 1) {
          current = rotate(current.x, current.y, azimuth);
        }
        expect(current.x).toBeCloseTo(p.x, 12);
        expect(current.y).toBeCloseTo(p.y, 12);
      }
    }
  });

  it('is a real quarter turn and not a reflection, so a single point visits four distinct places', () => {
    // Repeatedly applying azimuth 1 must walk the point around the origin.
    const start = { x: 3, y: 8 };
    const orbit = [start];
    for (let turn = 0; turn < 3; turn += 1) {
      const previous = orbit[orbit.length - 1];
      orbit.push(rotate(previous.x, previous.y, 1));
    }

    expect(new Set(orbit.map(key)).size).toBe(4);
    expect(orbit[1]).toEqual({ x: -8, y: 3 });
    expect(orbit[2]).toEqual({ x: -3, y: -8 });
    expect(orbit[3]).toEqual({ x: 8, y: -3 });

    // A half turn has to be the same thing done twice.
    expect(rotate(start.x, start.y, 2)).toEqual(orbit[2]);
    // And azimuth 3 has to be the inverse of azimuth 1.
    expect(rotate(orbit[1].x, orbit[1].y, 3)).toEqual(start);
  });

  it('keeps a point the same distance from the origin under any azimuth', () => {
    for (const azimuth of AZIMUTHS) {
      for (const p of SAMPLES) {
        const turned = rotate(p.x, p.y, azimuth);
        expect(Math.hypot(turned.x, turned.y)).toBeCloseTo(Math.hypot(p.x, p.y), 12);
      }
    }
  });
});

describe('rotating half extents', () => {
  it('swaps the two half extents on odd quarter turns and leaves them alone on even ones', () => {
    expect(rotateExtent(3, 9, 0)).toEqual({ x: 3, y: 9 });
    expect(rotateExtent(3, 9, 1)).toEqual({ x: 9, y: 3 });
    expect(rotateExtent(3, 9, 2)).toEqual({ x: 3, y: 9 });
    expect(rotateExtent(3, 9, 3)).toEqual({ x: 9, y: 3 });
  });

  it('agrees with what rotating the four footprint corners would produce', () => {
    const hx = 4;
    const hy = 11;
    for (const azimuth of AZIMUTHS) {
      const corners = [
        rotate(hx, hy, azimuth),
        rotate(hx, -hy, azimuth),
        rotate(-hx, hy, azimuth),
        rotate(-hx, -hy, azimuth),
      ];
      const expected = {
        x: Math.max(...corners.map((c) => Math.abs(c.x))),
        y: Math.max(...corners.map((c) => Math.abs(c.y))),
      };
      expect(rotateExtent(hx, hy, azimuth)).toEqual(expected);
    }
  });
});

describe('projecting into screen space', () => {
  it('puts the world origin on the screen origin', () => {
    expect(project(0, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(project(0, 0)).toEqual({ x: 0, y: 0 });
    for (const azimuth of AZIMUTHS) {
      // Rotating the origin can hand back a negative zero, which is harmless
      // once serialised but is not the same value to a deep equality check.
      const origin = projectWorld(0, 0, 0, azimuth);
      expect(origin.x).toBeCloseTo(0, 12);
      expect(origin.y).toBeCloseTo(0, 12);
    }
  });

  it('moves a point straight up the screen when it gains elevation, and nowhere else', () => {
    for (const p of SAMPLES) {
      const ground = project(p.x, p.y, 0);
      const raised = project(p.x, p.y, 40);

      expect(raised.x).toBe(ground.x);
      expect(raised.y).toBeLessThan(ground.y);
      expect(ground.y - raised.y).toBeCloseTo(40 * Z_SCALE, 12);
    }
  });

  it('uses a 2:1 tile, so one ground unit costs twice as much screen width as height', () => {
    expect(TILE_X / TILE_Y).toBe(2);
    const alongX = project(10, 0, 0);
    const alongY = project(0, 10, 0);
    expect(alongX).toEqual({ x: 10 * TILE_X, y: 10 * TILE_Y });
    expect(alongY).toEqual({ x: -10 * TILE_X, y: 10 * TILE_Y });
  });

  it('is the same thing as rotating first and projecting second', () => {
    for (const azimuth of AZIMUTHS) {
      for (const p of SAMPLES) {
        const turned = rotate(p.x, p.y, azimuth);
        expect(projectWorld(p.x, p.y, 12, azimuth)).toEqual(project(turned.x, turned.y, 12));
      }
    }
  });
});

describe('the footprint diamond', () => {
  const rx = 17;
  const ry = -6;
  const hx = 9;
  const hy = 4;

  it('orders its corners so index 0 is highest, 2 is lowest, 1 is rightmost and 3 is leftmost', () => {
    // Asserted from the coordinates, not from the comment in the source.
    const points = diamond(rx, ry, hx, hy, 3);
    const ys = points.map((p) => p.y);
    const xs = points.map((p) => p.x);

    // Screen y grows downward, so "highest" is the smallest y.
    expect(ys[0]).toBe(Math.min(...ys));
    expect(ys[2]).toBe(Math.max(...ys));
    expect(xs[1]).toBe(Math.max(...xs));
    expect(xs[3]).toBe(Math.min(...xs));

    // And the ordering must be strict, not merely a tie won on index.
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[0]).toBeLessThan(ys[3]);
    expect(ys[2]).toBeGreaterThan(ys[1]);
    expect(ys[2]).toBeGreaterThan(ys[3]);
    expect(xs[1]).toBeGreaterThan(xs[0]);
    expect(xs[1]).toBeGreaterThan(xs[2]);
    expect(xs[3]).toBeLessThan(xs[0]);
    expect(xs[3]).toBeLessThan(xs[2]);
  });

  it('holds that ordering for every azimuth once the extents have been rotated', () => {
    for (const azimuth of AZIMUTHS) {
      const centre = rotate(rx, ry, azimuth);
      const extent = rotateExtent(hx, hy, azimuth);
      const points = diamond(centre.x, centre.y, extent.x, extent.y, 0);
      const ys = points.map((p) => p.y);
      const xs = points.map((p) => p.x);
      expect(ys[0]).toBe(Math.min(...ys));
      expect(ys[2]).toBe(Math.max(...ys));
      expect(xs[1]).toBe(Math.max(...xs));
      expect(xs[3]).toBe(Math.min(...xs));
    }
  });

  it('stays centred on the point it was built from', () => {
    const points = diamond(rx, ry, hx, hy, 5);
    const centre = project(rx, ry, 5);
    const mean = {
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    };
    expect(mean.x).toBeCloseTo(centre.x, 12);
    expect(mean.y).toBeCloseTo(centre.y, 12);
  });

  it('draws a square footprint as a diamond twice as wide as it is tall', () => {
    const points = diamond(0, 0, 10, 10, 0);
    const width = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
    const height = Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));
    expect(width / height).toBeCloseTo(2, 12);
  });

  it('lifts every corner by the same amount when the elevation rises', () => {
    const ground = diamond(rx, ry, hx, hy, 0);
    const roof = diamond(rx, ry, hx, hy, 30);
    roof.forEach((p, i) => {
      expect(p.x).toBe(ground[i].x);
      expect(ground[i].y - p.y).toBeCloseTo(30 * Z_SCALE, 12);
    });
  });
});

describe('the three visible faces of a box', () => {
  const rx = 12;
  const ry = 21;
  const hx = 6;
  const hy = 6;
  const base = 4;
  const height = 25;
  const faces = boxFaces(rx, ry, hx, hy, base, height);

  it('roofs the box with the footprint diamond taken at base plus height', () => {
    expect(faces.top).toEqual(diamond(rx, ry, hx, hy, base + height));
  });

  it('gives the left and right walls four corners each', () => {
    expect(faces.left).toHaveLength(4);
    expect(faces.right).toHaveLength(4);
  });

  it('shares exactly the two near corner points between the left and right walls', () => {
    const leftKeys = new Set(faces.left.map(key));
    const shared = faces.right.filter((p) => leftKeys.has(key(p)));

    expect(shared).toHaveLength(2);
    // The shared edge is the vertical one at the near corner of the footprint.
    expect(new Set(shared.map((p) => p.x)).size).toBe(1);
    expect(shared.map(key).sort()).toEqual(
      [project(rx + hx, ry + hy, base), project(rx + hx, ry + hy, base + height)].map(key).sort(),
    );
  });

  it('puts the apex directly above the anchor', () => {
    expect(faces.apex.x).toBe(faces.anchor.x);
    expect(faces.apex.y).toBeLessThan(faces.anchor.y);
    expect(faces.anchor.y - faces.apex.y).toBeCloseTo(height * Z_SCALE, 12);
  });

  it('gives both walls real area when the box has height', () => {
    expect(area(faces.left)).toBeGreaterThan(0);
    expect(area(faces.right)).toBeGreaterThan(0);
    expect(area(faces.top)).toBeGreaterThan(0);
  });

  it('collapses both walls to nothing when the box has no height', () => {
    const flat = boxFaces(rx, ry, hx, hy, base, 0);

    expect(area(flat.left)).toBe(0);
    expect(area(flat.right)).toBe(0);
    // The roof is still a diamond, it just sits on the ground.
    expect(area(flat.top)).toBeGreaterThan(0);
    expect(flat.top).toEqual(diamond(rx, ry, hx, hy, base));
    expect(flat.apex).toEqual(flat.anchor);
  });
});

describe('depth ordering for the painter', () => {
  it('sorts a node that is further along both camera axes later', () => {
    expect(depthOf(0, 0)).toBeLessThan(depthOf(1, 0));
    expect(depthOf(1, 0)).toBeLessThan(depthOf(1, 1));
    expect(depthOf(-40, -40)).toBeLessThan(depthOf(40, 40));
  });

  it('keys on the near corner, so a large box in front of a small one sorts after it', () => {
    // The small box sits further from the camera along both axes, but the large
    // box reaches past it. Keying on the centre would get this the wrong way
    // round and the big box would be painted first and then punched through.
    const small = depthOf(10, 10, 1, 1);
    const large = depthOf(0, 0, 20, 20);

    expect(large).toBeGreaterThan(small);
    // Sanity check that the centres alone would have said the opposite.
    expect(depthOf(0, 0)).toBeLessThan(depthOf(10, 10));
  });

  it('treats a box with no extent as a bare point', () => {
    expect(depthOf(5, 7)).toBe(depthOf(5, 7, 0, 0));
  });

  it('grows monotonically with the extent, so a wider box never sorts earlier', () => {
    let previous = depthOf(3, 3, 0, 0);
    for (let extent = 1; extent < 20; extent += 1) {
      const current = depthOf(3, 3, extent, extent);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
  });
});

describe('screen bounds', () => {
  it('falls back to a unit box for an empty point set instead of returning infinities', () => {
    const bounds = boundsOf([]);

    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
    for (const value of Object.values(bounds)) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('wraps every point it is handed', () => {
    const points: Point[] = [
      { x: -4, y: 9 },
      { x: 30, y: -2 },
      { x: 11, y: 11 },
    ];
    expect(boundsOf(points)).toEqual({ minX: -4, minY: -2, maxX: 30, maxY: 11 });
  });

  it('collapses to a zero sized box around a single point', () => {
    expect(boundsOf([{ x: 6, y: -3 }])).toEqual({ minX: 6, minY: -3, maxX: 6, maxY: -3 });
  });
});

describe('serialising points for SVG', () => {
  it('rounds to two decimals', () => {
    expect(r(1.234)).toBe(1.23);
    expect(r(1.236)).toBe(1.24);
    expect(r(0)).toBe(0);
    expect(r(12)).toBe(12);
  });

  it('rounds negative values to two decimals as well', () => {
    expect(r(-1.234)).toBe(-1.23);
    expect(r(-1.236)).toBe(-1.24);
    expect(r(-12)).toBe(-12);
  });

  it('breaks an exact half toward positive infinity, in both directions', () => {
    // 0.125 is exactly representable, so this is a real tie rather than a
    // floating point accident. Pinned because it decides whether a shared edge
    // between two polygons rounds to the same sub pixel on both sides.
    expect(r(0.125)).toBe(0.13);
    expect(r(-0.125)).toBe(-0.12);
  });

  it('collapses a value below the sub pixel threshold to a plain zero', () => {
    expect(r(-0.001)).toBe(-0);
    // Negative zero must still serialise as "0" and never as "-0".
    expect(`${r(-0.001)}`).toBe('0');
  });

  it('writes each point as x,y and separates points with a single space', () => {
    const out = polygonPoints([
      { x: 1.005, y: 2 },
      { x: -3.456, y: 4.5 },
    ]);
    expect(out).toBe('1,2 -3.46,4.5');
    expect(out.split(' ')).toHaveLength(2);
  });

  it('returns an empty string when there is nothing to draw', () => {
    expect(polygonPoints([])).toBe('');
  });

  it('never emits scientific notation, at either end of the range', () => {
    const out = polygonPoints([
      { x: 1e-7, y: -1e-7 },
      { x: 0.004, y: -0.004 },
      { x: 123456.789, y: -98765.4321 },
    ]);

    expect(out).not.toMatch(/e/i);
    for (const pair of out.split(' ')) {
      expect(pair).toMatch(/^-?\d+(\.\d{1,2})?,-?\d+(\.\d{1,2})?$/);
    }
    expect(out).toBe('0,0 0,0 123456.79,-98765.43');
  });

  it('survives a full box round trip without producing anything a browser would reject', () => {
    for (const azimuth of AZIMUTHS) {
      const centre = rotate(-133.5, 88.25, azimuth as Azimuth);
      const extent = rotateExtent(11.3, 7.7, azimuth as Azimuth);
      const faces = boxFaces(centre.x, centre.y, extent.x, extent.y, 0, 63.4);
      for (const face of [faces.top, faces.left, faces.right]) {
        expect(polygonPoints(face)).toMatch(
          /^-?\d+(\.\d{1,2})?,-?\d+(\.\d{1,2})?( -?\d+(\.\d{1,2})?,-?\d+(\.\d{1,2})?){3}$/,
        );
      }
    }
  });
});
