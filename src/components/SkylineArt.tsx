import { useMemo } from 'react';
import { material, plateMaterial, signalColor, type ThemeName } from '../lib/palette';
import { boxFaces, polygonPoints, r } from '../lib/iso/projection';

/**
 * Decorative skyline for the landing page.
 *
 * Drawn with the real projection and the real palette rather than as clip art,
 * so what a visitor sees above the fold is honestly the same object they get
 * after pressing the button. The layout is seeded, not random, so the page
 * looks identical on every load and in every screenshot.
 */

interface SkylineArtProps {
  theme: ThemeName;
  className?: string;
}

const COLUMNS = 13;
const ROWS = 5;
const SPACING = 46;
/** Heights as a fraction of the tallest tower, walked in a fixed order. */
const SEED = [
  0.24, 0.52, 0.16, 0.86, 0.35, 0.62, 0.2, 1, 0.42, 0.28, 0.7, 0.18, 0.48, 0.33, 0.9, 0.26, 0.58,
  0.14, 0.76, 0.4, 0.22, 0.66, 0.3, 0.5, 0.19, 0.82, 0.36, 0.6, 0.25, 0.44,
];
const LANDMARKS = new Set([7, 21, 38, 52]);

export function SkylineArt({ theme, className }: SkylineArtProps) {
  const markup = useMemo(() => build(theme), [theme]);
  return (
    <svg
      viewBox="-470 -210 940 360"
      className={className}
      role="presentation"
      aria-hidden
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

function build(theme: ThemeName): string {
  const parts: string[] = [];
  const districts = 3;

  // Three plates, laid out along the ground plane.
  for (let d = 0; d < districts; d += 1) {
    const cx = (d - 1) * SPACING * 4.6;
    const plate = plateMaterial(d, theme);
    const faces = boxFaces(cx, 0, SPACING * 2.1, SPACING * 2.4, -9, 9);
    parts.push(
      `<polygon points="${polygonPoints(faces.left)}" fill="${plate.left}"/>`,
      `<polygon points="${polygonPoints(faces.right)}" fill="${plate.right}"/>`,
      `<polygon points="${polygonPoints(faces.top)}" fill="${plate.top}" stroke="${plate.edge}" stroke-width="1"/>`,
    );
  }

  interface Tower {
    x: number;
    y: number;
    height: number;
    district: number;
    landmark: boolean;
  }
  const towers: Tower[] = [];
  let seed = 0;

  for (let d = 0; d < districts; d += 1) {
    const originX = (d - 1) * SPACING * 4.6;
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < Math.ceil(COLUMNS / districts); col += 1) {
        const t = SEED[seed % SEED.length];
        const index = seed;
        seed += 1;
        towers.push({
          x: originX + (col - 1.5) * SPACING * 0.95,
          y: (row - (ROWS - 1) / 2) * SPACING * 0.95,
          height: 14 + t * 128,
          district: d,
          landmark: LANDMARKS.has(index),
        });
      }
    }
  }

  // Painter's algorithm, same rule the map uses.
  towers.sort((a, b) => a.x + a.y - (b.x + b.y));

  for (const tower of towers) {
    const half = 15;
    const mat = material(tower.district, theme, tower.landmark ? 6 : 0);
    const faces = boxFaces(tower.x, tower.y, half, half, 0, tower.height);
    parts.push(
      `<polygon points="${polygonPoints(faces.left)}" fill="${mat.left}"/>`,
      `<polygon points="${polygonPoints(faces.right)}" fill="${mat.right}"/>`,
      `<polygon points="${polygonPoints(faces.top)}" fill="${
        tower.landmark ? signalColor('hotspot', theme) : mat.top
      }" stroke="${mat.edge}" stroke-width="0.7"/>`,
    );
    if (tower.landmark) {
      parts.push(
        `<line x1="${r(faces.apex.x)}" y1="${r(faces.apex.y)}" x2="${r(faces.apex.x)}" y2="${r(
          faces.apex.y - 30,
        )}" stroke="${signalColor('entry', theme)}" stroke-width="2" stroke-opacity="0.5" stroke-linecap="round"/>`,
      );
    }
  }

  return parts.join('');
}
