# 11-visual-quality / Round 2: Layout Coherence + Zoom Polish

**Session:** Code Mode | Phase 11 follow-up (continuing same task as Round 1)
**Date:** 2026-05-17
**Output:** 2 files modified (1 renderer + 1 React component), 4 issues fixed
**Trigger:** Round 1 deploy on shadcn/ui showed:
- District background rectangles didn't match actual node positions (large empty rects beside the node clusters)
- No visible zoom UI; users couldn't discover zoom/pan
- Initial view was too tight (content filled viewport with no breathing room)
- Next.js-style repos showed duplicate labels stacked on top of each other ("index index index", "page page")

---

## Diagnosis (Claude Code Ultrathink analysis)

| # | Severity | Symptom | Root Cause | Fix Location |
|---|----------|---------|------------|--------------|
| 1 | CRITICAL | District rect doesn't wrap its nodes | Backend `layout.ts` computes `district.bounds` from simNodes (pre-rescale coords) while frontend renders nodes from post-rescale coords. Coordinate systems desynced. | `src/lib/d3-renderer.ts:146-186` |
| 2 | HIGH | Zoom UI invisible / undiscoverable | `renderCityMap` returns void; no API to trigger zoom from React side. Also initial transform was identity (1.0) — no breathing room. | `src/lib/d3-renderer.ts:28-35, 318-332` |
| 3 | HIGH | No zoom buttons in UI | `CityMap.tsx` has no UI elements for zoom; user has to know to scroll-wheel or pinch. | `src/components/CityMap.tsx` (full replace) |
| 4 | MEDIUM | Duplicate labels overlap | All `label.text` rendered as-is. Next.js repos with many `index.tsx`, `page.tsx` files stack the same text repeatedly. | `src/lib/d3-renderer.ts:289-316` |

---

## Prompt

Phase 11 follow-up: Layout Coherence + Zoom Polish (continuing this task)

Save session reports to bob_sessions/11-visual-quality/round-2/ (or append to existing).

Verification after changes:
- pnpm build → exit 0
- pnpm test → 78/78 still passing
- Files touched: src/lib/d3-renderer.ts, src/components/CityMap.tsx only (no backend changes)

---

Final polish round for the Atlas City Map visualization. Apply 4 frontend-only fixes in one pass. Backend (functions/) is NOT touched. 2 files modified.

Files affected:
- src/lib/d3-renderer.ts (Fixes 1, 2, 4)
- src/components/CityMap.tsx (Fix 3, full replacement)

Symptoms in production:
1. District background rectangles don't match actual node positions (large empty rectangles sit beside the node clusters)
2. No visible zoom UI; users can't discover zoom/pan
3. Initial view is too tight (content fills viewport with no breathing room)
4. Next.js-style repos show duplicate labels stacked on top of each other ("index index index", "page page")

Apply order: within d3-renderer.ts, work bottom-up by line number (Fix 4 → Fix 2 → Fix 1) so earlier line numbers don't shift. Then apply Fix 3 (CityMap.tsx).

==============================
Fix 1 — src/lib/d3-renderer.ts: Recompute district bounds from actual node positions (CRITICAL)
==============================

Background: The backend layout.ts computes district.bounds using simNodes coordinates (pre-rescale), then rescales node coordinates separately. The two coordinate systems are out of sync, so rectangles render in the wrong place. Recomputing bounds on the frontend from actual node positions bypasses the backend bug entirely.

