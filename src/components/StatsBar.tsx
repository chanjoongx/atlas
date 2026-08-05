import { districtColor, type ThemeName } from '../lib/palette';
import type { SceneStats } from '../lib/iso';

interface StatsBarProps {
  stats: SceneStats;
  theme: ThemeName;
}

/** Beyond six slices the bar stops being readable and starts being confetti. */
const MAX_SLICES = 6;

export function StatsBar({ stats, theme }: StatsBarProps) {
  const shown = stats.languages.slice(0, MAX_SLICES);
  const restShare = stats.languages.slice(MAX_SLICES).reduce((sum, lang) => sum + lang.share, 0);

  return (
    <div className="border-line bg-surface flex flex-wrap items-center gap-x-6 gap-y-3 border-t px-4 py-2.5">
      <dl className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <Stat label="Files" value={stats.fileCount.toLocaleString()} />
        <Stat label="Lines" value={compact(stats.totalLoc)} />
        <Stat label="Districts" value={String(stats.districtCount)} />
        <Stat
          label="Links"
          value={stats.edgeCount.toLocaleString()}
          note={stats.droppedEdges > 0 ? `${compact(stats.droppedEdges)} hidden` : undefined}
        />
        <Stat label="Median file" value={`${stats.medianLoc} lines`} />
      </dl>

      {shown.length > 0 && (
        <div className="ml-auto flex min-w-[15rem] flex-1 items-center gap-3">
          <div
            className="bg-inset flex h-1.5 flex-1 overflow-hidden rounded-full"
            role="img"
            aria-label={`Language mix: ${shown
              .map((lang) => `${lang.name} ${Math.round(lang.share * 100)} percent`)
              .join(', ')}`}
          >
            {shown.map((lang, index) => (
              <span
                key={lang.name}
                style={{
                  width: `${lang.share * 100}%`,
                  backgroundColor: districtColor(index, theme),
                }}
                title={`${lang.name}: ${lang.files} files`}
              />
            ))}
            {restShare > 0 && (
              <span style={{ width: `${restShare * 100}%`, backgroundColor: 'var(--border-strong)' }} />
            )}
          </div>

          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {shown.slice(0, 4).map((lang, index) => (
              <li key={lang.name} className="text-tertiary flex items-center gap-1.5 text-2xs">
                <span
                  aria-hidden
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: districtColor(index, theme) }}
                />
                {lang.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-tertiary text-2xs">{label}</dt>
      <dd className="tabular text-primary text-xs font-medium">
        {value}
        {note && <span className="text-tertiary ml-1 font-normal">({note})</span>}
      </dd>
    </div>
  );
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1_000) return `${(value / 1000).toFixed(1)}k`;
  return value.toLocaleString();
}
