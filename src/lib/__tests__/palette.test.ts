/**
 * District colours and isometric face shading.
 *
 * The load bearing property here is the face lightness ordering. An extruded
 * block only reads as three dimensional because its top is lighter than its
 * left and its left is lighter than its right. If that ordering ever inverts or
 * collapses, the whole city flattens into coloured confetti, so these tests
 * parse the emitted CSS and check the numbers rather than the strings.
 */

import { describe, it, expect } from 'vitest';
import {
  SIGNAL_ORDER,
  districtColor,
  districtHue,
  hotspotRoof,
  hsl,
  material,
  neutralMaterial,
  plateMaterial,
  signalColor,
  type Material,
  type ThemeName,
} from '../palette';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

interface ParsedHsl {
  h: number;
  s: number;
  l: number;
  a: number;
}

const HSL_PATTERN = /^hsl\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)% (-?\d+(?:\.\d+)?)%(?: \/ (-?\d+(?:\.\d+)?))?\)$/;

/** Pull the numbers back out of a CSS colour so they can be compared. */
function parseHsl(value: string): ParsedHsl {
  const match = HSL_PATTERN.exec(value);
  if (!match) throw new Error(`not a parseable hsl() colour: ${value}`);
  return {
    h: Number(match[1]),
    s: Number(match[2]),
    l: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
  };
}

const THEMES: ThemeName[] = ['carbon', 'paper'];
const INDICES = Array.from({ length: 12 }, (_, i) => i);

/**
 * How light the canvas behind the city is, per theme. Taken from the map sky
 * tokens in theme.ts (#0e1116 and #f4f2ed).
 */
const CANVAS_LIGHTNESS: Record<ThemeName, number> = { carbon: 7, paper: 95 };

function faces(mat: Material) {
  return { top: parseHsl(mat.top), left: parseHsl(mat.left), right: parseHsl(mat.right) };
}

/* -------------------------------------------------------------------------- */

