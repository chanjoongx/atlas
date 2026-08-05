import { Boxes, GitBranch, LayoutGrid, ScanSearch } from 'lucide-react';
import type { ThemeName } from '../lib/palette';
import { FAQ } from '../lib/faq';
import type { RepoRef } from '../lib/repo-ref';
import { DemoRepoCards, RepoInputCompact } from './RepoInput';
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
      {/*
        Two columns above the fold, so the skyline is the first thing a visitor
        sees rather than something they have to scroll for. It is the product
        drawing itself with the real projection and the real palette, which is
        a better argument than any sentence in the column beside it.
      */}
      <section className="px-6 pb-2 pt-10 sm:pt-14">
        <div className="mx-auto grid max-w-6xl items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] lg:gap-10">
          <div className="flex flex-col">
            <p className="border-line text-tertiary mb-5 inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-2xs">
              <span className="bg-accent size-1.5 rounded-full" aria-hidden />
              Second place, IBM Bob Hackathon 2026
            </p>

            <h1 className="text-3xl sm:text-4xl">Read any codebase as a city.</h1>

            <p className="text-secondary mt-4 max-w-xl text-lg">
              Atlas turns a public GitHub repository into an isometric map. Directories become
              districts, files become buildings as tall as the code inside them, and the handful of
              files that actually matter stand out as landmarks.
            </p>

            <div className="mt-7">
              <RepoInputCompact onAnalyze={onAnalyze} loading={loading} />
            </div>
          </div>

          <div
            className="pointer-events-none order-first select-none lg:order-none"
            style={{
              maskImage: 'radial-gradient(120% 110% at 50% 42%, black 58%, transparent 100%)',
              WebkitMaskImage: 'radial-gradient(120% 110% at 50% 42%, black 58%, transparent 100%)',
            }}
          >
            <SkylineArt
              theme={theme}
              className="mx-auto block h-[260px] w-full max-w-lg sm:h-[340px] lg:h-[460px] lg:max-w-none"
            />
          </div>
        </div>
      </section>

      <section className="px-6 pb-12 pt-4">
        <div className="mx-auto max-w-6xl">
          <DemoRepoCards onAnalyze={onAnalyze} loading={loading} />
        </div>
      </section>

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

      {/*
        Real answers to real questions, on the page rather than buried in a
        README. The same array is emitted as FAQPage structured data at build
        time, which is only legitimate because what a visitor reads here and
        what a search engine is told are the same words.
      */}
      <section className="border-line border-t px-6 py-12">
        <div className="mx-auto max-w-3xl">
          <p className="eyebrow">Questions</p>
          <dl className="mt-5 space-y-6">
            {FAQ.map((item) => (
              <div key={item.question}>
                <dt className="text-primary text-base font-medium">{item.question}</dt>
                <dd className="text-secondary mt-1.5 text-sm leading-relaxed">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  );
}
