import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import type { AnnotatedLayout } from './types';
import { fetchAnnotatedLayout } from './lib/api-client';
import { buildScene, type Azimuth, type IsoRenderer } from './lib/iso';
import { WIDE, matchesMedia } from './lib/media';
import { formatRepoRef, parseRepoRef, type RepoRef } from './lib/repo-ref';
import { SITE_ORIGIN } from './lib/site';
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
  // Separate from the selection, because below lg the panel covers the map and
  // the two need to be able to disagree: the building stays outlined while the
  // panel gets out of the way.
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);

  // Guards against a slow request landing after the visitor moved on.
  const requestId = useRef(0);

  const analyze = useCallback(async (target: RepoRef) => {
    const id = ++requestId.current;
    setRef(target);
    setLoading(true);
    setError(null);
    setLayout(null);
    setSelectedId(null);
    setInspectorOpen(false);
    setKeyOpen(false);
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
    setInspectorOpen(false);
    setKeyOpen(false);
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
      // Written by hand rather than through URLSearchParams, which percent
      // encodes the slash and turns a link someone might read out loud into
      // `?repo=honojs%2Fhono`. A slash is legal in a query string, and the
      // parser accepts either form.
      history.pushState(null, '', `?repo=${formatRepoRef(target)}`);
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

  /**
   * Reflect the open repository in the document itself.
   *
   * A shared link, a browser tab and a bookmark should all say which city this
   * is, and a self referencing canonical is what makes each `?repo=` URL
   * indexable in its own right rather than folding into the root.
   */
  useEffect(() => {
    document.title = repoLabel
      ? `${repoLabel} as a city | Atlas`
      : 'Atlas | Read any codebase as a city';

    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonical) {
      canonical.href = repoLabel ? `${SITE_ORIGIN}/?repo=${repoLabel}` : `${SITE_ORIGIN}/`;
    }
  }, [repoLabel]);

  const patchSettings = useCallback(
    (patch: Partial<ViewSettings>) => setSettings((current) => ({ ...current, ...patch })),
    [],
  );

  const select = useCallback((nodeId: string | null) => {
    setSelectedId(nodeId);
    setInspectorOpen(nodeId !== null);
  }, []);

  /**
   * Fly the camera to a file.
   *
   * Below lg the panel is a full width sheet over the map, so flying the camera
   * and leaving the sheet up moved the view behind an opaque surface: measured
   * as a real camera change, zoom 1 to 2.2, that nobody could see. The building
   * stays selected and outlined; only the sheet gets out of the way.
   */
  const locate = useCallback(
    (nodeId: string) => {
      setSelectedId(nodeId);
      renderer?.flyTo(nodeId);
      if (!matchesMedia(WIDE)) setInspectorOpen(false);
    },
    [renderer],
  );

  const mapped = scene !== null && !loading;

  return (
    <div className={mapped ? 'flex h-dvh flex-col overflow-hidden' : 'flex min-h-dvh flex-col'}>
      <header className="border-line bg-surface pad-safe-x pad-safe-top flex shrink-0 items-center gap-3 border-b pb-2.5">
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
        // `relative` is load bearing. Without it the inspector's `inset-0`
        // resolved against the viewport rather than this region, so on every
        // width below lg the panel covered the header too: back, export, GitHub
        // and the theme toggle all went behind an opaque surface with no way
        // back except a 28px close button.
        <main className="relative flex min-h-0 flex-1">
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
              onSelect={select}
              onReady={setRenderer}
              onOpenKey={() => setKeyOpen(true)}
            />
            <StatsBar stats={scene.stats} theme={theme} />
          </div>

          {selectedNode && inspectorOpen && (
            <div className="absolute inset-0 z-30 flex justify-end lg:static lg:z-auto lg:w-80 lg:shrink-0">
              {/* Tapping beside the panel used to do nothing at all: it neither
                  closed the panel nor reached the map, which on an iPad in
                  portrait was 192px of dead screen and in landscape 460px.
                  It clears the selection rather than only hiding the panel,
                  because a building that stays selected invisibly makes the
                  next tap on it read as dead: the map would toggle it off and
                  nothing at all would happen on screen. */}
              <div
                aria-hidden
                onClick={() => select(null)}
                className="bg-scrim absolute inset-0 lg:hidden"
              />
              <div className="bg-surface relative h-full w-full max-w-sm lg:max-w-none">
                <Inspector
                  node={selectedNode}
                  scene={scene}
                  theme={theme}
                  repo={ref}
                  onSelect={select}
                  onLocate={locate}
                  onClose={() => select(null)}
                />
              </div>
            </div>
          )}

          {keyOpen && (
            <MapKeySheet onClose={() => setKeyOpen(false)}>
              <Legend
                scene={scene}
                theme={theme}
                focused={focusedDistrict}
                onFocus={setFocusedDistrict}
              />
            </MapKeySheet>
          )}
        </main>
      )}
    </div>
  );
}

/**
 * The map key, for every width where there is no room for a column.
 *
 * Tailwind's `lg` is 1024px, so `hidden lg:block` on the key column is not a
 * phone rule, it is a "narrower than a laptop" rule: it also fires on an iPad
 * in portrait and on any phone in landscape. What it removed was the only
 * explanation of what height, colour and the orange roofs mean, which are
 * precisely the two things the landing page promises. District names survive
 * because they are painted into the map itself; nothing else does.
 *
 * `display: none` also takes the column out of the accessibility tree, so this
 * was not only a small screen problem.
 */
function MapKeySheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // The map binds Escape on the window to clear its selection. Stopping
      // here keeps one key press from doing two things.
      event.stopPropagation();
      onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
    };
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center lg:hidden">
      <div aria-hidden onClick={onClose} className="bg-scrim absolute inset-0" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Map key"
        className="bg-surface border-line animate-fade-up relative flex h-3/4 w-full max-w-lg flex-col rounded-t-xl border-t"
      >
        <div className="border-subtle flex shrink-0 items-center justify-between border-b px-4 py-2.5">
          <p className="eyebrow">Map key</p>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon -mr-1.5 size-9"
            aria-label="Close map key"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="pad-safe-bottom min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="border-line pad-safe-x border-t py-7 [--pad-x:1.5rem]">
      <div className="text-tertiary mx-auto flex max-w-5xl flex-col gap-3 text-2xs sm:flex-row sm:items-center sm:justify-between">
        <p>
          Built by{' '}
          <a
            href="https://chanjoongx.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-secondary underline underline-offset-2 transition-colors"
          >
            Chanjoong Kim
          </a>{' '}
          with IBM Bob in 48 hours, May 2026, and rebuilt since. Open source under the MIT
          licence.
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
