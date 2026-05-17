# Phase 10: Production Bug Fixes — Session Summary

**Date:** 2026-05-17  
**Status:** ✅ Complete  
**Coins Used:** 4/4 (100% efficiency)

## Overview
Fixed 4 critical production bugs affecting the deployed application at https://56d21413.atlas-1q0.pages.dev in a single coordinated pass. All fixes applied successfully with build and tests passing.

## Bugs Fixed

### 1. 405 Method Not Allowed on /api/analyze ⚠️ CRITICAL
**File:** `public/_routes.json`  
**Root Cause:** Cloudflare Pages _routes.json applies exclude patterns last. The broad `"/*"` exclude pattern overrode the `"/api/*"` include, causing all paths (including API routes) to fall through to static asset routing, which rejects POST requests with 405.

**Fix:** Emptied the exclude array to allow API routes to be handled by Cloudflare Functions:
```json
{
  "version": 1,
  "include": ["/api/*"],
  "exclude": []
}
```

### 2. Response Shape Mismatch (data.layout undefined)
**File:** `src/lib/api-client.ts` (lines 70-72)  
**Root Cause:** Frontend expected wrapped response `{ layout: AnnotatedLayout, cached: boolean }` but backend (functions/api/analyze.ts:149-155) returns raw `AnnotatedLayout`. This caused `data.layout` to be undefined, crashing the render. Additionally, the cache hit path already returned raw `AnnotatedLayout`, creating inconsistency.

**Fix:** Aligned frontend with backend response format:
```typescript
// Before
const data: AnalyzeResponse = await response.json();
return data.layout;

// After
const data = await response.json();
console.log(`✓ Analyzed via API: ${owner}/${repo}`);
return data as AnnotatedLayout;
```

### 3. Incorrect GitHub Link
**File:** `src/App.tsx` (line 171)  
**Root Cause:** Footer link pointed to generic `https://github.com` instead of project repository.

**Fix:** Updated to correct repository URL:
```tsx
href="https://github.com/chanjoongx/atlas"
```

### 4. Unwanted Page Scroll (Viewport Overflow)
**Files:** `src/App.tsx`, `src/components/CityMap.tsx`  
**Root Cause:** `min-h-screen` + sticky header + padding + `min-h-[80vh]` CityMap exceeded viewport by ~100px, causing scroll even on 1080p displays.

**Fix:** Implemented flexbox viewport-fit layout:

**App.tsx changes:**
- Root div: `h-screen flex flex-col overflow-hidden` (replaces `min-h-screen`)
- Header: `flex-shrink-0`, removed `sticky top-0 z-10`, `py-6` → `py-4`
- Main: `flex-1 flex flex-col min-h-0`, `py-8` → `py-4`, `gap-8` → `gap-4`
- Empty state: Wrapped with `flex-1 flex flex-col items-center justify-center` for vertical centering
- Loading state: Wrapped with `flex-1 flex items-center justify-center`
- Results state: `flex-1 flex flex-col gap-2 min-h-0`
- Footer: `flex-shrink-0`, removed `mt-16`, `py-6` → `py-3`

**CityMap.tsx changes:**
- Container: `flex-1 min-h-0` (replaces `min-h-[80vh]`)
- ResizeObserver minimums (800×600) kept as-is for safety

**Result:** Page now fits exactly in viewport with no scroll. Empty state centers vertically, results state fills available space.

## Files Modified
1. `public/_routes.json` — Fixed Cloudflare routing (405 error)
2. `src/lib/api-client.ts` — Aligned response handling with backend
3. `src/App.tsx` — Fixed GitHub link + viewport-fit layout
4. `src/components/CityMap.tsx` — Flex layout for proper sizing

## Verification
✅ `pnpm build` — Passes (tsc + vite build, no errors)  
✅ `pnpm test` — 78/78 tests passing  
✅ Backend unchanged (functions/ directory untouched as required)  
✅ Changes left in work tree for manual commit

## Technical Notes

### Cloudflare Pages Routing Behavior
The _routes.json configuration is processed with **include patterns first, then exclude patterns**. When exclude is broader than include, it effectively negates the include. The fix (empty exclude array) allows all non-API paths to fall through to static assets while API paths are handled by Functions.

### Flexbox Viewport-Fit Pattern
The key to eliminating scroll:
1. Root container: `h-screen flex flex-col overflow-hidden`
2. Header/Footer: `flex-shrink-0` (natural height)
3. Main: `flex-1 min-h-0` (fills remaining space, min-h-0 prevents overflow)
4. Nested flex children: Also use `flex-1 min-h-0` to properly constrain

The `min-h-0` is critical — without it, flex children can overflow their parent.

### Response Shape Alignment
Rather than modifying the backend to wrap responses, we aligned the frontend to match the backend's existing behavior. This is safer for production and maintains consistency with the cache path which already returned raw `AnnotatedLayout`.

## Impact
- **Fix 1:** Resolves 405 errors, enables API functionality
- **Fix 2:** Prevents render crashes after successful API calls
- **Fix 3:** Correct attribution and navigation
- **Fix 4:** Professional UX with no unwanted scroll

All fixes are production-ready and maintain backward compatibility with existing tests.

---
*Made with Bob*