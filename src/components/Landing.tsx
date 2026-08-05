import { Boxes, GitBranch, LayoutGrid, ScanSearch } from 'lucide-react';
import type { ThemeName } from '../lib/palette';
import type { RepoRef } from '../lib/repo-ref';
import { RepoInput } from './RepoInput';
import { SkylineArt } from './SkylineArt';

interface LandingProps {
  theme: ThemeName;
  loading: boolean;
  onAnalyze: (ref: RepoRef) => void;
}

const PIPELINE = [
  {
    icon: GitBranch,
    name: 'Ingester',
    detail: 'Pulls the file tree and repository metadata from the GitHub API.',
  },
  {
    icon: ScanSearch,
    name: 'Parser',
    detail: 'Classifies every file, counts its lines, and resolves local imports.',
  },
  {
    icon: LayoutGrid,
    name: 'Layout',
    detail: 'Settles a force simulation so related files end up as neighbours.',
  },
  {
    icon: Boxes,
    name: 'Annotator',
    detail: 'Scores centrality and promotes the few files worth naming.',
  },
] as const;

export function Landing({ theme, loading, onAnalyze }: LandingProps) {
  return (
    <>
      <section className="relative overflow-hidden px-6 pb-4 pt-14 sm:pt-20">
        <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center text-center">
          <p className="border-line text-tertiary mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-2xs">
            <span className="bg-accent size-1.5 rounded-full" aria-hidden />
            Second place, IBM Bob Hackathon 2026
          </p>

          <h1 className="text-3xl sm:text-4xl">Read any codebase as a city.</h1>

          <p className="text-secondary mt-4 max-w-xl text-lg">
            Atlas turns a public GitHub repository into an isometric map. Directories become
            districts, files become buildings as tall as the code inside them, and the handful of
            files that actually matter stand out as landmarks.
          </p>

          <div className="mt-9 flex w-full justify-center">
            <RepoInput onAnalyze={onAnalyze} loading={loading} />
          </div>
        </div>
      </section>

      <div
        className="pointer-events-none mt-10 select-none overflow-hidden"
        style={{
          maskImage: 'linear-gradient(to bottom, black 58%, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 58%, transparent)',
        }}
      >
        <SkylineArt theme={theme} className="mx-auto block w-full max-w-4xl opacity-85" />
      </div>

      <section className="border-line border-t px-6 py-12">
        <div className="mx-auto max-w-5xl">
          <p className="eyebrow">How a map gets built</p>
          <h2 className="text-primary mt-2 text-xl">Four agents, one request, no model in the loop.</h2>
          <p className="text-secondary mt-2 max-w-2xl text-sm">
            Every map is deterministic. The same repository produces the same city, which is what
            makes two of them worth comparing. The pipeline runs on Cloudflare Pages Functions and
            answers in a single request.
          </p>

          <ol className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PIPELINE.map((stage, index) => (
              <li key={stage.name} className="surface flex flex-col gap-2 p-4">
                <div className="flex items-center gap-2">
                  <span className="text-accent" aria-hidden>
                    <stage.icon size={16} />
                  </span>
                  <span className="tabular text-tertiary text-2xs">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                </div>
                <h3 className="text-primary text-sm font-medium">{stage.name}</h3>
                <p className="text-tertiary text-xs leading-relaxed">{stage.detail}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