describe('the district hue wheel', () => {
  it('wraps back to the start once a repo has more districts than hues', () => {
    for (let i = 0; i < 12; i += 1) {
      expect(districtHue(i + 12)).toBe(districtHue(i));
      expect(districtHue(i + 240)).toBe(districtHue(i));
    }
  });

  it('handles a negative index instead of reading off the end of the wheel', () => {
    for (let i = 1; i <= 24; i += 1) {
      const hue = districtHue(-i);
      expect(Number.isFinite(hue)).toBe(true);
      expect(hue).toBe(districtHue(12 - (i % 12 === 0 ? 12 : i % 12)));
    }
    expect(districtHue(-1)).toBe(districtHue(11));
    expect(districtHue(-12)).toBe(districtHue(0));
    expect(districtHue(-13)).toBe(districtHue(11));
  });

  it('gives twelve neighbouring districts twelve different hues', () => {
    const hues = INDICES.map(districtHue);

    expect(new Set(hues).size).toBe(12);
    for (const hue of hues) {
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it('keeps a district on the same hue in both themes and only moves its lightness', () => {
    for (const index of INDICES) {
      const carbon = parseHsl(districtColor(index, 'carbon'));
      const paper = parseHsl(districtColor(index, 'paper'));

      expect(carbon.h).toBe(paper.h);
      expect(carbon.h).toBe(districtHue(index));
      expect(carbon.l).not.toBe(paper.l);
    }
  });
});

describe('shading an extruded block', () => {
  it('lights the top brighter than the left, and the left brighter than the right', () => {
    for (const theme of THEMES) {
      for (const index of INDICES) {
        // The tone range the renderer actually uses is roughly -7 to +4.
        for (const tone of [-10, -7, -4, 0, 4, 10, 20]) {
          const { top, left, right } = faces(material(index, theme, tone));

          expect(top.l).toBeGreaterThan(left.l);
          expect(left.l).toBeGreaterThan(right.l);
        }
      }
    }
  });

  it('keeps all three faces on the district hue', () => {
    for (const theme of THEMES) {
      for (const index of INDICES) {
        const mat = material(index, theme);
        const { top, left, right } = faces(mat);

        expect(top.h).toBe(districtHue(index));
        expect(left.h).toBe(districtHue(index));
        expect(right.h).toBe(districtHue(index));
        expect(parseHsl(mat.base).h).toBe(districtHue(index));
      }
    }
  });

  it('raises every face when the tone goes up and lowers it when the tone goes down', () => {
    for (const theme of THEMES) {
      const dark = faces(material(3, theme, -12));
      const flat = faces(material(3, theme, 0));
      const lit = faces(material(3, theme, 12));

      for (const face of ['top', 'left', 'right'] as const) {
        expect(dark[face].l).toBeLessThan(flat[face].l);
        expect(lit[face].l).toBeGreaterThan(flat[face].l);
      }
    }
  });

  it('clamps rather than overflowing when the tone is pushed to either extreme', () => {
    for (const theme of THEMES) {
      for (const tone of [-1000, -100, 100, 1000]) {
        const mat = material(0, theme, tone);

        for (const value of [mat.base, mat.top, mat.left, mat.right, mat.edge]) {
          const parsed = parseHsl(value);
          expect(parsed.l).toBeGreaterThanOrEqual(0);
          expect(parsed.l).toBeLessThanOrEqual(100);
          expect(parsed.s).toBeGreaterThanOrEqual(0);
          expect(parsed.s).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('runs out of room to separate the left wall from the right at an extreme dark tone', () => {
    // Pinned, not celebrated. The face floor is 4% lightness and the body floor
    // is 8%, so once the tone drives the body to its floor the left face (-5)
    // and the right face (-16) both clamp to 4 and the block loses its 3D read.
    // Nothing in the renderer passes a tone anywhere near this today, so this is
    // a latent edge rather than a live bug, but the two clamps disagree.
    const { left, right } = faces(material(0, 'carbon', -100));

    expect(left.l).toBe(right.l);
    expect(left.l).toBe(4);
  });

  it('emits a translucent hairline for the seam between faces', () => {
    for (const theme of THEMES) {
      const edge = parseHsl(material(0, theme).edge);

      expect(edge.a).toBeGreaterThan(0);
      expect(edge.a).toBeLessThan(1);
      expect(edge.h).toBe(districtHue(0));
    }
  });
});

describe('the slab a district stands on', () => {
  it('sits closer to the canvas than the buildings do, so ground never out-shouts them', () => {
    for (const theme of THEMES) {
      for (const index of INDICES) {
        const plate = parseHsl(plateMaterial(index, theme).base);
        const block = parseHsl(material(index, theme).base);
        const canvas = CANVAS_LIGHTNESS[theme];

        expect(Math.abs(plate.l - canvas)).toBeLessThan(Math.abs(block.l - canvas));
      }
    }
  });

  it('keeps the district hue but drops most of its chroma', () => {
    for (const theme of THEMES) {
      for (const index of INDICES) {
        const plate = parseHsl(plateMaterial(index, theme).base);
        const block = parseHsl(material(index, theme).base);

        expect(plate.h).toBe(districtHue(index));
        expect(plate.s).toBeLessThan(block.s);
      }
    }
  });

  it('shades its own faces in the same order the buildings use', () => {
    for (const theme of THEMES) {
      for (const index of INDICES) {
        const { top, left, right } = faces(plateMaterial(index, theme));

        expect(top.l).toBeGreaterThan(left.l);
        expect(left.l).toBeGreaterThan(right.l);
      }
    }
  });
});

describe('the material for files outside every district', () => {
  it('shades its faces in the same order and carries no district hue', () => {
    for (const theme of THEMES) {
      const mat = neutralMaterial(theme);
      const { top, left, right } = faces(mat);

      expect(top.l).toBeGreaterThan(left.l);
      expect(left.l).toBeGreaterThan(right.l);
      expect(parseHsl(mat.base).s).toBeLessThan(15);
    }
  });
});

describe('the CSS it writes', () => {
  it('emits the opaque form when a colour is fully solid', () => {
    expect(hsl({ h: 214, s: 58, l: 62 })).toBe('hsl(214 58% 62%)');
    expect(hsl({ h: 214, s: 58, l: 62 }, 1)).toBe('hsl(214 58% 62%)');
    expect(hsl({ h: 214, s: 58, l: 62 }, 2)).toBe('hsl(214 58% 62%)');
  });

  it('emits the slash alpha form when a colour is translucent', () => {
    expect(hsl({ h: 214, s: 58, l: 62 }, 0.34)).toBe('hsl(214 58% 62% / 0.34)');
    expect(hsl({ h: 0, s: 0, l: 0 }, 0)).toBe('hsl(0 0% 0% / 0)');
  });

  it('rounds the channels to one decimal and the alpha to three', () => {
    expect(hsl({ h: 214.26, s: 57.98, l: 62.349 }, 0.123456)).toBe(
      'hsl(214.3 58% 62.3% / 0.123)',
    );
  });

  it('clamps saturation and lightness into the legal range', () => {
    expect(hsl({ h: 10, s: 180, l: -40 })).toBe('hsl(10 100% 0%)');
    expect(hsl({ h: 10, s: -5, l: 140 })).toBe('hsl(10 0% 100%)');
  });

  it('produces something a browser will accept for every material it can build', () => {
    for (const theme of THEMES) {
      for (const index of [-3, 0, 5, 11, 12, 47]) {
        const mats = [material(index, theme), material(index, theme, -7), plateMaterial(index, theme)];
        for (const mat of mats) {
          for (const value of [mat.base, mat.top, mat.left, mat.right, mat.edge]) {
            expect(value).toMatch(HSL_PATTERN);
            expect(value).not.toMatch(/NaN|undefined|Infinity/);
          }
        }
      }
      const neutral = neutralMaterial(theme);
      for (const value of [neutral.base, neutral.top, neutral.left, neutral.right, neutral.edge]) {
        expect(value).toMatch(HSL_PATTERN);
      }
    }
  });
});

describe('landmark signal colours', () => {
  it('gives every kind its own colour in both themes', () => {
    const seen = new Set<string>();

    for (const theme of THEMES) {
      const perTheme = SIGNAL_ORDER.map((kind) => signalColor(kind, theme));

      expect(perTheme).toHaveLength(3);
      expect(new Set(perTheme).size).toBe(3);
      for (const colour of perTheme) {
        expect(colour).toMatch(HSL_PATTERN);
        seen.add(colour);
      }
    }

    // No colour is shared across the two themes either, or a screenshot taken in
    // one would legend wrongly next to the other.
    expect(seen.size).toBe(6);
  });

  it('keeps a signal legible against its own theme', () => {
    // Light signals on the dark canvas, dark signals on the light one.
    for (const kind of SIGNAL_ORDER) {
      expect(parseHsl(signalColor(kind, 'carbon')).l).toBeGreaterThan(CANVAS_LIGHTNESS.carbon);
      expect(parseHsl(signalColor(kind, 'paper')).l).toBeLessThan(CANVAS_LIGHTNESS.paper);
    }
  });

  it('names the three kinds in the order the scene builder sorts them', () => {
    expect(SIGNAL_ORDER).toEqual(['entry', 'core', 'hotspot']);
  });
});

describe('the roof of a flagged hotspot', () => {
  it('takes hue and chroma straight from the signal, whatever district it is in', () => {
    // Deliberate: interpolating a blue district toward the orange signal runs
    // through magenta, which reads as a fourth district rather than a flag.
    for (const theme of THEMES) {
      const signal = parseHsl(signalColor('hotspot', theme));

      const roof = parseHsl(hotspotRoof(theme));

      expect(hotspotRoof(theme)).toMatch(HSL_PATTERN);
      expect(roof.h).toBe(signal.h);
      expect(roof.s).toBe(signal.s);
    }
  });

  it('never comes out identical to the district roof it is replacing', () => {
    for (const theme of THEMES) {
      for (const index of INDICES) {
        expect(hotspotRoof(theme)).not.toBe(material(index, theme).top);
      }
    }
  });

  it('carries the per building tone in lightness, and clamps at both ends', () => {
    const dark = parseHsl(hotspotRoof('carbon', -7));
    const flat = parseHsl(hotspotRoof('carbon', 0));

    expect(dark.l).toBeLessThan(flat.l);
    for (const tone of [-1000, 1000]) {
      const extreme = parseHsl(hotspotRoof('carbon', tone));
      expect(extreme.l).toBeGreaterThanOrEqual(0);
      expect(extreme.l).toBeLessThanOrEqual(100);
    }
  });
});
