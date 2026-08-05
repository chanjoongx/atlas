import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';

/**
 * The four agents that actually run, in order, with the rough share of wall
 * clock each one takes. The bar is an estimate and says so: there is no
 * progress channel on a single POST, and inventing a percentage would be a lie
 * told in a very confident font.
 */
const STAGES = [
  { name: 'Ingest', detail: 'Reading the file tree from GitHub', weight: 0.22 },
  { name: 'Parse', detail: 'Classifying files and resolving imports', weight: 0.46 },
  { name: 'Layout', detail: 'Settling the force simulation', weight: 0.22 },
  { name: 'Annotate', detail: 'Scoring centrality, picking landmarks', weight: 0.1 },
] as const;

interface LoadingStateProps {
  repo: string | null;
  /** Cached demos resolve almost instantly, so the copy should not overpromise. */
  expected?: number;
}

export function LoadingState({ repo, expected = 14 }: LoadingStateProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = performance.now();
    const id = window.setInterval(() => setElapsed((performance.now() - started) / 1000), 120);
    return () => window.clearInterval(id);
  }, []);

  const fraction = Math.min(elapsed / expected, 0.985);
  let cursor = 0;
  const active = STAGES.findIndex((stage) => {
    cursor += stage.weight;
    return fraction < cursor;
  });
  const current = active === -1 ? STAGES.length - 1 : active;

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-9 px-6 py-10">
      <Skyline />

      <div className="w-full max-w-md">
        <p className="text-primary text-center text-sm" aria-live="polite">
          Mapping {repo ? <span className="mono">{repo}</span> : 'the repository'}
        </p>

        <ol className="mt-5 space-y-2.5">
          {STAGES.map((stage, index) => {
            const done = index < current;
            const running = index === current;
            return (
              <li key={stage.name} className="flex items-center gap-3">
                <span
                  aria-hidden
                  className={`flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-300 ${
                    done
                      ? 'border-accent bg-accent text-accent-contrast'
                      : running
                        ? 'border-accent text-accent'
                        : 'border-line text-tertiary'
                  }`}
                >
                  {done ? (
                    <Check size={11} strokeWidth={3} />
                  ) : running ? (
                    <span className="bg-accent size-1.5 animate-pulse rounded-full" />
                  ) : (
                    <span className="bg-line-strong size-1.5 rounded-full" />
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-xs font-medium transition-colors ${
                      done || running ? 'text-primary' : 'text-tertiary'
                    }`}
                  >
                    {stage.name}
                  </span>
                  {running && (
                    <span className="text-tertiary block text-2xs leading-snug">{stage.detail}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>

        <p className="text-tertiary mt-5 text-center text-2xs">
          {elapsed > expected
            ? 'Still going. Large repositories can take a while.'
            : 'Usually under 20 seconds.'}
        </p>
      </div>
    </div>
  );
}

/** Placeholder skyline that rises and settles, using the map's own language. */
function Skyline() {
  const bars = [26, 44, 18, 62, 34, 78, 30, 52, 22, 40, 68, 24];
  return (
    <div
      className="flex h-24 items-end gap-1.5"
      role="img"
      aria-label="Placeholder city while the map is generated"
    >
      {bars.map((height, index) => (
        <span
          key={index}
          className="bg-line-strong animate-rise w-3 origin-bottom rounded-[2px]"
          style={{ height, animationDelay: `${index * 0.09}s` }}
        />
      ))}
    </div>
  );
}
