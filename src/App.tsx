import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { AnnotatedLayout } from './types';
import { fetchAnnotatedLayout } from './lib/api-client';
import { buildScene, type Azimuth, type IsoRenderer } from './lib/iso';
import { formatRepoRef, parseRepoRef, type RepoRef } from './lib/repo-ref';
import { useTheme } from './lib/theme';
import { AtlasLockup, AtlasMark } from './components/Logo';
import { CityMap } from './components/CityMap';
import { ErrorState } from './components/ErrorState';
import { ExportButton } from './components/ExportButton';
import { GithubIcon } from './components/GithubIcon';
import { Inspector } from './components/Inspector';
import { Landing } from './components/Landing';
import { Legend } from './components/Legend';
import { LoadingState } from './components/LoadingState';
import { StatsBar } from './components/StatsBar';
import { ThemeToggle } from './components/ThemeToggle';
import type { ViewSettings } from './components/MapControls';

const REPO_URL = 'https://github.com/chanjoongx/atlas';

const DEFAULT_SETTINGS: ViewSettings = {
  exaggeration: 1,
  showEdges: true,
  showLabels: true,
  showGrid: true,
};

export default function App() {
  const { theme, toggleTheme } = useTheme();

  const [ref, setRef] = useState<RepoRef | null>(null);
  const [layout, setLayout] = useState<AnnotatedLayout | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const [azimuth, setAzimuth] = useState<Azimuth>(0);
  const [settings, setSettings] = useState<ViewSettings>(DEFAULT_SETTINGS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedDistrict, setFocusedDistrict] = useState<string | null>(null);
  const [renderer, setRenderer] = useState<IsoRenderer | null>(null);

  // Guards against a slow request landing after the visitor moved on.
  const requestId = useRef(0);

  const analyze = useCallback(async (target: RepoRef) => {
    const id = ++requestId.current;
    setRef(target);
    setLoading(true);
    setError(null);
    setLayout(null);
    setSelectedId(null);
    setFocusedDistrict(null);

    try {
      const result = await fetchAnnotatedLayout(target);
      if (id !== requestId.current) return;
      setLayout(result);
    } catch (caught) {
      if (id !== requestId.current) return;
      setError(caught);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    requestId.current += 1;
    setRef(null);
    setLayout(null);
    setError(null);
    setLoading(false);
    setSelectedId(null);
    setFocusedDistrict(null);
    setAzimuth(0);
  }, []);

  /**
   * A map is worth linking to, so the repository lives in the query string.
   * Reading it on mount makes `?repo=honojs/hono` shareable, and listening for
   * popstate makes the back button do what a visitor expects rather than
   * dropping them out of the app entirely.
   */
  useEffect(() => {
    const load = () => {
      const target = parseRepoRef(new URLSearchParams(location.search).get('repo') ?? '');
      if (target) analyze(target);
      else clear();
    };
    load();
    addEventListener('popstate', load);
    return () => removeEventListener('popstate', load);
  }, [analyze, clear]);

  const open = useCallback(
    (target: RepoRef) => {
      const url = new URL(location.href);
      url.searchParams.set('repo', formatRepoRef(target));
      history.pushState(null, '', url);
      analyze(target);
    },
    [analyze],
  );

  const reset = useCallback(() => {
    const url = new URL(location.href);
    url.searchParams.delete('repo');
    history.pushState(null, '', url);
    clear();
  }, [clear]);

  const scene = useMemo(
    () => (layout ? buildScene(layout, { exaggeration: settings.exaggeration }) : null),
    [layout, settings.exaggeration],
  );

  const selectedNode = selectedId && scene ? (scene.nodeById.get(selectedId) ?? null) : null;
  const repoLabel = ref ? formatRepoRef(ref) : null;
  const failed = error !== null && error !== undefined;

  const patchSettings = useCallback(
    (patch: Partial<ViewSettings>) => setSettings((current) => ({ ...current, ...patch })),
    [],
  );

  const locate = useCallback(
    (nodeId: string) => {
      setSelectedId(nodeId);
      renderer?.flyTo(nodeId);
    },
    [renderer],
  );

  const mapped = scene !== null && !loading;

  return (
    <div className={mapped ? 'flex h-dvh flex-col overflow-hidden' : 'flex min-h-dvh flex-col'}>
      <header className="border-line bg-surface flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
        {mapped || loading || failed ? (
          <>
            <button
              type="button"
              onClick={reset}
              className="btn btn-ghost -ml-2 gap-1.5 pl-2"
              aria-label="Start a new map"
            >
              <ArrowLeft size={15} aria-hidden />
              <AtlasMark size={18} />
            </button>
            {repoLabel && (
              <h1 className="mono text-primary min-w-0 truncate text-sm font-medium">{repoLabel}</h1>
            )}
          </>
        ) : (
          <AtlasLockup className="text-primary" />
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {mapped && (
            <ExportButton
              renderer={renderer}
              theme={theme}
              repo={repoLabel}
              stats={scene?.stats ?? null}
            />
          )}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-icon"
            aria-label="Atlas on GitHub"
            title="Atlas on GitHub"
          >
            <GithubIcon />
          </a>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </header>

      {loading && <LoadingState repo={repoLabel} expected={ref && isDemo(ref) ? 3 : 16} />}

      {!loading && failed && (
        <ErrorState
          error={error}
          repo={repoLabel}
          onRetry={() => ref && analyze(ref)}
          onDismiss={reset}
        />
      )}

      {!loading && !failed && !scene && (
        <>
          <main className="flex-1">
            <Landing theme={theme} loading={loading} onAnalyze={open} />
          </main>
          <SiteFooter />
        </>
      )}

      {mapped && scene && (
        <main className="flex min-h-0 flex-1">
          <aside
            className="border-line bg-surface hidden w-64 shrink-0 border-r lg:block"
            aria-label="Map key"
          >
            <Legend
              scene={scene}
              theme={theme}
              focused={focusedDistrict}
              onFocus={setFocusedDistrict}
            />
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <CityMap
              scene={scene}
              theme={theme}
              azimuth={azimuth}
              settings={settings}
              selectedId={selectedId}
              focusedDistrict={focusedDistrict}
              onAzimuth={setAzimuth}
              onSettings={patchSettings}
              onSelect={setSelectedId}
              onReady={setRenderer}
            />
            <StatsBar stats={scene.stats} theme={theme} />
          </div>

          {selectedNode && (
            <div className="bg-scrim absolute inset-0 z-30 flex justify-end lg:static lg:z-auto lg:w-80 lg:shrink-0 lg:bg-transparent">
              <div className="bg-surface h-full w-full max-w-sm lg:max-w-none">
                <Inspector
                  node={selectedNode}
                  scene={scene}
                  theme={theme}
                  repo={ref}
                  onSelect={setSelectedId}
                  onLocate={locate}
                  onClose={() => setSelectedId(null)}
                />
              </div>
            </div>
          )}
        </main>
      )}
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="border-line border-t px-6 py-7">
      <div className="text-tertiary mx-auto flex max-w-5xl flex-col gap-3 text-2xs sm:flex-row sm:items-center sm:justify-between">
        <p>
          Built with IBM Bob in 48 hours, May 2026. Open source under the MIT licence.
        </p>
        <nav className="flex items-center gap-4">
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="hover:text-secondary transition-colors">
            Source
          </a>
          <a
            href="https://lablab.ai/ai-hackathons/ibm-bob-hackathon/atlas/atlas"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-secondary transition-colors"
          >
            Submission
          </a>
          <a
            href="https://youtu.be/dEMnS6_CdbY"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-secondary transition-colors"
          >
            Demo video
          </a>
        </nav>
      </div>
    </footer>
  );
}

function isDemo(ref: RepoRef): boolean {
  return (
    !ref.branch &&
    ['shadcn-ui/ui', 'honojs/hono', 'drizzle-team/drizzle-orm'].includes(
      `${ref.owner}/${ref.repo}`,
    )
  );
}
