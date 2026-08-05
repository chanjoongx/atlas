/**
 * The Atlas mark and lockup.
 *
 * The mark is the product compressed into 32 units: one isometric district
 * plate carrying three extruded towers. Districts are directories, buildings
 * are files, and the centre tower is a landmark, so it wears the hotspot
 * signal colour while everything else stays on the accent ramp.
 *
 * Projection is 2:1 isometric (a footprint of half-width w has half-height
 * w/2) rather than true 30 degrees. 2:1 puts every edge on a 1:2 pixel slope,
 * which is what keeps the silhouette clean down at 16px.
 *
 * Colour comes from the theme tokens, not from literals: the faces are
 * color-mix() over --accent, --signal-hotspot and --bg-canvas, so a retheme
 * carries the logo with it. The hex values below are the pre-computed carbon
 * and paper results, used only where color-mix() is unavailable.
 */

import type { CSSProperties } from 'react';

type Role = 'plate' | 'district' | 'landmark';
type Face = 'body' | 'top' | 'left' | 'right';

/**
 * Faces in paint order: plate first, then the towers back to front. `body` is
 * a box's union outline, painted underneath its three faces in the mid tone so
 * antialiasing can never open a background-coloured hairline along a shared
 * edge. Coordinates are viewBox units on a 0.25 grid, inset at least 2.5 units
 * from every side.
 */
const FACES: ReadonlyArray<readonly [Role, Face, string]> = [
  ['plate', 'body', '16,12.5 29.5,19.25 29.5,22.25 16,29 2.5,22.25 2.5,19.25'],
  ['plate', 'top', '16,12.5 29.5,19.25 16,26 2.5,19.25'],
  ['plate', 'left', '2.5,19.25 16,26 16,29 2.5,22.25'],
  ['plate', 'right', '16,26 29.5,19.25 29.5,22.25 16,29'],

  ['landmark', 'body', '16,3 19.5,4.75 19.5,17.75 16,19.5 12.5,17.75 12.5,4.75'],
  ['landmark', 'top', '16,3 19.5,4.75 16,6.5 12.5,4.75'],
  ['landmark', 'left', '12.5,4.75 16,6.5 16,19.5 12.5,17.75'],
  ['landmark', 'right', '16,6.5 19.5,4.75 19.5,17.75 16,19.5'],

  ['district', 'body', '7,11.5 10.5,13.25 10.5,19.25 7,21 3.5,19.25 3.5,13.25'],
  ['district', 'top', '7,11.5 10.5,13.25 7,15 3.5,13.25'],
  ['district', 'left', '3.5,13.25 7,15 7,21 3.5,19.25'],
  ['district', 'right', '7,15 10.5,13.25 10.5,19.25 7,21'],

  ['district', 'body', '25,8 28.5,9.75 28.5,19.25 25,21 21.5,19.25 21.5,9.75'],
  ['district', 'top', '25,8 28.5,9.75 25,11.5 21.5,9.75'],
  ['district', 'left', '21.5,9.75 25,11.5 25,21 21.5,19.25'],
  ['district', 'right', '25,11.5 28.5,9.75 28.5,19.25 25,21'],
];

/** Paint classes. `body` and `left` share the mid tone, so they share a class. */
const PAINT: Record<Role, string> = { plate: 'p', district: 'd', landmark: 'm' };
const SUFFIX: Record<Face, string> = { body: '', left: '', top: 't', right: 'r' };

/**
 * Custom properties carry the paint. The base layer is per theme hex, so any
 * browser with custom property support gets the right colours; where
 * color-mix() exists the properties are recomputed from the live tokens, and
 * that is the layer modern browsers actually use.
 */
const STYLE = `
.atlas-mark{
--am-pt:#193057;--am-pl:#13233e;--am-pr:#0d192d;
--am-dt:#99beff;--am-dl:#4589ff;--am-dr:#2b559e;
--am-mt:#ffb784;--am-ml:#ff832b;--am-mr:#994f1a}
[data-theme='paper'] .atlas-mark{
--am-pt:#3c578a;--am-pl:#3a4d72;--am-pr:#394760;
--am-dt:#7ba9fe;--am-dl:#0f62fe;--am-dr:#093d9d;
--am-mt:#dd9b7a;--am-ml:#c4531a;--am-mr:#763210}
@supports (color:color-mix(in srgb,red 50%,blue)){
.atlas-mark,[data-theme='paper'] .atlas-mark{
--am-pt:color-mix(in srgb,color-mix(in srgb,var(--accent) 42%,#000) 78%,var(--bg-canvas));
--am-pl:color-mix(in srgb,color-mix(in srgb,var(--accent) 30%,#000) 78%,var(--bg-canvas));
--am-pr:color-mix(in srgb,color-mix(in srgb,var(--accent) 21%,#000) 78%,var(--bg-canvas));
--am-dt:color-mix(in srgb,var(--accent) 55%,#fff);
--am-dl:var(--accent);
--am-dr:color-mix(in srgb,var(--accent) 62%,#000);
--am-mt:color-mix(in srgb,var(--signal-hotspot) 58%,#fff);
--am-ml:var(--signal-hotspot);
--am-mr:color-mix(in srgb,var(--signal-hotspot) 60%,#000)}}
.atlas-mark .p{fill:var(--am-pl)}.atlas-mark .pt{fill:var(--am-pt)}.atlas-mark .pr{fill:var(--am-pr)}
.atlas-mark .d{fill:var(--am-dl)}.atlas-mark .dt{fill:var(--am-dt)}.atlas-mark .dr{fill:var(--am-dr)}
.atlas-mark .m{fill:var(--am-ml)}.atlas-mark .mt{fill:var(--am-mt)}.atlas-mark .mr{fill:var(--am-mr)}`;

/** Shared drawing. AtlasMark sizes it in px, AtlasLockup sizes it in em. */
function Glyph({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className ? `atlas-mark ${className}` : 'atlas-mark'}
      style={style}
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      <style>{STYLE}</style>
      {FACES.map(([role, face, points], i) => (
        <polygon key={i} className={PAINT[role] + SUFFIX[face]} points={points} />
      ))}
    </svg>
  );
}

export interface AtlasMarkProps {
  /** Rendered edge length in px. The artwork is square. */
  size?: number;
  className?: string;
}

/**
 * The icon on its own. Decorative by design: it carries no accessible name, so
 * label the control that wraps it.
 */
export function AtlasMark({ size = 24, className }: AtlasMarkProps) {
  return <Glyph className={className} style={{ width: size, height: size, display: 'block' }} />;
}

export interface AtlasLockupProps {
  className?: string;
}

/**
 * Mark plus wordmark. The name is real text rather than an aria-label, so it
 * is selectable, translatable and findable. Sizing is in em throughout, so the
 * lockup scales with whatever font-size it inherits.
 */
export function AtlasLockup({ className }: AtlasLockupProps) {
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.42em',
        lineHeight: 1,
        color: 'currentColor',
      }}
    >
      <Glyph style={{ width: '1.24em', height: '1.24em', flex: 'none', display: 'block' }} />
      <span
        style={{
          fontFamily: 'var(--font-sans)',
          fontWeight: 600,
          letterSpacing: 'var(--tracking-tight)',
          color: 'currentColor',
        }}
      >
        Atlas
      </span>
    </span>
  );
}
