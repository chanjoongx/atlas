/**
 * The interactive isometric city.
 *
 * Owns exactly three things: the SVG contents, the camera, and which building
 * is under the pointer or selected. Everything visual lives in `draw.ts`,
 * everything about the data lives in `scene.ts`.
 */

import { select, type Selection } from 'd3-selection';
import 'd3-transition'; // augments Selection with .transition(), used by the camera moves
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import type { ThemeName } from '../palette';
import { readMapTokens } from '../theme';
import { drawScene, escapeAttr, silhouette } from './draw';
import { polygonPoints, type Azimuth } from './projection';
import type { Scene, SceneNode } from './scene';

export type { Azimuth } from './projection';
export type { Scene, SceneNode, SceneStats, SceneDistrict } from './scene';
export { buildScene } from './scene';

/** Entrance sweep, long enough to cover the last building's delay. */
const ENTRANCE_MS = 1400;

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 12;
const LABEL_BASE = 11.5;
const DISTRICT_LABEL_BASE = 12;

export interface IsoOptions {
  /** Built by `buildScene`, owned by the caller so panels can share it. */
  scene: Scene;
  theme: ThemeName;
  azimuth: Azimuth;
  showEdges: boolean;
  showLabels: boolean;
  showGrid: boolean;
  width: number;
  height: number;
  onHover?: (node: SceneNode | null, screen: { x: number; y: number } | null) => void;
  onSelect?: (node: SceneNode | null) => void;
  onZoom?: (scale: number) => void;
}

export interface IsoRenderer {
  update(next: Partial<IsoOptions>): void;
  setSelection(id: string | null): void;
  focusDistrict(name: string | null): void;
  zoomBy(factor: number): void;
  resetView(): void;
  flyTo(nodeId: string): void;
  /** Standalone markup for the exporter, always framed and never zoomed. */
  exportMarkup(width: number, height: number): string;
  destroy(): void;
}

