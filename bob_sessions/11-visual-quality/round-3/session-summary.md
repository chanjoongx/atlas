# Phase 11 Round 3: PNG Export Fix - Session Summary

**Date:** 2026-05-17  
**Status:** ✅ Complete  
**Continuation of:** Phase 11 Round 1 (6 fixes) + Round 2 (4 fixes)

## Objective

Fix PNG export bug where user's current zoom/pan state was captured instead of the full visualization.

## Issue Fixed

### PNG Export Captures Zoom/Pan State (CRITICAL)
**File:** `src/lib/png-export.ts` (lines 8-17)  
**Problem:** Clicking "Export as PNG" captured the user's current zoom/pan state. If zoomed in or panned, the cropped/translated view was saved instead of the full visualization.

**Root Cause:**  
The export function serialized `svgElement` directly. The SVG contains `<g class="main-group">` whose `transform` attribute is constantly updated by `d3.zoom()`. That transform was included in the serialization and applied to the PNG output.

**Solution:**
1. Clone the SVG element using `cloneNode(true)` for deep copy
2. Find `.main-group` in the clone
3. Remove the `transform` attribute from the clone only
4. Serialize the clone instead of the live element
5. Live SVG element remains untouched (user's on-screen view preserved)

**Code Change:**
```typescript
// Before (lines 8-16):
try {
  const bbox = svgElement.getBoundingClientRect();
  const width = bbox.width;
  const height = bbox.height;

  const serializer = new XMLSerializer();
  let svgString = serializer.serializeToString(svgElement);

// After (lines 8-23):
try {
  const bbox = svgElement.getBoundingClientRect();
  const width = bbox.width;
  const height = bbox.height;

  // Clone SVG and reset zoom transform so PNG shows full content
  // (don't mutate the live element so user's on-screen view stays as-is)
  const clone = svgElement.cloneNode(true) as SVGSVGElement;
  const mainGroup = clone.querySelector('.main-group');
  if (mainGroup) {
    mainGroup.removeAttribute('transform');
  }

  // Serialize cloned SVG to string
  const serializer = new XMLSerializer();
  let svgString = serializer.serializeToString(clone);
```

## File Modified

**src/lib/png-export.ts** (1 fix)
- Lines 8-17 replaced with lines 8-23
- Added SVG cloning logic
- Added transform removal from clone
- Changed serialization source from `svgElement` to `clone`
- Rest of file (lines 18-88) unchanged

## Verification Results

✅ **Build:** `pnpm build` - Success (tsc + vite, no errors)  
✅ **Files Changed:** `src/lib/png-export.ts` only  
✅ **No test changes needed** (export is UI-triggered, not unit tested)

## Expected Behavior After Fix

### Before Fix:
- Default view + Export → Full visualization PNG ✅
- Zoom-in state + Export → Cropped PNG (zoomed portion only) ❌
- Pan state + Export → Offset PNG (translated view) ❌
- After Export → On-screen view unchanged ✅

### After Fix:
- Default view + Export → Full visualization PNG ✅
- Zoom-in state + Export → Full visualization PNG ✅ (zoom ignored)
- Pan state + Export → Full visualization PNG ✅ (pan ignored)
- After Export → On-screen view unchanged ✅ (live SVG untouched)

## Technical Notes

- **Deep clone:** `cloneNode(true)` creates a complete copy including all child elements and attributes
- **Non-destructive:** Live SVG element is never mutated, so user's on-screen zoom/pan state remains intact
- **Selector safety:** `querySelector('.main-group')` returns null if not found, `if` guard prevents errors
- **Transform removal:** Only the clone's transform is removed, not the original's
- **Serialization:** XMLSerializer converts the modified clone to string for PNG generation

## Why This Approach Works

The d3.zoom behavior continuously updates the `transform` attribute on `.main-group` to reflect user interactions:
- Zoom in: `transform="translate(x,y) scale(s)"` where s > 1
- Pan: `transform="translate(x,y)"` where x,y ≠ 0

By cloning first and removing the transform from the clone, we get:
1. A snapshot of the SVG structure without zoom/pan state
2. The original element's transform intact (user sees no change)
3. PNG export shows the full, unzoomed, unshifted visualization

## Round Summary

**Round 1 (6 fixes):** Node sizing, uniform scale, viewport fit, district visibility, label filtering, node prioritization  
**Round 2 (4 fixes):** District bounds coherence, zoom API + UI, breathing room, label deduplication  
**Round 3 (1 fix):** PNG export ignores zoom/pan state

**Total:** 11 fixes across 3 rounds, 4 files modified (d3-renderer.ts, CityMap.tsx, layout.ts, png-export.ts)

---

**Session completed successfully. PNG export fix applied, verified, and documented.**