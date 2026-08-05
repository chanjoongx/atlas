import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  SIGNAL_BLURB,
  SIGNAL_LABEL,
  SIGNAL_ORDER,
  districtColor,
  material,
  signalColor,
  type ThemeName,
} from '../lib/palette';
import type { Scene } from '../lib/iso';

interface LegendProps {
  scene: Scene;
  theme: ThemeName;
  focused: string | null;
  onFocus: (district: string | null) => void;
}

export function Legend({ scene, theme, focused, onFocus }: LegendProps) {
  const [showKey, setShowKey] = useState(true);
  // Hovering a district previews the spotlight; clicking pins it, so the
  // spotlight survives the pointer leaving the list to go look at the map.
  const [pinned, setPinned] = useState<string | null>(null);
  const landmarks = SIGNAL_ORDER.filter((kind) => scene.stats.landmarks[kind] > 0);

  return (
    <div className="flex h-full flex-col">
      <section className="border-subtle border-b px-4 py-3">
        <button
          type="button"
          onClick={() => setShowKey((value) => !value)}
          aria-expanded={showKey}
          className="text-tertiary hover:text-secondary flex w-full items-center justify-between transition-colors"
        >
          <span className="eyebrow">Reading the map</span>
          <ChevronDown
            size={14}
            aria-hidden
            className={`transition-transform duration-200 ${showKey ? '' : '-rotate-90'}`}
          />
        </button>

        {showKey && (
          <dl className="animate-fade-in mt-3 space-y-3">
            <Rule term="Height" detail="Lines of code, on a log scale.">
              <HeightGlyph theme={theme} />
            </Rule>
            <Rule term="Colour" detail="The top level directory a file lives in.">
              <ColourGlyph theme={theme} />
            </Rule>
            <Rule term="Plate" detail="One district, sized to the files it holds.">
              <PlateGlyph theme={theme} />
            </Rule>
            {scene.stats.edgeCount > 0 && (
              <Rule
                term="Arcs"
                detail="Local imports. Pick a file and they flow toward what it depends on."
              >
                <ArcGlyph />
              </Rule>
            )}
          </dl>
        )}
      </section>

      {landmarks.length > 0 && (
        <section className="border-subtle border-b px-4 py-3">
          <p className="eyebrow">Landmarks</p>
          <ul className="mt-2.5 space-y-2">
            {landmarks.map((kind) => (
              <li key={kind} className="flex gap-2.5">
                <span
                  aria-hidden
                  className="mt-1.5 size-2 shrink-0 rotate-45"
                  style={{ backgroundColor: signalColor(kind, theme) }}
                />
                <div className="min-w-0">
                  <p className="text-primary text-xs font-medium">
                    {SIGNAL_LABEL[kind]}
                    <span className="text-tertiary tabular ml-1.5 font-normal">
                      {scene.stats.landmarks[kind]}
                    </span>
                  </p>
                  <p className="text-tertiary text-2xs leading-snug">{SIGNAL_BLURB[kind]}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mask-fade-y scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <p className="eyebrow flex items-center justify-between">
          Districts
          <span className="tabular font-normal normal-case tracking-normal">
            {scene.districts.length}
          </span>
        </p>

        <ul className="mt-2 space-y-px" onMouseLeave={() => onFocus(pinned)}>
          {scene.districts.map((district) => {
            const isFocused = focused === district.name;
            const isPinned = pinned === district.name;
            return (
              <li key={district.name}>
                <button
                  type="button"
                  onMouseEnter={() => onFocus(district.name)}
                  onFocus={() => onFocus(district.name)}
                  onBlur={() => onFocus(pinned)}
                  onClick={() => {
                    const next = isPinned ? null : district.name;
                    setPinned(next);
                    onFocus(next);
                  }}
                  aria-pressed={isPinned}
                  className={`hover:bg-surface-hover flex w-full items-center gap-2.5 rounded-sm px-1.5 py-1.5 text-left transition-colors ${
                    isFocused ? 'bg-surface-hover' : ''
                  }`}
                >
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: districtColor(district.index, theme) }}
                  />
                  <span className="mono text-primary min-w-0 flex-1 truncate text-xs">
                    {district.name}
                  </span>
                  <span className="tabular text-tertiary text-2xs">{district.fileCount}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Rule({
  term,
  detail,
  children,
}: {
  term: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="shrink-0" aria-hidden>
        {children}
      </div>
      <div className="min-w-0">
        <dt className="text-primary text-xs font-medium">{term}</dt>
        <dd className="text-tertiary text-2xs leading-snug">{detail}</dd>
      </div>
    </div>
  );
}

/** Three blocks rising, drawn with the same face shading as the map. */
function HeightGlyph({ theme }: { theme: ThemeName }) {
  const mat = material(0, theme);
  return (
    <svg width="44" height="30" viewBox="0 0 44 30" role="presentation">
      {[
        { x: 7, h: 6 },
        { x: 20, h: 13 },
        { x: 33, h: 20 },
      ].map((bar) => (
        <IsoBlock key={bar.x} cx={bar.x} cy={24} half={5} height={bar.h} mat={mat} />
      ))}
    </svg>
  );
}

function ColourGlyph({ theme }: { theme: ThemeName }) {
  return (
    <svg width="44" height="30" viewBox="0 0 44 30" role="presentation">
      {[0, 1, 2].map((index) => (
        <IsoBlock
          key={index}
          cx={9 + index * 13}
          cy={22}
          half={5}
          height={11}
          mat={material(index, theme)}
        />
      ))}
    </svg>
  );
}

function PlateGlyph({ theme }: { theme: ThemeName }) {
  const plate = material(3, theme, theme === 'carbon' ? -34 : 30);
  const block = material(3, theme);
  return (
    <svg width="44" height="30" viewBox="0 0 44 30" role="presentation">
      <IsoBlock cx={22} cy={24} half={19} height={3} mat={plate} />
      <IsoBlock cx={15} cy={19} half={4} height={7} mat={block} />
      <IsoBlock cx={28} cy={21} half={4} height={11} mat={block} />
    </svg>
  );
}

function ArcGlyph() {
  return (
    <svg width="44" height="30" viewBox="0 0 44 30" role="presentation">
      <path
        d="M7 22 Q22 2 37 22"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.6"
        strokeDasharray="4 6"
        strokeLinecap="round"
      >
        <animate attributeName="stroke-dashoffset" from="0" to="-10" dur="0.78s" repeatCount="indefinite" />
      </path>
      <circle cx="7" cy="22" r="2.2" fill="var(--accent)" />
    </svg>
  );
}

/** Minimal 2:1 isometric box, matching src/lib/iso/projection.ts. */
function IsoBlock({
  cx,
  cy,
  half,
  height,
  mat,
}: {
  cx: number;
  cy: number;
  half: number;
  height: number;
  mat: ReturnType<typeof material>;
}) {
  const hy = half / 2;
  const top = cy - height;
  const pts = (points: Array<[number, number]>) =>
    points.map(([x, y]) => `${x},${y}`).join(' ');

  return (
    <g>
      <polygon
        points={pts([
          [cx - half, top],
          [cx, top + hy],
          [cx, cy + hy],
          [cx - half, cy],
        ])}
        fill={mat.left}
      />
      <polygon
        points={pts([
          [cx, top + hy],
          [cx + half, top],
          [cx + half, cy],
          [cx, cy + hy],
        ])}
        fill={mat.right}
      />
      <polygon
        points={pts([
          [cx, top - hy],
          [cx + half, top],
          [cx, top + hy],
          [cx - half, top],
        ])}
        fill={mat.top}
      />
    </g>
  );
}
