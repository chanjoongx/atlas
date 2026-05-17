# Phase 11 Round 2: Layout Coherence + Zoom Polish - Session Summary

**Date:** 2026-05-17  
**Status:** ✅ Complete  
**Continuation of:** Phase 11 Round 1 (6 fixes)

## Objective

Apply 4 frontend-only fixes to resolve layout coherence issues and add zoom UI discovered after Round 1 deployment.

## Issues Fixed

### Fix 1: Recompute district bounds from actual node positions (CRITICAL)
**File:** `src/lib/d3-renderer.ts` (lines 146-186)  
**Problem:** District background rectangles didn't match node positions - large empty rectangles beside node clusters  
**Root Cause:** Backend sends pre-scale bounds while nodes have post-scale coordinates (coordinate system mismatch)  
**Solution:**
- Compute bounds directly from actual node positions in the frontend
- Use `flatMap` to get all node edges (x ± width/2, y ± height/2)
- Add 24px padding around computed bounds
- Convert to screen coordinates with `tx()`/`ty()` transforms
- Skip empty districts entirely

**Key Code:**
```typescript
const districtNodes = district.nodes
  .map((id) => nodeMap.get(id))
  .filter((n): n is NodeWithDistrict => n !== undefined);

const xs = districtNodes.flatMap((n) => [n.x - n.width / 2, n.x + n.width / 2]);
const ys = districtNodes.flatMap((n) => [n.y - n.height / 2, n.y + n.height / 2]);
const dMinX = Math.min(...xs);
const dMaxX = Math.max(...xs);
```

### Fix 2: Expose zoom API + 0.9 initial fit (HIGH)
**File:** `src/lib/d3-renderer.ts` (lines 28-35, 318-332)  
**Problem:** No zoom UI, initial view too tight (content fills viewport with no breathing room)  
**Solution:**
- Export `CityMapHandle` interface with `zoomIn()`, `zoomOut()`, `reset()` methods
- Change return type from `void` to `CityMapHandle`
- Initial transform at 0.9 scale (10% breathing room)
- Extended scale extent to [0.2, 8] for wider zoom range
- Smooth transitions (250ms for zoom, 400ms for reset)

**Key Code:**
```typescript
export interface CityMapHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}

const initialTransform = d3.zoomIdentity
  .translate(width / 2, height / 2)
  .scale(0.9)
  .translate(-width / 2, -height / 2);

return {
  zoomIn: () => svg.transition().duration(250).call(zoom.scaleBy as any, 1.4),
  zoomOut: () => svg.transition().duration(250).call(zoom.scaleBy as any, 1 / 1.4),
  reset: () => svg.transition().duration(400).call(zoom.transform as any, initialTransform),
};
```

### Fix 3: Full CityMap.tsx replacement with zoom controls (HIGH)
**File:** `src/components/CityMap.tsx` (full replacement, 115 lines)  
**Problem:** No visible zoom UI - users can't discover zoom/pan capability  
**Solution:**
- Import `CityMapHandle` type from d3-renderer
- Store handle in `handleRef` from `renderCityMap()` return value
- Add `relative` positioning to container div
- 3-button zoom panel in top-right corner (absolute positioning)
- Buttons: Zoom In (+), Zoom Out (−), Reset (expand arrows)
- Styling: slate-900/80 background, backdrop-blur, hover states

**UI Design:**
- Top-right corner placement (doesn't obscure content)
- Semi-transparent background with backdrop blur
- SVG icons for clarity
- Hover effects for interactivity feedback
- Divider line between zoom and reset buttons

### Fix 4: Disambiguate duplicate labels (MEDIUM)
**File:** `src/lib/d3-renderer.ts` (lines 289-316)  
**Problem:** Next.js-style repos show duplicate labels stacked ("index index index", "page page")  
**Solution:**
- Count occurrences of each label text
- If text appears >1 time, prefix with parent directory name
- Extract parent from `node.metadata.path.split('/')` (second-to-last element)
- Display as "parent/filename" (e.g., "dashboard/index" instead of "index")

**Key Code:**
```typescript
const labelTextCount = new Map<string, number>();
filteredLabels.forEach((l) => {
  labelTextCount.set(l.text, (labelTextCount.get(l.text) || 0) + 1);
});

let displayText = label.text;
if ((labelTextCount.get(label.text) || 0) > 1) {
  const pathParts = node.metadata.path.split('/');
  if (pathParts.length >= 2) {
    const parent = pathParts[pathParts.length - 2];
    displayText = `${parent}/${label.text}`;
  }
}
```

## Files Modified

1. **src/lib/d3-renderer.ts** (3 fixes)
   - Lines 28-35: Added `CityMapHandle` interface export, changed return type
   - Lines 146-186: Recomputed district bounds from actual nodes
   - Lines 289-316: Added label deduplication logic
   - Lines 318-332: Added zoom API return + 0.9 initial transform

2. **src/components/CityMap.tsx** (1 fix)
   - Full replacement (115 lines)
   - Added `handleRef` to store zoom API
   - Added 3-button zoom control panel UI
   - Container now has `relative` positioning

## Verification Results

✅ **Build:** `pnpm build` - Success (tsc + vite, no errors)  
✅ **Tests:** `pnpm vitest run` - 78/78 passing  
✅ **Files Changed:** 2 files only (d3-renderer.ts + CityMap.tsx)  
✅ **Backend:** No changes to functions/ directory

## Expected Visual Improvements

After deployment, demo repos should show:

1. **District rectangles match node positions** - No more empty rectangles, nodes always inside their district bounds
2. **Visible zoom controls** - 3-button panel in top-right corner (discoverable UI)
3. **Breathing room** - Initial 0.9 scale provides 10% margin around content
4. **Unique labels** - Duplicate filenames show as "parent/filename" (e.g., "app/page" vs "dashboard/page")

## Technical Notes

- **Coordinate system fix:** Frontend now computes bounds from post-transform node positions, bypassing backend coordinate mismatch
- **Zoom factor:** 1.4x per click provides smooth, predictable zoom steps
- **Label disambiguation:** Only applies when duplicates exist, preserves simple names when unique
- **UI positioning:** Absolute positioning with z-10 ensures controls stay above SVG content
- **Transition timing:** 250ms for zoom feels responsive, 400ms for reset allows user to track movement

## Round 1 vs Round 2 Summary

**Round 1 (6 fixes):**
- Node sizing (LOC-based)
- Uniform scale + aspect ratio
- Initial viewport fit
- District visibility
- Label filtering
- Node prioritization

**Round 2 (4 fixes):**
- District bounds coherence
- Zoom API + UI
- Initial breathing room
- Label deduplication

**Total:** 10 fixes across 2 rounds, 3 files modified (d3-renderer.ts, CityMap.tsx, layout.ts)

---

**Session completed successfully. All Round 2 fixes applied, verified, and documented.**