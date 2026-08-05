/**
 * The living skyline on the landing page.
 *
 * This is the only part of Atlas that is decorative rather than derived from a
 * repository, so it is held to one rule: it must be the same object the
 * product draws, not an illustration of it. Same projection, same palette,
 * same three faced blocks on district plates. What it adds is time.
 *
 * Three things move, and each one is saying something:
 *
 *   the camera turns    the city is a solid you can walk around, not a picture
 *   towers rebuild      a repository is not a fixed thing, it keeps changing
 *   beacons breathe     some files matter more than the rest
 *
 * Canvas rather than SVG. The map needs SVG for hit testing and for export;
 * this needs sixty frames a second of a scene that is different every frame,
 * and rebuilding a few hundred DOM nodes that often to decorate a hero section
 * would be an indefensible way to spend a visitor's battery.
 *
 * The camera turning continuously is also why this file cannot reuse the map's
 * box builder. At a quarter turn a box is exactly three quads; at an arbitrary
 * angle it is two or three of four possible side faces, and which ones are
 * visible has to be worked out per face, per frame.
 */

import { districtBody, hsl, plateMaterial, signalColor, type ThemeName } from '../palette';
import { TILE_X, TILE_Y, Z_SCALE, project, rotateFree, type Point } from './projection';

/* -------------------------------------------------------------------------- */
/* Composition                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Four districts tiled two by two, so the plan is square.
 *
 * This is not an aesthetic preference, it is what makes a turning camera
 * watchable. A long strip of districts is the obvious composition and it was
 * the first thing built here, but an elongated plan projects to a wildly
 * different silhouette at every angle: the city appeared to swell, shrink and
 * wander around its own frame as it turned. A square plan has a nearly
 * constant projected width through a full revolution, so the mass sits still
 * and only the geometry changes, which is the entire point.
 */
const DISTRICT_COLS = 2;
const DISTRICT_ROWS = 2;
const COLS = 4;
const ROWS = 4;
/** Distance between lot centres, in world units. */
const LOT = 40;
/** Building footprint, as a fraction of the lot. */
const FOOTPRINT = 0.33;
const PLATE_THICKNESS = 9;

const MIN_HEIGHT = 16;
const MAX_HEIGHT = 172;

/** Lots that carry a landmark, as flat indices across the whole city. */
const LANDMARKS = new Set([5, 26, 41, 58]);

/* -------------------------------------------------------------------------- */
/* Motion                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Radians per second. A full revolution takes about four minutes, so a visitor
 * who stays half a minute sees the city turn far enough to read as a solid and
 * nowhere near far enough to read as a carousel.
 */
const ANGULAR_SPEED = 0.025;
/** Where the camera starts, chosen so the first frame is a three quarter view. */
const START_ANGLE = -0.42;

/** Entrance: the city builds itself back to front. */
const RISE_MS = 850;
const RISE_STAGGER_MS = 13;

/** Rebuild: one tower retargets every so often, forever. */
const REBUILD_EVERY_MS = 900;
const REBUILD_MS = 1500;

/** Beacon breathing period, in milliseconds. */
const PULSE_MS = 3400;

/**
 * What a phone is asked to repaint, and how often.
 *
 * This is the hero element above the fold, so it is the first impression a
 * visitor gets, and it was the most expensive thing on the page for the
 * cheapest device likely to see it. Every frame repaints the entire backing
 * store: at device pixel ratio 2 on a 342 by 260 canvas that is 356,000 pixels
 * sixty times a second, which measured 10.5 frames per second at 6x CPU
 * throttling with 42 of 43 frames over 50ms.
 *
 * Two caps, both only on coarse pointers, because a laptop should keep the
 * full thing. Three quarter resolution costs 44% of the pixels and is not
 * visible at arm's length on a display this dense, and thirty frames is still
 * smooth for a camera turning through one degree every two seconds.
 */
const MAX_DPR_FINE = 2;
const MAX_DPR_COARSE = 1.5;
const MIN_FRAME_MS_COARSE = 32;

