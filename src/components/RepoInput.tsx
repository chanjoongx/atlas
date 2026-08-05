import { useMemo, useState } from 'react';
import { ArrowRight, Zap } from 'lucide-react';
import { parseRepoRef, type RepoRef } from '../lib/repo-ref';

export interface DemoRepo extends RepoRef {
  name: string;
  blurb: string;
  /** What the visitor learns from this particular map. */
  takeaway: string;
}

export const DEMO_REPOS: DemoRepo[] = [
  {
    owner: 'shadcn-ui',
    repo: 'ui',
    name: 'shadcn/ui',
    blurb: 'Component library',
    takeaway: 'One flat district of near identical blocks. That is a component library.',
  },
  {
    owner: 'honojs',
    repo: 'hono',
    name: 'Hono',
    blurb: 'Edge web framework',
    takeaway: 'A small core beside a wide runtime test belt. That is a portability story.',
  },
  {
    owner: 'drizzle-team',
    repo: 'drizzle-orm',
    name: 'Drizzle ORM',
    blurb: 'TypeScript ORM',
    takeaway: 'Repeating districts per dialect. That is where the real surface area lives.',
  },
];

interface RepoInputProps {
  onAnalyze: (ref: RepoRef) => void;
  loading: boolean;
}

/** The field on its own, for layouts that place the demo cards elsewhere. */
export function RepoInputCompact({ onAnalyze, loading }: RepoInputProps) {
  const [value, setValue] = useState('');
  const parsed = useMemo(() => parseRepoRef(value), [value]);
  const invalid = value.trim().length > 2 && parsed === null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (parsed) onAnalyze(parsed);
  };

  return (
    <div className="w-full max-w-xl">
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <div className="flex-1">
          <label htmlFor="repo" className="sr-only">
            GitHub repository
          </label>
          <input
            id="repo"
            name="repo"
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="owner/repo, or paste a GitHub URL"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={loading}
            aria-invalid={invalid}
            aria-describedby="repo-hint"
            className="field mono text-sm"
          />
        </div>
        <button type="submit" disabled={!parsed || loading} className="btn btn-primary h-11 px-5">
          Map it
          <ArrowRight size={15} aria-hidden />
        </button>
      </form>

      <p id="repo-hint" className="mt-2 min-h-[1.25rem] text-xs" aria-live="polite">
        {invalid ? (
          <span className="text-danger">
            That does not look like a repository. Try owner/repo.
          </span>
        ) : parsed ? (
          <span className="text-tertiary">
            Mapping{' '}
            <span className="mono text-secondary">
              {parsed.owner}/{parsed.repo}
            </span>
            {parsed.branch && <span className="mono text-tertiary"> on {parsed.branch}</span>}
          </span>
        ) : (
          <span className="text-tertiary">Any public repository. Large ones take a little longer.</span>
        )}
      </p>

    </div>
  );
}

/**
 * The three prebuilt maps.
 *
 * Each card says what its city looks like rather than what the project does,
 * because the point of a demo here is to show that different kinds of software
 * produce visibly different shapes.
 */
export function DemoRepoCards({ onAnalyze, loading }: RepoInputProps) {
  return (
    <div>
      <p className="eyebrow flex items-center gap-1.5">
        <Zap size={11} aria-hidden />
        Prebuilt, opens instantly
      </p>
      <ul className="mt-2.5 grid gap-2 sm:grid-cols-3">
        {DEMO_REPOS.map((demo) => (
          <li key={demo.name}>
            <button
              type="button"
              onClick={() => onAnalyze(demo)}
              disabled={loading}
              className="surface hover:border-line-strong hover:bg-surface-hover flex h-full w-full flex-col gap-1 p-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="text-primary text-sm font-medium">{demo.name}</span>
              <span className="text-tertiary text-2xs">{demo.blurb}</span>
              <span className="text-secondary mt-1.5 text-2xs leading-snug">{demo.takeaway}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
