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
export { buildScene, describeScene } from './scene';

/** Entrance sweep, long enough to cover the last building's delay. */
const ENTRANCE_MS = 1400;

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 12;
const LABEL_BASE = 11.5;
const DISTRICT_LABEL_BASE = 12;

/**
 * How far from a building a pointer may be and still mean it, in screen pixels.
 *
 * A phone renders a 469 file city into 390 points, which puts the median
 * building at 3.8px across and every single one of them under the 44px a
 * fingertip actually covers. Exact hit testing then resolves a tap by whichever
 * roof happens to lie under the reported contact point, and measured on a
 * 390x844 viewport a tap six pixels off centre opened the intended file once in
 * twelve tries and opened some *other* file ten times. It never reads as a
 * miss, because at that density there is always another building under the
 * finger, so the inspector opens confidently on the wrong one.
 *
 * Resolving by nearest centroid instead cannot make a 3.8px target easy to hit,
 * and nothing can. What it can do is make the answer predictable and therefore
 * correctable: the building nearest the finger, rather than whichever one
 * happens to be standing in front. That second part matters on a mouse too,
 * where a tall tower hides the roof of a short one behind it and cost 22% of
 * clicks aimed dead centre.
 */
const TOLERANCE_COARSE = 22;
const TOLERANCE_FINE = 7;

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
  // Kept here rather than only in the DOM. `render()` replaces the whole SVG,
  // so a spotlight written as classes on building groups disappeared on every
  // rotation, theme toggle and option change while the legend still showed the
  // district as pinned, and the only way back was to unpin and pin again.
  let focusedDistrictName: string | null = null;
  let transform: ZoomTransform = zoomIdentity;
  let lastZoomAt = 0;
  let pendingScale = 1;
  let entranceTimer = 0;

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
        // add it again and actually restart the animation. The handle is kept
        // so `destroy()` does not leave a timer pointing at a detached node.
        window.clearTimeout(entranceTimer);
        entranceTimer = window.setTimeout(
          () => city.classList.remove('is-entering'),
          ENTRANCE_MS,
        );
      }
    }

    applyTransform();
    paintFocus();
    applyDistrictFocus();
  }

  function applyTransform(): void {
    const camera = svgElement.querySelector<SVGGElement>('.atlas-camera');
    if (camera) camera.setAttribute('transform', transform.toString());
    scaleTypography();
    // Nothing else can move the fitted group, and `render` ends here too, so
    // this one line covers every way the screen mapping can go out of date.
    ctmStale = true;
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

  /** Every building's visual centre and half extents, in fitted coordinates. */
  let targets: Array<{ id: string; x: number; y: number; hx: number; hy: number }> = [];
  let targetsScene: Scene | null = null;
  let targetsAzimuth: Azimuth | null = null;

  function ensureTargets(): void {
    if (targetsScene === scene && targetsAzimuth === options.azimuth) return;
    targets = scene.nodes.map((node) => {
      const points = silhouette(node, options.azimuth);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const point of points) {
        if (point.x < minX) minX = point.x;
        if (point.x > maxX) maxX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.y > maxY) maxY = point.y;
      }
      return {
        id: node.id,
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        hx: (maxX - minX) / 2,
        hy: (maxY - minY) / 2,
      };
    });
    targetsScene = scene;
    targetsAzimuth = options.azimuth;
  }

  /**
   * Screen to world, cached.
   *
   * `getScreenCTM` forces a layout flush, and a pointer can move sixty times a
   * second, so the matrix is read at most once per change to it: only `render`
   * and `applyTransform` can move the fitted group, and both mark it stale.
   */
  let inverseCtm: DOMMatrix | null = null;
  let ctmScale = 1;
  let ctmStale = true;

  function toWorld(clientX: number, clientY: number): { x: number; y: number; scale: number } | null {
    if (ctmStale) {
      const fitGroup = svgElement.querySelector<SVGGElement>('.atlas-fit');
      const matrix = typeof fitGroup?.getScreenCTM === 'function' ? fitGroup.getScreenCTM() : null;
      inverseCtm = matrix && typeof matrix.inverse === 'function' ? matrix.inverse() : null;
      ctmScale = matrix ? Math.hypot(matrix.a, matrix.b) || 1 : 1;
      ctmStale = false;
    }
    if (!inverseCtm) return null;
    const m = inverseCtm;
    return {
      x: m.a * clientX + m.c * clientY + m.e,
      y: m.b * clientX + m.d * clientY + m.f,
      scale: ctmScale,
    };
  }

  /**
   * The building a pointer is closest to, allowing for its own size.
   *
   * Distance is measured to the building rather than to its centre, by growing
   * each silhouette by the tolerance and asking which grown shape the pointer is
   * furthest inside. Plain nearest centroid gets this wrong in the case that
   * matters most: a fingertip resting on the side of a tall tower is fifteen
   * pixels from that tower's centre and eight from the centre of the little
   * building tucked in beside it, so the strictly nearest answer is the one
   * the finger is not touching and cannot even see.
   */
  function nearestNodeId(clientX: number, clientY: number, tolerance: number): string | null {
    const world = toWorld(clientX, clientY);
    if (!world) return null;
    ensureTargets();

    // The tolerance describes the pointing device, not the camera, so it is
    // carried from screen pixels into world units at the current zoom.
    const reach = tolerance / world.scale;
    let best: string | null = null;
    let bestScore = 1;
    for (const target of targets) {
      const dx = (target.x - world.x) / (target.hx + reach);
      const dy = (target.y - world.y) / (target.hy + reach);
      const score = dx * dx + dy * dy;
      if (score < bestScore) {
        bestScore = score;
        best = target.id;
      }
    }
    return best;
  }

  function isCoarse(event: MouseEvent): boolean {
    const pointerType = (event as PointerEvent).pointerType;
    if (pointerType) return pointerType === 'touch' || pointerType === 'pen';
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  }

  function nodeIdFromEvent(event: MouseEvent): string | null {
    const target = event.target as Element | null;
    const exact = target?.closest?.('[data-node]')?.getAttribute('data-node') ?? null;
    const coarse = isCoarse(event);
    const near = nearestNodeId(
      event.clientX,
      event.clientY,
      coarse ? TOLERANCE_COARSE : TOLERANCE_FINE,
    );
    // A finger leads with proximity: what it covers is a blob nine millimetres
    // across, and the single point the browser reports for it is close to
    // arbitrary at this density. A mouse leads with the exact hit, which is
    // precise, and only falls back to proximity in the gaps between roofs.
    return coarse ? (near ?? exact) : (exact ?? near);
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
    focusedDistrictName = name;
    applyDistrictFocus();
  }

  function applyDistrictFocus(): void {
    const name = focusedDistrictName;
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

  /**
   * Zoom by a factor.
   *
   * An unnamed transition cancels whichever one is already running, and
   * `scaleBy` reads the current transform when its transition *starts*, so a
   * cancelled step contributed nothing at all: three clicks 120ms apart landed
   * on 2.58x instead of 3.05x, and holding the `+` key through fifteen
   * auto-repeats produced exactly one 1.45x step. Repeat input is applied
   * immediately instead, and only an isolated press gets the animation.
   */
  function zoomBy(factor: number): void {
    const now = performance.now();
    const chaining = now - lastZoomAt < 400;
    lastZoomAt = now;

    // Accumulate against the pending target, not against wherever the camera
    // happens to be mid animation, and move with `scaleTo` rather than
    // `scaleBy`. `scaleBy` reads the live transform when its transition
    // starts, so interrupting one threw away however much of that step had not
    // been applied yet: three clicks 120ms apart landed on 2.58x rather than
    // 3.05x, and holding the key produced a single step. An absolute target
    // cannot lose a step no matter how often it is interrupted.
    const base = chaining ? pendingScale : transform.k;
    pendingScale = Math.min(Math.max(base * factor, MIN_ZOOM), MAX_ZOOM);

    svg.interrupt();
    svg.transition().duration(chaining ? 110 : 220).call(zoomBehavior.scaleTo, pendingScale);
  }

  function resetView(): void {
    pendingScale = 1;
    lastZoomAt = 0;
    svg.interrupt();
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
    pendingScale = k;
    lastZoomAt = 0;
    svg
      .transition()
      .duration(520)
      .call(
        zoomBehavior.transform,
        zoomIdentity.translate(options.width / 2, options.height / 2).scale(k).translate(-screenX, -screenY),
      );
  }

  /**
   * Apply new options, and draw only if something actually changed.
   *
   * The idempotence is load bearing rather than an optimisation. React's
   * StrictMode mounts, unmounts and mounts again in development, so a guard
   * held in a `useRef` on the caller side only ever suppresses the very first
   * sync: on the second mount the update ran, replaced three thousand elements
   * eleven milliseconds after the renderer had drawn them, and wiped the
   * `is-entering` class the entrance animation depends on. Deciding here, from
   * the options themselves, cannot be defeated by how many times the caller is
   * mounted.
   */
  function update(next: Partial<IsoOptions>): void {
    const sceneChanged = next.scene !== undefined && next.scene !== options.scene;
    const azimuthChanged = next.azimuth !== undefined && next.azimuth !== options.azimuth;
    const visualChanged =
      sceneChanged ||
      azimuthChanged ||
      (next.theme !== undefined && next.theme !== options.theme) ||
      (next.showEdges !== undefined && next.showEdges !== options.showEdges) ||
      (next.showLabels !== undefined && next.showLabels !== options.showLabels) ||
      (next.showGrid !== undefined && next.showGrid !== options.showGrid) ||
      (next.width !== undefined && next.width !== options.width) ||
      (next.height !== undefined && next.height !== options.height);

    options = { ...options, ...next };
    if (!visualChanged) return;

    if (sceneChanged) {
      scene = options.scene;
      if (selectedId && !scene.nodeById.has(selectedId)) selectedId = null;
      if (hoveredId !== null) {
        hoveredId = null;
        // Otherwise the tooltip is stranded on screen describing a node from
        // the previous scene.
        options.onHover?.(null, null);
      }
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
    window.clearTimeout(entranceTimer);

    // A camera transition is attached to the element, not to this closure, so
    // without the interrupt a zoom started just before teardown carries on
    // driving whatever renderer comes next. And d3-zoom stores its transform
    // on the element as `__zoom` and adopts it when a new behaviour is
    // installed, so leaving it behind makes a fresh renderer disagree with the
    // DOM about where the camera is.
    svg.interrupt();
    svg.on('.zoom', null);
    delete (svgElement as unknown as { __zoom?: unknown }).__zoom;

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