/** Peak of `easeOutBack` with the overshoot constant below, as a multiplier. */
const SETTLE_OVERSHOOT = 1.098;
/** How far a landmark beacon rises above its roof, in world units. */
const BEACON_HEIGHT = 46;

/* -------------------------------------------------------------------------- */
/* Light                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Direction the key light comes from, as an angle on the world ground plane.
 * At the map's default camera this puts the brighter face on the left and the
 * darker one on the right, which is what the static renderer hard-codes.
 */
const LIGHT_ANGLE = (135 * Math.PI) / 180;
const AMBIENT = -7;
const DIFFUSE = 9;
const TOP_BOOST = 13;

/**
 * Atmospheric perspective.
 *
 * Distant buildings lose contrast against the background: that is how eyes read
 * depth in the real world, and without it a field of identically saturated
 * blocks reads as a flat pattern no matter how correct the projection is. The
 * furthest tower gives up this many lightness points toward the canvas, and
 * this much of its chroma.
 */
const HAZE_LIGHTNESS = 11;
const HAZE_SATURATION = 0.34;

/**
 * Contact shadow: how far it leans per unit of height, how much it spreads, and
 * how dark it gets at full height.
 *
 * Opacity tracks height rather than being fixed. On this tight lot grid a
 * constant shadow tiles into a visible dark checkerboard across the plates,
 * and it is worst during the entrance when most towers are still near zero: a
 * building with no height casts nothing, which is both correct and the fix.
 */
const SHADOW_SKEW = 0.05;
const SHADOW_SPREAD = 1.06;
const SHADOW_ALPHA = 0.3;

/* -------------------------------------------------------------------------- */

export interface SkylineHandle {
  setTheme(theme: ThemeName): void;
  /** Stops the loop entirely, for when the hero scrolls away or the tab hides. */
  setRunning(running: boolean): void;
  destroy(): void;
}

interface Lot {
  /** World position of the lot centre. */
  x: number;
  y: number;
  districtIndex: number;
  landmark: boolean;
  /** Tween state, all in milliseconds on the scene clock. */
  from: number;
  to: number;
  startedAt: number;
  duration: number;
  /** Ordering used for the entrance sweep and for picking rebuild targets. */
  seed: number;
}

interface District {
  index: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  lots: Lot[];
}