Replace lines 146-186 (the district rect block + the district label block) with a single combined block:

  // Render districts as background regions + district labels
  // (Compute bounds from actual node positions, not district.bounds —
  //  backend sends pre-scale bounds while nodes have post-scale positions.)
  const BOUNDS_PADDING_PX = 24;
  const districtGroup = g.append('g').attr('class', 'districts');
  const districtLabelGroup = g.append('g').attr('class', 'district-labels');

  layout.districts.forEach((district) => {
    const color = districtColorMap.get(district.name) || '#888';

    const districtNodes = district.nodes
      .map((id) => nodeMap.get(id))
      .filter((n): n is NodeWithDistrict => n !== undefined);

    if (districtNodes.length === 0) return;

    const xs = districtNodes.flatMap((n) => [n.x - n.width / 2, n.x + n.width / 2]);
    const ys = districtNodes.flatMap((n) => [n.y - n.height / 2, n.y + n.height / 2]);
    const dMinX = Math.min(...xs);
    const dMaxX = Math.max(...xs);
    const dMinY = Math.min(...ys);
    const dMaxY = Math.max(...ys);

    const screenMinX = tx(dMinX) - BOUNDS_PADDING_PX;
    const screenMinY = ty(dMinY) - BOUNDS_PADDING_PX;
    const screenMaxX = tx(dMaxX) + BOUNDS_PADDING_PX;
    const screenMaxY = ty(dMaxY) + BOUNDS_PADDING_PX;

    districtGroup
      .append('rect')
      .attr('x', screenMinX)
      .attr('y', screenMinY)
      .attr('width', screenMaxX - screenMinX)
      .attr('height', screenMaxY - screenMinY)
      .attr('fill', color)
      .attr('opacity', DISTRICT_OPACITY)
      .attr('stroke', color)
      .attr('stroke-opacity', DISTRICT_STROKE_OPACITY)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4 4')
      .attr('rx', 12);

    const labelCenterX = (screenMinX + screenMaxX) / 2;
    const labelTopY = screenMinY - 8;

    districtLabelGroup
      .append('text')
      .attr('x', labelCenterX)
      .attr('y', labelTopY)
      .attr('text-anchor', 'middle')
      .attr('fill', color)
      .attr('font-size', '13px')
      .attr('font-weight', '700')
      .attr('letter-spacing', '0.05em')
      .style('text-shadow', '0 1px 3px rgba(0,0,0,0.8)')
      .text(district.name.toUpperCase());
  });

==============================
Fix 2 — src/lib/d3-renderer.ts: Expose zoom API + initial 0.9 fit (HIGH)
==============================

Fix 2-A: Function signature + interface export (replace lines 28-35)

  /**
   * Imperative handle returned by renderCityMap for external zoom control.
   */
  export interface CityMapHandle {
    zoomIn: () => void;
    zoomOut: () => void;
    reset: () => void;
  }

  export function renderCityMap(
    svgElement: SVGSVGElement,
    layout: AnnotatedLayout,
    options?: Partial<RenderOptions>
  ): CityMapHandle {

Fix 2-B: Zoom setup block (replace lines 318-332)

  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.2, 8])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });

  svg.call(zoom as any);
  svg.on('dblclick.zoom', null);

  const initialTransform = d3.zoomIdentity
    .translate(width / 2, height / 2)
    .scale(0.9)
    .translate(-width / 2, -height / 2);
  svg.call(zoom.transform as any, initialTransform);

  return {
    zoomIn: () => {
      svg.transition().duration(250).call(zoom.scaleBy as any, 1.4);
    },
    zoomOut: () => {
      svg.transition().duration(250).call(zoom.scaleBy as any, 1 / 1.4);
    },
    reset: () => {
      svg.transition().duration(400).call(zoom.transform as any, initialTransform);
    },
  };
}

==============================
Fix 3 — src/components/CityMap.tsx: Full file replacement (HIGH)
==============================

Key changes:
- import adds `type CityMapHandle`
- handleRef stores the API returned by renderCityMap
- Container div adds `relative` (positioning anchor for absolute children)
- Top-right 3-button zoom panel (in / out / reset) with Tailwind styling

