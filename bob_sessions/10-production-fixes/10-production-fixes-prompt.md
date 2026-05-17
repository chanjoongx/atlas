# 10-production-fixes: User Prompts

**Session:** Code Mode | Phase 10: Production Bug Fixes
**Date:** 2026-05-17
**Coins Used:** 4 / 4 budget (100%)
**Output:** 4 frontend/config files modified, 4 production bugs fixed
**Trigger:** Production deploy at https://56d21413.atlas-1q0.pages.dev had 4 issues found during verification:
1. 405 Method Not Allowed on POST /api/analyze
2. Response shape mismatch (frontend expected `{layout, cached}`, backend returns raw `AnnotatedLayout`)
3. Footer "View on GitHub" link pointed to github.com homepage
4. Unwanted vertical scroll (one-page design intent violated)

---

## Diagnosis (Claude Code Ultrathink analysis)

| # | Symptom | Root Cause | Fix Location |
|---|---------|------------|--------------|
| 1 | POST /api/analyze → 405 | `_routes.json` `exclude: ["/*"]` broader than `include` → all paths fall to static handler → static handler rejects POST with 405 | `public/_routes.json` |
| 2 | Response shape mismatch (would surface after Fix 1) | Backend returns raw AnnotatedLayout; frontend expected `{layout, cached}` wrapper → `data.layout` undefined → render crash. Cache hit path already returns raw, so inconsistent. | `src/lib/api-client.ts` |
| 3 | Footer link → github.com homepage | `App.tsx:171` `href="https://github.com"` hardcoded | `src/App.tsx` |
| 4 | Page vertical scroll | `min-h-screen` + sticky header + `main py-8` + `CityMap min-h-[80vh]` + `footer mt-16` exceeds viewport ~100px | `src/App.tsx`, `src/components/CityMap.tsx` |

---

## Prompt

Phase 10: Production Bug Fixes

Fix 4 frontend + Cloudflare Functions integration bugs in one pass. Production deploy at https://56d21413.atlas-1q0.pages.dev shows: (1) Analyze button returns 405, (2) footer GitHub link wrong, (3) page has unwanted scroll. Diagnosis complete with precise locations and fixes specified below.

## Fix 1 — public/_routes.json (most critical, 405 root cause)

Current:
{
  "version": 1,
  "include": ["/api/*"],
  "exclude": ["/*"]
}

Root cause: Cloudflare Pages _routes.json applies exclude last. When the exclude pattern is broader than include, all paths (including /api/*) fall through to static asset routing. The static asset handler rejects POST requests with 405 Method Not Allowed.

Fix (empty the exclude array):
{
  "version": 1,
  "include": ["/api/*"],
  "exclude": []
}

## Fix 2 — src/lib/api-client.ts (response shape mismatch, second bug that surfaces after Fix 1)

Current lines 9–12 define an AnalyzeResponse interface:
  export interface AnalyzeResponse {
    layout: AnnotatedLayout;
    cached: boolean;
  }

And lines 70–72:
  const data: AnalyzeResponse = await response.json();
  return data.layout;

Problem: The backend (functions/api/analyze.ts:149–155) returns raw AnnotatedLayout without any wrapper. So data.layout is undefined, causing render crash. Additionally, the cache hit path (api-client.ts:39–41) already returns raw AnnotatedLayout, so the two paths are inconsistent.

Fix (align frontend with backend + cache path):
1. Remove the AnalyzeResponse interface (or leave it unused).
2. Replace lines 70–72 with:
     const data = await response.json();
     console.log(`✓ Analyzed via API: ${owner}/${repo}`);
     return data as AnnotatedLayout;

Important: Do NOT modify the backend (functions/). Keep backend response as-is and align the frontend.

## Fix 3 — src/App.tsx GitHub link (line 171)

Current: href="https://github.com"
Fix: href="https://github.com/chanjoongx/atlas"

## Fix 4 — viewport-fit layout (eliminate scroll)

Root cause: min-h-screen + sticky header + main py-8 + CityMap min-h-[80vh] + footer mt-16 exceeds viewport by ~100px even on 1080p, causing scroll.

Goal: Page fits exactly in viewport (no scroll).
- header: natural height
- main: fills remaining space
- footer: natural height
- empty state (before analysis): input form vertically centered in main
- results state (after analysis): CityMap fills remaining space in main

Changes:

(A) src/App.tsx top-level div (~line 38):
  "min-h-screen bg-slate-950 text-slate-100"
  → "h-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden"

(B) header (~line 40):
  Remove "sticky top-0 z-10". Add flex-shrink-0:
  "flex-shrink-0 border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm"
  Inner py-6 → py-4

(C) main (~line 78):
  "container mx-auto px-4 py-8"
  → "flex-1 flex flex-col min-h-0 container mx-auto px-4 py-4"
  (min-h-0 is critical — prevents flex child from overflowing parent)
  Inner "flex flex-col gap-8" → gap-4

(D) Empty state block (lines 81–94, !layout && !loading):
  Wrap outer with flex for vertical centering:
  <div className="flex-1 flex flex-col items-center justify-center gap-6">
  Remove inner py-12.

(E) Loading state block (~line 132):
  Add centering wrapper:
  {loading && (
    <div className="flex-1 flex items-center justify-center">
      <LoadingState />
    </div>
  )}

(F) Results state block (lines 135–161, layout && !loading):
  Outer div "flex flex-col gap-4"
  → "flex-1 flex flex-col gap-2 min-h-0"

(G) footer (~line 166):
  Remove mt-16. Add flex-shrink-0:
  "flex-shrink-0 border-t border-slate-800"
  Inner py-6 → py-3

(H) src/components/CityMap.tsx (~line 60):
  Container className: remove min-h-[80vh], add flex-1 min-h-0:
  "w-full flex-1 min-h-0 bg-slate-950 rounded-lg overflow-hidden border border-slate-800"
  
  Leave ResizeObserver minimums (lines 30–32) as-is, but verify layout doesn't break on smaller viewports.

## Verification after changes

1. pnpm build passes (tsc + vite build, no errors)
2. pnpm test → 78/78 tests still passing
3. Files changed: public/_routes.json, src/lib/api-client.ts, src/App.tsx, src/components/CityMap.tsx. Do not touch other files.
4. Backend (functions/) MUST remain unchanged.
5. Leave changes in work tree only. User will git commit + push manually.

Save session reports to bob_sessions/10-production-fixes/.

Estimated coin budget: ≤4 coins (4 issues, mostly file-localized changes).

---

## Outcome Summary

- 4 production bugs fixed in one coordinated pass
- Files modified: public/_routes.json, src/lib/api-client.ts, src/App.tsx, src/components/CityMap.tsx
- Backend (functions/) untouched as constrained
- pnpm build: exit 0 (tsc + vite clean)
- pnpm test: 78/78 still passing
- Coin usage: 4/4 (exactly as estimated, 100% efficiency)
- Ready for commit + push → Cloudflare auto-redeploy