export function createIsoRenderer(svgElement: SVGSVGElement, initial: IsoOptions): IsoRenderer {
  let options: IsoOptions = { ...initial };
  let scene = options.scene;
  let fitScale = 1;
  let selectedId: string | null = null;
  let hoveredId: string | null = null;
  let transform: ZoomTransform = zoomIdentity;

  const svg = select(svgElement);
  const zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>()
    .scaleExtent([MIN_ZOOM, MAX_ZOOM])
    .on('zoom', (event) => {
      transform = event.transform;
      applyTransform();
      options.onZoom?.(transform.k);
    });

  svg.call(zoomBehavior).on('dblclick.zoom', null);

  /* ---------------------------------------------------------------------- */

  /**
   * `animate` gates the entrance sweep. It belongs to a new city or a new
   * camera angle, and to nothing else: replaying it on every resize, theme
   * toggle or slider nudge would turn a flourish into a twitch.
   */
  function render(animate = false): void {
    const tokens = readMapTokens(options.theme);
    const result = drawScene({
      scene,
      theme: options.theme,
      tokens,
      azimuth: options.azimuth,
      width: options.width,
      height: options.height,
      showEdges: options.showEdges,
      showLabels: options.showLabels,
      showGrid: options.showGrid,
    });
    fitScale = result.fit.scale;

    svgElement.setAttribute('viewBox', `0 0 ${options.width} ${options.height}`);
    svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svgElement.innerHTML = `${result.markup}<g class="atlas-focus" pointer-events="none"></g>`;

    // The focus overlay has to sit inside the fitted group so its coordinates
    // match the buildings, but after them so it is never painted over.
    const fitGroup = svgElement.querySelector('.atlas-fit');
    const focusGroup = svgElement.querySelector('.atlas-focus');
    if (fitGroup && focusGroup) fitGroup.appendChild(focusGroup);

    if (animate) {
      const city = svgElement.querySelector<SVGGElement>('.atlas-city');
      if (city) {
        city.classList.add('is-entering');
        // The class is dropped once the sweep is over so the next render can
        // add it again and actually restart the animation.
        window.setTimeout(() => city.classList.remove('is-entering'), ENTRANCE_MS);
      }
    }

    applyTransform();
    paintFocus();
  }

  function applyTransform(): void {
    const camera = svgElement.querySelector<SVGGElement>('.atlas-camera');
    if (camera) camera.setAttribute('transform', transform.toString());
    scaleTypography();
  }

  /** Labels are anchored in world space but must stay a constant screen size. */
  function scaleTypography(): void {
    const total = fitScale * transform.k || 1;
    const labels = svgElement.querySelector<SVGGElement>('.atlas-labels');
    if (labels) {
      labels.style.fontSize = `${LABEL_BASE / total}px`;
      labels.style.strokeWidth = `${3.25 / total}px`;
    }
    const districts = svgElement.querySelector<SVGGElement>('.atlas-district-labels');
    if (districts) {
      districts.style.fontSize = `${DISTRICT_LABEL_BASE / total}px`;
      districts.style.strokeWidth = `${3.5 / total}px`;
    }
  }

  function paintFocus(): void {
    const group = svgElement.querySelector<SVGGElement>('.atlas-focus');
    if (!group) return;

    const id = hoveredId ?? selectedId;
    const node = id ? scene.nodeById.get(id) : undefined;
    if (!node) {
      group.innerHTML = '';
      return;
    }

    const outline = polygonPoints(silhouette(node, options.azimuth));
    const isSelected = node.id === selectedId;
    group.innerHTML =
      `<polygon points="${outline}" fill="none" stroke="var(--accent)" stroke-width="${
        isSelected ? 2.25 : 1.5
      }" stroke-linejoin="round" vector-effect="non-scaling-stroke" opacity="${
        isSelected ? 1 : 0.85
      }"/>`;

    // Dependencies of the focused file come forward, everything else recedes.
    const edges = svgElement.querySelector<SVGGElement>('.atlas-edges');
    if (edges) {
      edges.classList.add('has-focus');
      edges.querySelectorAll<SVGPathElement>('.is-focus').forEach((el) => el.classList.remove('is-focus'));
      edges
        .querySelectorAll<SVGPathElement>(
          `[data-from="${cssEscape(node.id)}"],[data-to="${cssEscape(node.id)}"]`,
        )
        .forEach((el) => el.classList.add('is-focus'));
    }
  }

  function clearEdgeFocus(): void {
    const edges = svgElement.querySelector<SVGGElement>('.atlas-edges');
    if (!edges) return;
    edges.classList.remove('has-focus');
    edges.querySelectorAll<SVGPathElement>('.is-focus').forEach((el) => el.classList.remove('is-focus'));
  }

  /* ---------------------------------------------------------------------- */
  /* Pointer handling, by delegation                                         */

  function nodeIdFromEvent(event: Event): string | null {
    const target = event.target as Element | null;
    const group = target?.closest?.('[data-node]');
    return group?.getAttribute('data-node') ?? null;
  }

  function onPointerMove(event: PointerEvent): void {
    const id = nodeIdFromEvent(event);
    if (id === hoveredId) return;
    hoveredId = id;
    paintFocus();
    if (!id) clearEdgeFocus();
    const node = id ? scene.nodeById.get(id) ?? null : null;
    options.onHover?.(node, node ? { x: event.clientX, y: event.clientY } : null);
  }

  function onPointerLeave(): void {
    if (hoveredId === null) return;
    hoveredId = null;
    paintFocus();
    clearEdgeFocus();
    options.onHover?.(null, null);
  }

  function onClick(event: MouseEvent): void {
    const id = nodeIdFromEvent(event);
    // Decide before mutating. setSelection writes selectedId, so comparing
    // against it afterwards always said "same node" and the host was handed a
    // null selection on every click, which is why the inspector never opened.
    const next = id === selectedId ? null : id;
    setSelection(next);
    options.onSelect?.(next ? (scene.nodeById.get(next) ?? null) : null);
  }

  svgElement.addEventListener('pointermove', onPointerMove);
  svgElement.addEventListener('pointerleave', onPointerLeave);
  svgElement.addEventListener('click', onClick);

  /* ---------------------------------------------------------------------- */

  function setSelection(id: string | null): void {
    selectedId = id;
    paintFocus();
    if (!id && !hoveredId) clearEdgeFocus();
  }

  function focusDistrict(name: string | null): void {
    const city = svgElement.querySelector<SVGGElement>('.atlas-city');
    if (!city) return;
    city.querySelectorAll<SVGGElement>('.is-district-focus').forEach((el) =>
      el.classList.remove('is-district-focus'),
    );
    if (!name) {
      city.classList.remove('has-district-focus');
      return;
    }
    city.classList.add('has-district-focus');
    city
      .querySelectorAll<SVGGElement>(`[data-district="${cssEscape(name)}"]`)
      .forEach((el) => el.classList.add('is-district-focus'));
  }

  function zoomBy(factor: number): void {
    svg.transition().duration(220).call(zoomBehavior.scaleBy, factor);
  }

  function resetView(): void {
    svg.transition().duration(380).call(zoomBehavior.transform, zoomIdentity);
  }

  function flyTo(nodeId: string): void {
    const node = scene.nodeById.get(nodeId);
    if (!node) return;
    const points = silhouette(node, options.azimuth);
    const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;

    const fitGroup = svgElement.querySelector<SVGGElement>('.atlas-fit');
    const matrix = fitGroup?.transform.baseVal.consolidate()?.matrix;
    const screenX = matrix ? matrix.a * cx + matrix.e : cx;
    const screenY = matrix ? matrix.d * cy + matrix.f : cy;

    const k = Math.max(transform.k, 2.2);
    svg
      .transition()
      .duration(520)
      .call(
        zoomBehavior.transform,
        zoomIdentity.translate(options.width / 2, options.height / 2).scale(k).translate(-screenX, -screenY),
      );
  }

  function update(next: Partial<IsoOptions>): void {
    const sceneChanged = next.scene !== undefined && next.scene !== options.scene;
    const azimuthChanged = next.azimuth !== undefined && next.azimuth !== options.azimuth;
    options = { ...options, ...next };

    if (sceneChanged) {
      scene = options.scene;
      if (selectedId && !scene.nodeById.has(selectedId)) selectedId = null;
      hoveredId = null;
    }
    render(sceneChanged || azimuthChanged);
  }

  function exportMarkup(width: number, height: number): string {
    const tokens = readMapTokens(options.theme);
    return drawScene({
      scene,
      theme: options.theme,
      tokens,
      azimuth: options.azimuth,
      width,
      height,
      showEdges: options.showEdges,
      showLabels: options.showLabels,
      showGrid: options.showGrid,
      padding: 0.06,
    }).markup;
  }

  function destroy(): void {
    svgElement.removeEventListener('pointermove', onPointerMove);
    svgElement.removeEventListener('pointerleave', onPointerLeave);
    svgElement.removeEventListener('click', onClick);
    svg.on('.zoom', null);
    svgElement.innerHTML = '';
  }

  render(true);

  return {
    update,
    setSelection,
    focusDistrict,
    zoomBy,
    resetView,
    flyTo,
    exportMarkup,
    destroy,
  };
}

/** `CSS.escape` is not universal, and our ids are file paths. */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return escapeAttr(value).replace(/["\\]/g, '\\$&');
}

/** Re-exported so consumers do not have to reach into the submodules. */
export type IsoSelection = Selection<SVGSVGElement, unknown, null, undefined>;
