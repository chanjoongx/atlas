/**
 * Single source of truth for every colour that gets drawn onto the map.
 *
 * Districts own a hue for life. Themes move lightness and chroma, never hue,
 * so a repo looks like the same city in Carbon and in Paper, and a screenshot
 * taken in either theme stays readable next to the other.
 */

export type ThemeName = 'carbon' | 'paper';

/** Twelve hand-spaced hues, ordered so neighbouring districts stay distinct. */
const HUES = [214, 168, 340, 38, 268, 194, 16, 142, 302, 52, 238, 108] as const;

/** Per-theme base material for a district body. */
const BODY: Record<ThemeName, { s: number; l: number }> = {
  carbon: { s: 58, l: 62 },
  paper: { s: 52, l: 47 },
};

/** Lightness/saturation deltas applied per isometric face. */
const FACE: Record<ThemeName, Record<Face, { dl: number; ds: number }>> = {
  carbon: {
    top: { dl: 13, ds: -6 },
    left: { dl: -5, ds: 0 },
    right: { dl: -16, ds: -8 },
  },
  paper: {
    top: { dl: 14, ds: -8 },
    left: { dl: -4, ds: 0 },
    right: { dl: -13, ds: -4 },
  },
};

export type Face = 'top' | 'left' | 'right';

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export interface Material {
  /** Flat colour, used for legends, chips and the 2D fallback. */
  base: string;
  top: string;
  left: string;
  right: string;
  /** Hairline that separates adjacent faces. */
  edge: string;
}

export function hsl({ h, s, l }: Hsl, alpha = 1): string {
  const S = clamp(s, 0, 100);
  const L = clamp(l, 0, 100);
  return alpha >= 1
    ? `hsl(${round(h)} ${round(S)}% ${round(L)}%)`
    : `hsl(${round(h)} ${round(S)}% ${round(L)}% / ${round(alpha, 3)})`;
}

/** Stable hue for the nth district of a repo. */
export function districtHue(index: number): number {
  return HUES[((index % HUES.length) + HUES.length) % HUES.length];
}

export function districtBody(index: number, theme: ThemeName): Hsl {
  return { h: districtHue(index), ...BODY[theme] };
}

/** Flat district colour, for legend swatches and district labels. */
export function districtColor(index: number, theme: ThemeName): string {
  return hsl(districtBody(index, theme));
}

/**
 * Build the three shaded faces of an extruded block.
 *
 * `tone` nudges the whole material up or down so that, inside one district,
 * a tall landmark still separates from the low-rise around it. Pass 0 for the
 * district's own colour.
 */
export function material(index: number, theme: ThemeName, tone = 0): Material {
  const body = districtBody(index, theme);
  const lit: Hsl = { ...body, l: clamp(body.l + tone, 8, 92) };
  const faces = FACE[theme];

  const shade = (face: Face): string =>
    hsl({
      h: lit.h,
      s: clamp(lit.s + faces[face].ds, 0, 100),
      l: clamp(lit.l + faces[face].dl, 4, 96),
    });

  return {
    base: hsl(lit),
    top: shade('top'),
    left: shade('left'),
    right: shade('right'),
    edge: hsl(
      { h: lit.h, s: clamp(lit.s - 10, 0, 100), l: clamp(lit.l + 24, 0, 98) },
      theme === 'carbon' ? 0.34 : 0.42,
    ),
  };
}

/**
 * The slab a district stands on. Ground should never compete with the
 * buildings, so it keeps the district hue but drops most of its chroma and
 * sits close to the canvas lightness.
 */
export function plateMaterial(index: number, theme: ThemeName): Material {
  const h = districtHue(index);
  const body: Hsl = theme === 'carbon' ? { h, s: 26, l: 15 } : { h, s: 22, l: 88 };
  const faces = FACE[theme];
  const shade = (face: Face): string =>
    hsl({
      h,
      s: clamp(body.s + faces[face].ds * 0.5, 0, 100),
      l: clamp(body.l + faces[face].dl * 0.55, 3, 97),
    });
  return {
    base: hsl(body),
    top: shade('top'),
    left: shade('left'),
    right: shade('right'),
    edge: hsl(
      { h, s: clamp(body.s + 12, 0, 100), l: theme === 'carbon' ? 42 : 62 },
      theme === 'carbon' ? 0.4 : 0.5,
    ),
  };
}

/** Neutral material for nodes that fall outside every named district. */
export function neutralMaterial(theme: ThemeName): Material {
  const body: Hsl = theme === 'carbon' ? { h: 220, s: 8, l: 46 } : { h: 40, s: 6, l: 62 };
  const faces = FACE[theme];
  const shade = (face: Face): string =>
    hsl({
      h: body.h,
      s: clamp(body.s + faces[face].ds, 0, 100),
      l: clamp(body.l + faces[face].dl, 4, 96),
    });
  return {
    base: hsl(body),
    top: shade('top'),
    left: shade('left'),
    right: shade('right'),
    edge: hsl({ ...body, l: body.l + 20 }, 0.3),
  };
}

/* -------------------------------------------------------------------------- */
/* Landmark signals                                                            */
/* -------------------------------------------------------------------------- */

export type SignalKind = 'entry' | 'core' | 'hotspot';

export const SIGNAL_ORDER: SignalKind[] = ['entry', 'core', 'hotspot'];

/**
 * Held in HSL rather than hex because the map blends them with district
 * materials, and `color-mix()` is not something a PNG export can depend on:
 * an SVG rasterised through an `<img>` gets no stylesheet and no guarantee
 * about which CSS colour functions the sandbox supports.
 */
const SIGNALS: Record<ThemeName, Record<SignalKind, Hsl>> = {
  carbon: {
    entry: { h: 203, s: 100, l: 75 },
    core: { h: 0, s: 0, l: 96 },
    hotspot: { h: 25, s: 100, l: 58 },
  },
  paper: {
    entry: { h: 205, s: 100, l: 38 },
    core: { h: 38, s: 8, l: 27 },
    hotspot: { h: 20, s: 77, l: 44 },
  },
};

export function signalColor(kind: SignalKind, theme: ThemeName): string {
  return hsl(SIGNALS[theme][kind]);
}

/**
 * Roof colour for a hotspot.
 *
 * Hue is taken outright from the signal rather than interpolated toward it.
 * Interpolating looked correct in the abstract and was wrong in practice: the
 * short way around the wheel from an azure district at 214 to the hotspot at
 * 25 runs through violet and magenta, so hotspots in a blue district rendered
 * hot pink and read as a fourth district rather than as a flag. Lightness
 * still carries the per building jitter, so a cluster of hotspots keeps some
 * texture instead of flattening into one slab of orange.
 */
export function hotspotRoof(theme: ThemeName, tone = 0): string {
  const signal = SIGNALS[theme].hotspot;
  return hsl({
    h: signal.h,
    s: signal.s,
    l: clamp(signal.l + tone * 0.5, 12, 92),
  });
}

export const SIGNAL_LABEL: Record<SignalKind, string> = {
  entry: 'Entry point',
  core: 'Core module',
  hotspot: 'Hotspot',
};

export const SIGNAL_BLURB: Record<SignalKind, string> = {
  entry: 'Where execution starts. Read these first.',
  core: 'Imported by the most files. Changing one ripples.',
  hotspot: 'Unusually large. Often where complexity hides.',
};

/* -------------------------------------------------------------------------- */

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function round(v: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
