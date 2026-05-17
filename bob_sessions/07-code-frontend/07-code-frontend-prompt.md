# 07-code-frontend: User Prompts

**Session:** Code Mode | Phase 6: Frontend - D3.js Visualization + UI Integration
**Date:** 2026-05-17
**Coins Used:** ~7-8 (not explicitly reported)
**Coin Budget:** ≤8 coins
**Output:** 11 files (3 libs + 4 components + App.tsx + index.css + cache-repos.ts + README.md)
**Complexity:** M (integrative)

---

## Prompt

We're now in Code mode for Phase 6: Frontend - D3.js Visualization + UI Integration.

Refer to bob_sessions/01-plan/architecture.md (folder structure + Frontend components section).

Backend 4-agent pipeline complete (78/78 tests pass). Now build the frontend to render AnnotatedLayout as an interactive one-page City Map. This phase produces the visual that will be the demo's centerpiece.

# Task: Build the Atlas frontend

Files to create/update:

1. **src/lib/api-client.ts**:
   - fetchAnnotatedLayout(owner, repo, branch?) → Promise<AnnotatedLayout>
   - Try pre-cached /cache/{owner}-{repo}.json first (faster, no API call)
   - Fallback to POST /api/analyze
   - Typed error handling

2. **src/lib/d3-renderer.ts**:
   - renderCityMap(svgElement: SVGSVGElement, layout: AnnotatedLayout) function
   - Districts: semi-transparent colored regions (10-15% opacity) as background per district.bounds
   - Nodes: rounded rectangles (rx=4) as "buildings" with district color fill
   - Edges: thin curved lines using d3.linkHorizontal, semi-transparent (30% opacity)
   - Highlights:
     - "entry": glowing pulse animation (SVG feGaussianBlur filter + animated dur)
     - "core": bold white stroke (2px)
     - "hotspot": warm orange overlay (rgba(255, 140, 0, 0.4))
   - Labels: text elements positioned per Label.position with subtle drop shadow
   - Background: dark slate (#0a0e1a)
   - All transitions smooth via d3.transition()

3. **src/lib/png-export.ts**:
   - exportAsPNG(svgElement: SVGSVGElement, filename: string) function
   - Serialize SVG with XMLSerializer
   - Create Image from svg+xml data URL
   - Draw to canvas at 2x scale for retina
   - canvas.toBlob() → trigger download via temporary <a> element
   - Use white-on-dark background in exported PNG

4. **src/components/RepoInput.tsx**:
   - Dropdown of 3 pre-cached demo repos (shadcn/ui, hono, drizzle-orm) with names + descriptions
   - "Analyze" button triggers fetch
   - Optional input field for custom repo URL with placeholder "owner/repo" (disabled for MVP with tooltip "v2")
   - Loading state during fetch

5. **src/components/CityMap.tsx**:
   - Takes AnnotatedLayout prop
   - <svg> element with useEffect calling renderCityMap from d3-renderer
   - ResizeObserver for responsive resizing
   - Min height 80vh, full width
   - Tooltip on node hover: file path + LOC + type + highlight reason (if any), positioned near cursor
   - Pan/zoom with d3.zoom (drag to pan, scroll to zoom)

6. **src/components/ExportButton.tsx**:
   - "Export as PNG" button (icon + text)
   - Calls png-export on the rendered SVG
   - Disabled when no layout loaded
   - Success toast (or simple console.log + visual feedback for MVP)

7. **src/components/LoadingState.tsx**:
   - Skeleton with placeholder rects roughly arranged like a City Map
   - "Generating your map..." caption
   - Subtle pulse/shimmer animation

8. **src/App.tsx** (replace placeholder):
   - Layout structure: Header (Atlas logo + tagline) + RepoInput + ExportButton row + Main canvas area (CityMap or LoadingState) + Footer
   - Dark theme: bg-slate-950, text-slate-100
   - State: { layout, loading, error, selectedRepo }
   - Show error toast/banner on fetch failure

9. **src/index.css** updates:
   - SVG smooth rendering (shape-rendering: geometricPrecision)
   - @keyframes pulse for entry node animation
   - Custom dark theme scrollbar

10. **Pre-cache instructions** (README update):
    - How to generate the 3 demo JSONs locally (GITHUB_TOKEN in .dev.vars + `pnpm tsx scripts/cache-repos.ts`)
    - Note: cache files go in public/cache/ and are served as static assets

# Visual Style Direction: "City Map at Night"

- Background: dark slate (#0a0e1a)
- District backgrounds: semi-transparent (10-15% opacity), schemeTableau10
- Node fills: district color, full saturation if highlighted, 60% saturation otherwise
- Entry nodes: glowing pulse animation, 1.5x size
- Core nodes: bold white outline (2px)
- Hotspots: warm orange overlay
- Edges: thin (1px), 30% opacity, district color of source node
- Labels: clean sans-serif (system font stack), white with subtle drop shadow
- Hover: subtle scale up (1.05x) + bring to front

# Constraints

- TypeScript strict, no `any`
- D3.js v7 from existing dependency
- No new heavy deps; only utilities already installed
- Performance: smooth pan/zoom at 60fps for 500 nodes
- Mobile fallback: responsive but optimized for desktop demo
- Estimated coin budget: ≤8 coins (frontend integrative, M complexity)

# Deliverables

After this session:
- pnpm dev shows working Atlas: select a repo, watch loading, see the City Map, export PNG
- shadcn/ui demo: 300-500 nodes rendered without lag
- PNG export produces valid 2x resolution file
- Highlights and labels clearly visible
- Dark theme cohesive throughout
- Pan/zoom works smoothly

Generate all files with full content. After done, summarize what was created and any architecture.md deviations.

Save session reports to bob_sessions/07-code-frontend/.

---

## Outcome Summary

- 11 files: api-client.ts, d3-renderer.ts, png-export.ts, RepoInput.tsx, CityMap.tsx, ExportButton.tsx, LoadingState.tsx, App.tsx, index.css, cache-repos.ts (updated), README.md (updated)
- Dark theme "City Map at Night" implemented
- All highlight types (entry pulse, core stroke, hotspot overlay) implemented
- PNG export at 2x retina resolution
- Pan/zoom with d3.zoom (0.5x-3x)
- Cache-first API client with /api/analyze fallback
- Backend tests still 78/78 passing
- Dev server running at localhost:5173
- TypeScript clean, no errors
- Minor architecture deviations:
  - ExportButton uses direct SVG element reference (cleaner state)
  - CityMap exposes SVG via callback (better encapsulation)
  - Label positioning calculated relative to nodes
  - Tooltips use DOM elements (better styling control)
