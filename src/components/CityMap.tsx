import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ThemeName } from '../lib/palette';
import {
  createIsoRenderer,
  describeScene,
  type Azimuth,
  type IsoRenderer,
  type Scene,
  type SceneNode,
} from '../lib/iso';
import { MapControls, type ViewSettings } from './MapControls';
import { NodeTooltip } from './NodeTooltip';

interface CityMapProps {
  scene: Scene;
  theme: ThemeName;
  azimuth: Azimuth;
  settings: ViewSettings;
  selectedId: string | null;
  focusedDistrict: string | null;
  onAzimuth: (azimuth: Azimuth) => void;
  onSettings: (patch: Partial<ViewSettings>) => void;
  onSelect: (nodeId: string | null) => void;
  onReady: (renderer: IsoRenderer | null) => void;
  /** Opens the map key. Only rendered where the key column is not. */
  onOpenKey: () => void;
}

export function CityMap({
  scene,
  theme,
  azimuth,
  settings,
  selectedId,
  focusedDistrict,
  onAzimuth,
  onSettings,
  onSelect,
  onReady,
  onOpenKey,
}: CityMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const rendererRef = useRef<IsoRenderer | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<{ node: SceneNode; at: { x: number; y: number } } | null>(null);

  // Callbacks live in a ref so the renderer never has to be rebuilt just
  // because a parent re-rendered with a new closure.
  const handlers = useRef({ onSelect });
  handlers.current.onSelect = onSelect;

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const measure = (width: number, height: number) => {
      setSize((current) =>
        Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
          ? current
          : { width: Math.round(width), height: Math.round(height) },
      );
    };

    const rect = element.getBoundingClientRect();
    measure(rect.width, rect.height);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) measure(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // One renderer per canvas. Everything after this is an update, not a rebuild.
  useEffect(() => {
    if (!svgRef.current || size.width === 0 || size.height === 0) return;

    const renderer = createIsoRenderer(svgRef.current, {
      scene,
      theme,
      azimuth,
      showEdges: settings.showEdges,
      showLabels: settings.showLabels,
      showGrid: settings.showGrid,
      width: size.width,
      height: size.height,
      onHover: (node, at) => setHover(node && at ? { node, at } : null),
      onSelect: (node) => handlers.current.onSelect(node?.id ?? null),
    });

    rendererRef.current = renderer;
    onReady(renderer);

    return () => {
      renderer.destroy();
      rendererRef.current = null;
      onReady(null);
    };
    /*
     * `scene` is deliberately NOT a dependency.
     *
     * It used to be, and that one entry caused four separate defects, because
     * a new `Scene` object is produced every time the height exaggeration
     * slider moves. Tearing the renderer down and building a new one meant:
     * d3-zoom read the old transform back off the element's `__zoom` property
     * while the new renderer believed it was at identity, so the map snapped
     * to fit and then teleported back on the next scroll notch; the renderer's
     * copy of the selection was lost while React still held it, so the next
     * click on the selected building re-selected instead of closing it; and an
     * in flight camera transition from the dead renderer kept driving the live
     * one's camera group.
     *
     * Scene swaps go through `update()`, which is written for exactly that.
     * eslint-disable-next-line react-hooks/exhaustive-deps
     */
  }, [size.width === 0 || size.height === 0]);

  // Safe to run on the same commit as the effect above: `update()` compares the
  // options it is handed against the ones it already holds and does nothing
  // when they match, so the renderer's own first draw is never overwritten.
  useEffect(() => {
    rendererRef.current?.update({
      scene,
      theme,
      azimuth,
      showEdges: settings.showEdges,
      showLabels: settings.showLabels,
      showGrid: settings.showGrid,
      width: size.width,
      height: size.height,
    });
  }, [scene, theme, azimuth, settings.showEdges, settings.showLabels, settings.showGrid, size]);

  useEffect(() => {
    rendererRef.current?.setSelection(selectedId);
  }, [selectedId]);

  useEffect(() => {
    rendererRef.current?.focusDistrict(focusedDistrict);
  }, [focusedDistrict]);

  const rotate = useCallback(
    (direction: -1 | 1) => onAzimuth((((azimuth + direction + 4) % 4) as Azimuth)),
    [azimuth, onAzimuth],
  );

  const description = useMemo(() => describeScene(scene), [scene]);

  // Keyboard shortcuts, ignored while the visitor is typing somewhere.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case '+':
        case '=':
          rendererRef.current?.zoomBy(1.45);
          break;
        case '-':
        case '_':
          rendererRef.current?.zoomBy(1 / 1.45);
          break;
        case '0':
          rendererRef.current?.resetView();
          break;
        case '[':
          rotate(-1);
          break;
        case ']':
          rotate(1);
          break;
        case 'e':
          onSettings({ showEdges: !settings.showEdges });
          break;
        case 'l':
          onSettings({ showLabels: !settings.showLabels });
          break;
        case 'g':
          onSettings({ showGrid: !settings.showGrid });
          break;
        case 'Escape':
          handlers.current.onSelect(null);
          return;
        default:
          return;
      }
      event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [rotate, onSettings, settings.showEdges, settings.showLabels, settings.showGrid]);

  return (
    <div ref={containerRef} className="bg-inset relative min-h-0 flex-1 overflow-hidden">
      {/*
        `role="img"` rather than `role="application"`. Application tells a
        screen reader to pass keystrokes through to the widget, which was wrong
        twice over here: the element is not focusable, so nobody could ever get
        into it, and the shortcuts are bound to the window anyway. It also
        makes the three thousand roleless children presentational, which they
        already were in effect.
      */}
      <svg ref={svgRef} className="atlas-canvas" role="img" aria-label="Isometric map of the repository" />

      {/*
        The same map as prose. Marked as a status region so finishing a render
        is announced, which was previously silent: the loading state politely
        said it was working and then nothing ever said it had finished.
      */}
      <p className="sr-only" role="status" aria-live="polite">
        {description}
      </p>

      <MapControls
        azimuth={azimuth}
        settings={settings}
        edgeCount={scene.stats.edgeCount}
        onZoomIn={() => rendererRef.current?.zoomBy(1.45)}
        onZoomOut={() => rendererRef.current?.zoomBy(1 / 1.45)}
        onReset={() => rendererRef.current?.resetView()}
        onRotate={rotate}
        onSettings={onSettings}
        onOpenKey={onOpenKey}
      />

      <p className="text-tertiary hint-fine pointer-events-none inset-safe-left absolute bottom-3 flex-wrap items-center gap-x-3 gap-y-1 text-2xs">
        <span>
          <span className="kbd">drag</span> pan
        </span>
        <span>
          <span className="kbd">scroll</span> zoom
        </span>
        <span>
          <span className="kbd">[</span> <span className="kbd">]</span> rotate
        </span>
        <span>
          <span className="kbd">0</span> fit
        </span>
      </p>

      <p className="text-tertiary hint-coarse pointer-events-none inset-safe-left absolute bottom-3 flex-wrap items-center gap-x-3 gap-y-1 text-2xs">
        <span>drag to pan</span>
        <span>pinch to zoom</span>
        <span>tap a building</span>
      </p>

      <NodeTooltip node={hover?.node ?? null} at={hover?.at ?? null} theme={theme} />
    </div>
  );
}