export function createSkyline(
  canvas: HTMLCanvasElement,
  initialTheme: ThemeName,
  reducedMotion: boolean,
): SkylineHandle {
  const context = canvas.getContext('2d');
  let theme = initialTheme;
  let running = false;
  let frame = 0;
  let clock = 0;
  let lastFrameAt = 0;
  let lastDrawAt = 0;
  let nextRebuildAt = RISE_MS + 1200;

  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const minFrameMs = coarse ? MIN_FRAME_MS_COARSE : 0;

  const random = mulberry32(0x0a71a5);
  const { districts, lots, radius } = layout(random);
  const view = { scale: 1, offsetX: 0, offsetY: 0, width: 0, height: 0 };

  /* ---------------------------------------------------------------------- */

  function fit(): void {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, coarse ? MAX_DPR_COARSE : MAX_DPR_FINE);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context?.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Frame the city by its bounding circle rather than its current outline,
    // so a rotating skyline never breathes in and out of its own margins.
    const reach = radius * Math.SQRT2;
    const halfWidth = reach * TILE_X;
    // A tower can stand taller than MAX_HEIGHT for a moment: the settle easing
    // overshoots its target by about 9.7 percent, and a landmark carries a
    // beacon above its roof on top of that. Reserving only MAX_HEIGHT left
    // three tenths of a unit of margin out of three hundred, so roughly one
    // rebuild in twenty would have clipped a beacon against the top edge of
    // the hero. They retarget every second, forever.
    const top = -(reach * TILE_Y) - (MAX_HEIGHT * SETTLE_OVERSHOOT + BEACON_HEIGHT) * Z_SCALE;
    const bottom = reach * TILE_Y + PLATE_THICKNESS * Z_SCALE;

    const scale = Math.min(
      (width * 0.94) / (halfWidth * 2),
      (height * 0.96) / (bottom - top),
    );

    view.scale = scale;
    view.width = width;
    view.height = height;
    view.offsetX = width / 2;
    view.offsetY = height / 2 - ((top + bottom) / 2) * scale;
  }

  const toScreen = (p: Point): Point => ({
    x: view.offsetX + p.x * view.scale,
    y: view.offsetY + p.y * view.scale,
  });

  /** Footprint diamond of a lot, already in screen space. */
  function diamondScreen(cx: number, cy: number, half: number, angle: number, z: number): Point[] {
    return [
      [cx - half, cy - half],
      [cx + half, cy - half],
      [cx + half, cy + half],
      [cx - half, cy + half],
    ].map(([x, y]) => {
      const r = rotateFree(x, y, angle);
      return toScreen(project(r.x, r.y, z));
    });
  }

  /* ---------------------------------------------------------------------- */

  function heightOf(lot: Lot): number {
    if (clock <= lot.startedAt) return lot.from;
    const t = Math.min(1, (clock - lot.startedAt) / lot.duration);
    return lot.from + (lot.to - lot.from) * easeOutBack(t);
  }

  function scheduleRebuild(): void {
    // Never retarget a tower that is still moving: two overlapping tweens on
    // one lot reads as a glitch rather than as construction.
    const idle = lots.filter((lot) => clock > lot.startedAt + lot.duration);
    if (idle.length === 0) return;

    const lot = idle[Math.floor(random() * idle.length)];
    lot.from = heightOf(lot);
    lot.to = pickHeight(random, lot.landmark);
    lot.startedAt = clock;
    lot.duration = REBUILD_MS;
  }

  /* ---------------------------------------------------------------------- */

  function draw(): void {
    if (!context) return;
    const angle = reducedMotion ? START_ANGLE : START_ANGLE + ANGULAR_SPEED * (clock / 1000);

    context.clearRect(0, 0, view.width, view.height);
    drawGrid(context, angle);

    const placed = districts
      .map((district) => {
        const centre = rotateFree(
          (district.minX + district.maxX) / 2,
          (district.minY + district.maxY) / 2,
          angle,
        );
        return { district, depth: centre.x + centre.y };
      })
      .sort((a, b) => a.depth - b.depth);

    // One depth range for the whole city, so haze is continuous across district
    // boundaries rather than restarting inside each plate.
    let nearest = -Infinity;
    let furthest = Infinity;
    for (const lot of lots) {
      const centre = rotateFree(lot.x, lot.y, angle);
      const depth = centre.x + centre.y;
      if (depth > nearest) nearest = depth;
      if (depth < furthest) furthest = depth;
    }
    const span = Math.max(nearest - furthest, 1);

    for (const { district } of placed) {
      drawPlate(context, district, angle);

      const towers = district.lots
        .map((lot) => {
          const centre = rotateFree(lot.x, lot.y, angle);
          return { lot, depth: centre.x + centre.y };
        })
        .sort((a, b) => a.depth - b.depth);

      for (const { lot, depth } of towers) {
        drawTower(context, lot, angle, (depth - furthest) / span);
      }
    }
  }

  function drawGrid(ctx: CanvasRenderingContext2D, angle: number): void {
    const span = radius * 1.5;
    const step = LOT * 2;
    ctx.save();
    ctx.strokeStyle = theme === 'carbon' ? 'rgba(150,165,190,0.05)' : 'rgba(60,52,40,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let v = -span; v <= span; v += step) {
      const a = toScreen(project(...rotatedPair(v, -span, angle), -PLATE_THICKNESS));
      const b = toScreen(project(...rotatedPair(v, span, angle), -PLATE_THICKNESS));
      const c = toScreen(project(...rotatedPair(-span, v, angle), -PLATE_THICKNESS));
      const d = toScreen(project(...rotatedPair(span, v, angle), -PLATE_THICKNESS));
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawPlate(ctx: CanvasRenderingContext2D, district: District, angle: number): void {
    const material = plateMaterial(district.index, theme);
    const cx = (district.minX + district.maxX) / 2;
    const cy = (district.minY + district.maxY) / 2;
    const hx = (district.maxX - district.minX) / 2;
    const hy = (district.maxY - district.minY) / 2;
    paintBox(ctx, cx, cy, hx, hy, -PLATE_THICKNESS, PLATE_THICKNESS, angle, {
      top: material.top,
      // Shaded by the same light the towers use. Picking the two side colours
      // by face parity instead looked identical at a glance and was inverted
      // for half of every revolution: the slab was lit from one side while the
      // buildings standing on it were lit from the other.
      side: (normal) => (Math.cos(normal - LIGHT_ANGLE) > 0 ? material.left : material.right),
      stroke: material.edge,
    });
  }

  /**
   * @param nearness 0 at the furthest tower in the frame, 1 at the nearest
   */
  function drawTower(
    ctx: CanvasRenderingContext2D,
    lot: Lot,
    angle: number,
    nearness: number,
  ): void {
    const height = Math.max(0.5, heightOf(lot));
    const half = LOT * FOOTPRINT;

    // Haze pulls a distant tower toward the canvas and drains its chroma.
    const raw = districtBody(lot.districtIndex, theme);
    const toward = theme === 'carbon' ? -HAZE_LIGHTNESS : HAZE_LIGHTNESS;
    const haze = 1 - nearness;
    const body = {
      h: raw.h,
      s: raw.s * (1 - HAZE_SATURATION * haze),
      l: raw.l + toward * haze,
    };

    // Contact shadow first, leaning further the taller the building. This is
    // what stops the towers reading as stickers laid on the plate.
    const lift = Math.min(height / MAX_HEIGHT, 1);
    if (lift > 0.02) {
      const skew = height * SHADOW_SKEW;
      const alpha = SHADOW_ALPHA * lift * (theme === 'carbon' ? 1 : 0.55);
      ctx.fillStyle =
        theme === 'carbon' ? `rgba(0,0,0,${alpha.toFixed(3)})` : `rgba(52,44,32,${alpha.toFixed(3)})`;
      fillPolygon(
        ctx,
        diamondScreen(lot.x + skew, lot.y + skew, half * SHADOW_SPREAD, angle, 0.4),
      );
    }

    paintBox(ctx, lot.x, lot.y, half, half, 0, height, angle, {
      top: lot.landmark
        ? signalColor('hotspot', theme)
        : hsl({ ...body, l: clamp(body.l + TOP_BOOST, 4, 96) }),
      side: (normal) =>
        hsl({
          ...body,
          l: clamp(body.l + AMBIENT + DIFFUSE * Math.cos(normal - LIGHT_ANGLE), 4, 96),
        }),
      // A hairline where the roof meets the sky, the way light catches a real
      // parapet. Cheap, and it is most of what makes the blocks look cut
      // rather than drawn.
      rim: hsl({ ...body, s: clamp(body.s - 8, 0, 100), l: clamp(body.l + 26, 0, 98) }, 0.45),
    });

    if (!lot.landmark) return;

    // A slow breath rather than a blink. Anything faster reads as an alert.
    const phase = (clock + lot.seed * 900) / PULSE_MS;
    const pulse = reducedMotion ? 0.7 : 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2));
    const rotated = rotateFree(lot.x, lot.y, angle);
    const base = toScreen(project(rotated.x, rotated.y, height));
    const tip = toScreen(project(rotated.x, rotated.y, height + BEACON_HEIGHT));
    const beacon = signalColor('entry', theme);

    const gradient = ctx.createLinearGradient(base.x, base.y, tip.x, tip.y);
    gradient.addColorStop(0, withAlpha(beacon, 0.85 * pulse));
    gradient.addColorStop(1, withAlpha(beacon, 0));

    ctx.save();
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2 * view.scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();

    const spark = 4.5 * view.scale;
    ctx.fillStyle = withAlpha(beacon, pulse);
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y - spark * 0.5);
    ctx.lineTo(tip.x + spark, tip.y);
    ctx.lineTo(tip.x, tip.y + spark * 0.5);
    ctx.lineTo(tip.x - spark, tip.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  interface BoxPaint {
    top: string;
    /** Given the outward normal angle of a side face, return its colour. */
    side: (normalAngle: number) => string;
    /** Hairline drawn around the roof only. */
    rim?: string;
    stroke?: string;
  }

  /**
   * Paint an upright box at an arbitrary camera angle.
   *
   * Which of the four side faces are visible changes as the city turns, so
   * each one is tested by the sign of its projected area rather than assumed.
   */
  function paintBox(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    hx: number,
    hy: number,
    base: number,
    height: number,
    angle: number,
    paint: BoxPaint,
  ): void {
    const corners: Array<[number, number]> = [
      [cx - hx, cy - hy],
      [cx + hx, cy - hy],
      [cx + hx, cy + hy],
      [cx - hx, cy + hy],
    ];
    const normals = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];

    const lo: Point[] = [];
    const hi: Point[] = [];
    for (const [x, y] of corners) {
      const r = rotateFree(x, y, angle);
      lo.push(toScreen(project(r.x, r.y, base)));
      hi.push(toScreen(project(r.x, r.y, base + height)));
    }

    for (let i = 0; i < 4; i += 1) {
      const j = (i + 1) % 4;
      const quad = [lo[i], lo[j], hi[j], hi[i]];
      if (signedArea(quad) <= 0) continue; // face is pointing away
      ctx.fillStyle = paint.side(normals[i] + angle);
      fillPolygon(ctx, quad);
    }

    ctx.fillStyle = paint.top;
    fillPolygon(ctx, hi);
    if (paint.stroke || paint.rim) {
      ctx.strokeStyle = (paint.stroke ?? paint.rim) as string;
      ctx.lineWidth = paint.rim && !paint.stroke ? 0.75 : 1;
      ctx.stroke();
    }
  }

  /* ---------------------------------------------------------------------- */

  function tick(now: number): void {
    if (!running) return;

    // Clamp the step so a backgrounded tab does not resume by fast forwarding
    // through a minute of construction in one frame.
    const delta = lastFrameAt === 0 ? 16 : Math.min(now - lastFrameAt, 64);
    lastFrameAt = now;
    clock += delta;

    if (!reducedMotion) {
      while (clock >= nextRebuildAt) {
        scheduleRebuild();
        nextRebuildAt += REBUILD_EVERY_MS;
      }
    }

    // The clock keeps full resolution whether or not this frame is painted, so
    // capping the paint rate slows nothing down: the city turns at the same
    // speed and the tweens land at the same moment, there are simply fewer
    // pictures of it.
    if (now - lastDrawAt >= minFrameMs) {
      lastDrawAt = now;
      draw();
    }
    frame = requestAnimationFrame(tick);
  }

  function setRunning(next: boolean): void {
    if (next === running) return;
    running = next;
    if (running) {
      lastFrameAt = 0;
      frame = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(frame);
    }
  }

  // ResizeObserver rather than a window listener: the canvas is inside a
  // responsive column, so it changes size for reasons the window never hears
  // about, and it can legitimately measure zero on the first frame.
  const observer = new ResizeObserver(() => {
    fit();
    draw();
  });
  observer.observe(canvas);

  fit();
  if (reducedMotion) {
    // One settled frame, no loop at all.
    clock = RISE_MS + RISE_STAGGER_MS * lots.length + REBUILD_MS;
    draw();
  } else {
    setRunning(true);
  }

  return {
    setTheme(next) {
      theme = next;
      draw();
    },
    setRunning(next) {
      if (reducedMotion) return;
      setRunning(next);
    },
    destroy() {
      setRunning(false);
      observer.disconnect();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

function layout(random: () => number): {
  districts: District[];
  lots: Lot[];
  radius: number;
} {
  const districts: District[] = [];
  const lots: Lot[] = [];
  const plateWidth = COLS * LOT;
  const plateHeight = ROWS * LOT;
  let seed = 0;

  for (let dy = 0; dy < DISTRICT_ROWS; dy += 1) {
    for (let dx = 0; dx < DISTRICT_COLS; dx += 1) {
      const index = dy * DISTRICT_COLS + dx;
      // Plates tile exactly, with no margin between them. Overlapping plates
      // would paint over each other at the seam; a gap would break the
      // landmass into islands. Buildings get their breathing room from the
      // half lot of padding the grid leaves at each edge.
      const originX = (dx - (DISTRICT_COLS - 1) / 2) * plateWidth;
      const originY = (dy - (DISTRICT_ROWS - 1) / 2) * plateHeight;
      const districtLots: Lot[] = [];

      for (let row = 0; row < ROWS; row += 1) {
        for (let col = 0; col < COLS; col += 1) {
          const landmark = LANDMARKS.has(seed);
          const lot: Lot = {
            x: originX + (col - (COLS - 1) / 2) * LOT,
            y: originY + (row - (ROWS - 1) / 2) * LOT,
            districtIndex: index,
            landmark,
            from: 0,
            to: pickHeight(random, landmark),
            startedAt: 0,
            duration: RISE_MS,
            seed,
          };
          districtLots.push(lot);
          lots.push(lot);
          seed += 1;
        }
      }

      districts.push({
        index,
        minX: originX - plateWidth / 2,
        maxX: originX + plateWidth / 2,
        minY: originY - plateHeight / 2,
        maxY: originY + plateHeight / 2,
        lots: districtLots,
      });
    }
  }

  // The entrance sweeps back to front along the starting camera's depth axis.
  const order = [...lots].sort((a, b) => {
    const ra = rotateFree(a.x, a.y, START_ANGLE);
    const rb = rotateFree(b.x, b.y, START_ANGLE);
    return ra.x + ra.y - (rb.x + rb.y);
  });
  order.forEach((lot, index) => {
    lot.startedAt = index * RISE_STAGGER_MS;
  });

  let radius = 0;
  for (const district of districts) {
    for (const [x, y] of [
      [district.minX, district.minY],
      [district.maxX, district.minY],
      [district.maxX, district.maxY],
      [district.minX, district.maxY],
    ]) {
      radius = Math.max(radius, Math.hypot(x, y));
    }
  }

  return { districts, lots, radius };
}

function pickHeight(random: () => number, landmark: boolean): number {
  // Cubed, so short buildings are common and towers are an event. A uniform
  // draw gives a hedge rather than a skyline.
  const t = random() ** 2.1;
  const height = MIN_HEIGHT + t * (MAX_HEIGHT - MIN_HEIGHT);
  return landmark ? Math.max(height, MAX_HEIGHT * 0.62) : height;
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

function rotatedPair(x: number, y: number, angle: number): [number, number] {
  const r = rotateFree(x, y, angle);
  return [r.x, r.y];
}

function fillPolygon(ctx: CanvasRenderingContext2D, points: Point[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fill();
}

function signedArea(points: Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += a.x * b.y - b.x * a.y;
  }
  return total / 2;
}

/** Overshoots the target slightly and settles, the way a crane sets a load. */
function easeOutBack(t: number): number {
  const c = 1.34;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** `hsl(h s% l%)` to `hsl(h s% l% / a)`. The palette only ever emits that form. */
function withAlpha(colour: string, alpha: number): string {
  const inner = colour.slice(colour.indexOf('(') + 1, colour.lastIndexOf(')'));
  return `hsl(${inner.split('/')[0].trim()} / ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/** Seeded, so the city builds itself the same way on every visit. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
