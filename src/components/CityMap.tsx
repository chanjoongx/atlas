import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ThemeName } from '../lib/palette';
import { createIsoRenderer, type Azimuth, type IsoRenderer, type Scene, type SceneNode } from '../lib/iso';
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
    // Deliberately only re-created when the canvas itself changes size from
    // zero, or the scene identity changes. Option changes go through update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, size.width === 0 || size.height === 0]);

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
      <svg
        ref={svgRef}
        className="atlas-canvas"
        role="application"
        aria-label="Isometric map of the repository. Drag to pan, scroll to zoom, click a building for details."
      />

      <MapControls
        azimuth={azimuth}
        settings={settings}
        edgeCount={scene.stats.edgeCount}
        onZoomIn={() => rendererRef.current?.zoomBy(1.45)}
        onZoomOut={() => rendererRef.current?.zoomBy(1 / 1.45)}
        onReset={() => rendererRef.current?.resetView()}
        onRotate={rotate}
        onSettings={onSettings}
      />

      <p className="text-tertiary pointer-events-none absolute bottom-3 left-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs">
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

      <NodeTooltip node={hover?.node ?? null} at={hover?.at ?? null} theme={theme} />
    </div>
  );
}
