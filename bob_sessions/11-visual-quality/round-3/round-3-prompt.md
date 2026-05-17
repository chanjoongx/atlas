# 11-visual-quality / Round 3: PNG Export Fix

**Session:** Code Mode | Phase 11 follow-up Round 3 (continuing same task)
**Date:** 2026-05-17
**Output:** 1 file modified, 1 export bug fixed
**Trigger:** Round 2 verification on shadcn/ui showed PNG export captured user's current zoom/pan state instead of the full visualization. Zooming in or panning before clicking Export produced a cropped/translated PNG.

---

## Diagnosis (Claude Code analysis)

| # | Severity | Symptom | Root Cause | Fix Location |
|---|----------|---------|------------|--------------|
| 1 | HIGH | PNG capture follows user's zoom/pan | `png-export.ts` serializes live `svgElement`. The SVG's `<g class="main-group">` carries the d3.zoom transform attribute, which gets baked into the serialization and applied to the rendered PNG. | `src/lib/png-export.ts:14-16` |

Solution philosophy: clone the SVG before serializing, strip the transform from the clone only. Live element stays untouched so the user's on-screen view doesn't shift after export.

---

## Prompt

Phase 11 follow-up Round 3: PNG export fix (continuing this task)

Save session reports to bob_sessions/11-visual-quality/round-3/.

Verification:
- pnpm build → exit 0
- pnpm test → 78/78 still passing
- Files touched: src/lib/png-export.ts only

---

Atlas PNG export bug fix. Single file change.

Symptom:
Clicking "Export as PNG" captures the user's current zoom/pan state. If the user zoomed in or panned, the cropped view is what gets saved. Intended behavior: PNG always shows the full visualization regardless of user's current view.

Root cause:
src/lib/png-export.ts serializes svgElement directly. The SVG contains <g class="main-group"> whose transform attribute is constantly updated by d3.zoom. That transform is included in the serialization and applied to the PNG, producing the cropped/translated output.

Fix:
Clone the SVG, strip the main-group transform from the clone only, then serialize the clone. Don't mutate the live element so the user's screen stays as-is.

==============================
Modification — src/lib/png-export.ts (lines 1-22)
==============================

Replace lines 8-17 with:

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

    const serializer = new XMLSerializer();
    let svgString = serializer.serializeToString(clone);

The rest of the file (lines 18-88) stays unchanged. Only the source of svgString switches from svgElement to clone.

==============================
Summary
==============================

- svgElement.cloneNode(true) creates a deep clone
- Remove transform attribute on the clone's .main-group (invalidates user's zoom/pan)
- Serialize the clone for PNG generation
- Live SVG element untouched, so user's on-screen view is preserved

==============================
Post-work checklist
==============================

1. pnpm build passes.
2. Files changed: src/lib/png-export.ts only. Don't touch other files.
3. Expected results:
   - Default view + Export → full visualization PNG
   - Zoom-in state + Export → full visualization PNG (current view ignored)
   - Pan state + Export → full visualization PNG (offset ignored)
   - After Export, the on-screen zoom/pan state stays as-is (live SVG unaffected)
4. Leave changes in work tree only. User will git commit + push manually.

---

## Outcome Summary

- 1 export bug fixed
- File modified: src/lib/png-export.ts only
- pnpm build: exit 0
- pnpm test: 78/78 still passing
- Verified on production: PNG export now captures full visualization regardless of zoom/pan state
- Closes Phase 11 (Rounds 1+2+3 = 11 total fixes across the visualization stack)