Full new content:

  import { useEffect, useRef, useState } from 'react';
  import type { AnnotatedLayout } from '../types';
  import { renderCityMap, type CityMapHandle } from '../lib/d3-renderer';

  interface CityMapProps {
    layout: AnnotatedLayout;
    onSvgReady?: (svg: SVGSVGElement | null) => void;
  }

  export function CityMap({ layout, onSvgReady }: CityMapProps) {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const handleRef = useRef<CityMapHandle | null>(null);
    const [dimensions, setDimensions] = useState({ width: 1200, height: 800 });

    useEffect(() => {
      if (onSvgReady) onSvgReady(svgRef.current);
    }, [onSvgReady]);

    useEffect(() => {
      if (!containerRef.current) return;
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          setDimensions({
            width: Math.max(width, 800),
            height: Math.max(height, 600),
          });
        }
      });
      resizeObserver.observe(containerRef.current);
      return () => resizeObserver.disconnect();
    }, []);

    useEffect(() => {
      if (!svgRef.current || !layout) return;
      try {
        handleRef.current = renderCityMap(svgRef.current, layout, {
          width: dimensions.width,
          height: dimensions.height,
        });
      } catch (error) {
        console.error('Failed to render city map:', error);
      }
    }, [layout, dimensions]);

    return (
      <div
        ref={containerRef}
        className="w-full flex-1 min-h-0 relative bg-slate-950 rounded-lg overflow-hidden border border-slate-800"
      >
        <svg
          ref={svgRef}
          className="w-full h-full"
          style={{ shapeRendering: 'geometricPrecision' }}
        />

        {/* Zoom controls */}
        <div className="absolute top-4 right-4 flex flex-col gap-1 bg-slate-900/80 backdrop-blur-sm rounded-lg border border-slate-700 shadow-lg p-1 z-10">
          <button onClick={() => handleRef.current?.zoomIn()} aria-label="Zoom in" title="Zoom in"
            className="w-9 h-9 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12m6-6H6" />
            </svg>
          </button>
          <button onClick={() => handleRef.current?.zoomOut()} aria-label="Zoom out" title="Zoom out"
            className="w-9 h-9 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 12H6" />
            </svg>
          </button>
          <div className="w-full h-px bg-slate-700 my-0.5" />
          <button onClick={() => handleRef.current?.reset()} aria-label="Reset view" title="Reset view"
            className="w-9 h-9 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h6m-6 0v6m0-6l7 7m9 1v-6m0 6h-6m6 0l-7-7" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

==============================
Fix 4 — src/lib/d3-renderer.ts: Disambiguate duplicate labels with parent dir prefix (MEDIUM)
==============================

Replace lines 289-316 with:

  const highlightedNodeIds = new Set(layout.highlights.map((h) => h.nodeId));
  const filteredLabels = layout.labels
    .filter((label) => highlightedNodeIds.has(label.nodeId))
    .slice(0, 25);

  const labelTextCount = new Map<string, number>();
  filteredLabels.forEach((l) => {
    labelTextCount.set(l.text, (labelTextCount.get(l.text) || 0) + 1);
  });

  const labelGroup = g.append('g').attr('class', 'labels');
  filteredLabels.forEach((label) => {
    const node = nodeMap.get(label.nodeId);
    if (!node) return;

    let displayText = label.text;
    if ((labelTextCount.get(label.text) || 0) > 1) {
      const pathParts = node.metadata.path.split('/');
      if (pathParts.length >= 2) {
        const parent = pathParts[pathParts.length - 2];
        displayText = `${parent}/${label.text}`;
      }
    }

    const labelX = tx(node.x);
    const labelY = ty(node.y);

    labelGroup
      .append('text')
      .attr('x', labelX)
      .attr('y', labelY)
      .attr('text-anchor', 'middle')
      .attr('fill', 'white')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .attr('paint-order', 'stroke')
      .attr('stroke', 'rgba(0,0,0,0.85)')
      .attr('stroke-width', '3px')
      .attr('stroke-linejoin', 'round')
      .text(displayText);
  });

==============================
Post-work checklist
==============================

1. pnpm build passes (tsc + vite build, no errors).
2. pnpm test → 78/78 still passing.
3. Files changed: src/lib/d3-renderer.ts, src/components/CityMap.tsx only. Backend (functions/) untouched.
4. Expected results on demo repos:
   - District background rectangles wrap their nodes precisely (no empty rects beside clusters, no nodes outside their district).
   - 3-button zoom panel (+/−/reset) in top-right corner of the map.
   - Initial view starts at 0.9 scale (some breathing room around content).
   - Duplicate labels show as "parent/filename" (e.g. "dashboard/index" instead of "index").
5. Leave changes in work tree only. User will git commit + push manually.

---

## Outcome Summary

- 4 layout/interaction issues fixed in one coordinated pass
- Files modified: src/lib/d3-renderer.ts (Fixes 1, 2, 4) + src/components/CityMap.tsx (Fix 3)
- pnpm build: exit 0
- pnpm test: 78/78 still passing
- Backend (functions/) untouched
- Visual verification on shadcn/ui showed proper district-node alignment + visible zoom controls
- Ready for commit + push → Cloudflare auto-redeploy
