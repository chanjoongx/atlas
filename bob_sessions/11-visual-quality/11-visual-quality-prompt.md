# 11-visual-quality: User Prompts

**Session:** Code Mode | Phase 11: City Map Visualization Polish
**Date:** 2026-05-17
**Coins Used:** TBD (≤8 budget)
**Output:** 2 files modified (1 frontend renderer + 1 backend layout agent), 6 visual quality issues fixed
**Trigger:** Phase 10 deploy succeeded, but production visualization on real demo (shadcn/ui) had visible problems:
- Nodes clustered to one side, half the canvas empty
- All nodes looked identical (no LOC-based size variation)
- Districts barely visible (12% opacity on dark background)
- Labels collide and overlap (50+ labels for 500 files)
- Wrong files prioritized (examples/legacy displaced core components)
- No initial fit-to-viewport (user had to manually pan/zoom)

---

## Diagnosis (Claude Code Ultrathink analysis)

| # | Severity | Symptom | Root Cause | Fix Location |
|---|----------|---------|------------|--------------|
| 1 | CRITICAL | All nodes look identical (12px) | `d3-renderer.ts:186` hardcodes `const size = 12` ignoring `node.width/height` from layout engine | `src/lib/d3-renderer.ts:180-199` |
| 2 | CRITICAL | Cluster pushed to one side | X and Y scaled independently → aspect ratio distortion on non-square viewport | `src/lib/d3-renderer.ts:116-132` |
| 3 | CRITICAL | First load shows broken layout | No initial zoom transform → user must manually pan/zoom | `src/lib/d3-renderer.ts:291-299` |
| 4 | HIGH | Districts invisible | `DISTRICT_OPACITY = 0.12` on near-black background; no border; district labels misplaced | `src/lib/d3-renderer.ts` (constants + render) |
| 5 | HIGH | Labels overlap unreadably | All `layout.labels` rendered (50+ for shadcn/ui); no readability stroke | `src/lib/d3-renderer.ts:251-289` |
| 6 | MEDIUM | Examples shown instead of core components | `prioritizeFiles` sorts by LOC only → examples win over short core components like `button.tsx` | `functions/lib/agents/layout.ts:167-239,399-404` |

---

## Prompt

Phase 11: City Map Visualization Polish

Atlas City Map visualization needs refinement to demo-ready quality. Code analysis complete. 6 issues identified across 2 files (1 frontend renderer + 1 backend layout agent). Pipeline structure unchanged.

# Background

After Phase 10 deploy, production visualization has visible problems on real demo (shadcn/ui):
- Nodes clustered in one corner, half the canvas empty
- All nodes look identical (no LOC-based size differentiation)
- Districts not visually distinct
- Labels collide and become unreadable
- Wrong files prioritized (examples/legacy instead of core components)

Root cause analysis below specifies exact fixes per issue with code locations.

# Fix 1 - src/lib/d3-renderer.ts: Use node.width/height (CRITICAL)

Location: lines 180-199 (enrichedNodes.forEach block).

Currently the renderer hardcodes 12px square per node, throwing away node.width/height that the layout engine computes from LOC (range 20-100px). All nodes look identical as a result.

Replace the `size` constant with direct use of node.width/height, multiplied by the uniform scale (defined in Fix 2). For isEntry nodes, multiply by ENTRY_NODE_SCALE (1.5):

const nodeWidth = (isEntry ? node.width * ENTRY_NODE_SCALE : node.width) * scale;
const nodeHeight = (isEntry ? node.height * ENTRY_NODE_SCALE : node.height) * scale;

const nodeEl = nodeGroup
  .append('rect')
  .attr('x', tx(node.x) - nodeWidth / 2)
  .attr('y', ty(node.y) - nodeHeight / 2)
  .attr('width', nodeWidth)
  .attr('height', nodeHeight)
  .attr('rx', NODE_RADIUS)
  .attr('fill', d3.color(color)?.copy({opacity: saturation}).toString() || color)
  .attr('class', 'node')
  .style('cursor', 'pointer');

Apply same pattern to the isHotspot block (lines 217-227): use nodeWidth + 4, nodeHeight + 4 for the hotspot ring instead of size + 4.

# Fix 2 - src/lib/d3-renderer.ts: Uniform scale + aspect ratio preservation (CRITICAL)

Location: lines 116-132 (bounds calculation + xScale/yScale definition).

Currently X and Y are scaled independently. When viewport isn't square (browser viewport with header/footer is wider than tall), the layout gets stretched horizontally and content clusters to one side, leaving the other half empty.

Replace with single uniform scale + centering offsets:

const allX = layout.nodes.map((n) => n.x);
const allY = layout.nodes.map((n) => n.y);
const minX = Math.min(...allX);
const maxX = Math.max(...allX);
const minY = Math.min(...allY);
const maxY = Math.max(...allY);

const layoutWidth = maxX - minX || 1;
const layoutHeight = maxY - minY || 1;

const padding = 60;
const availableWidth = width - padding * 2;
const availableHeight = height - padding * 2;

const scale = Math.min(
  availableWidth / layoutWidth,
  availableHeight / layoutHeight
);

const offsetX = (width - layoutWidth * scale) / 2;
const offsetY = (height - layoutHeight * scale) / 2;

const tx = (x: number) => (x - minX) * scale + offsetX;
const ty = (y: number) => (y - minY) * scale + offsetY;

Then everywhere in the file: xScale(value) → tx(value), yScale(value) → ty(value). Size values (node.width, district bounds.width, etc.) get multiplied by `scale`.

Affected sections:
- Districts rendering (lines 140-148): rect width = bounds.width * scale, height = bounds.height * scale, x = tx(bounds.x), y = ty(bounds.y)
- Edges (lines 167-175): source/target coordinates use tx/ty
- Nodes (lines 190-227): coordinates use tx/ty, sizes multiplied by scale (per Fix 1)
- Labels (lines 258-289): position uses tx/ty

# Fix 3 - src/lib/d3-renderer.ts: Initial fit-to-viewport (CRITICAL)

Location: lines 291-299 (zoom setup).

Currently only the zoom instance is registered with no initial transform. User has to manually drag/zoom on first load.

const zoom = d3.zoom<SVGSVGElement, unknown>()
  .scaleExtent([0.3, 5])
  .on('zoom', (event) => {
    g.attr('transform', event.transform);
  });

svg.call(zoom as any);

// Initial transform: identity (tx/ty already centers content correctly)
svg.call(zoom.transform as any, d3.zoomIdentity);

// Disable double-click zoom (prevent accidental jumps during demo)
svg.on('dblclick.zoom', null);

# Fix 4 - src/lib/d3-renderer.ts: District visibility (HIGH)

(a) Constants (~lines 5-11):
- Change DISTRICT_OPACITY from 0.12 to 0.28
- Add: const DISTRICT_STROKE_OPACITY = 0.6;
- Replace color palette (line 4) with higher-contrast palette for dark background:
  const COLORS = [
    '#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#a78bfa',
    '#22d3ee', '#fb923c', '#4ade80', '#f87171', '#c084fc'
  ];

(b) District rect rendering (lines 134-149) - add dashed border:

districtGroup
  .append('rect')
  .attr('x', tx(bounds.x))
  .attr('y', ty(bounds.y))
  .attr('width', bounds.width * scale)
  .attr('height', bounds.height * scale)
  .attr('fill', color)
  .attr('opacity', DISTRICT_OPACITY)
  .attr('stroke', color)
  .attr('stroke-opacity', DISTRICT_STROKE_OPACITY)
  .attr('stroke-width', 1.5)
  .attr('stroke-dasharray', '4 4')
  .attr('rx', 12);

(c) Add district labels as a separate group right after district rects:

const districtLabelGroup = g.append('g').attr('class', 'district-labels');
layout.districts.forEach((district) => {
  const color = districtColorMap.get(district.name) || '#888';
  const bounds = district.bounds;
  const centerX = tx(bounds.x + bounds.width / 2);
  const centerY = ty(bounds.y) - 8;

  districtLabelGroup
    .append('text')
    .attr('x', centerX)
    .attr('y', centerY)
    .attr('text-anchor', 'middle')
    .attr('fill', color)
    .attr('font-size', '13px')
    .attr('font-weight', '700')
    .attr('letter-spacing', '0.05em')
    .style('text-shadow', '0 1px 3px rgba(0,0,0,0.8)')
    .text(district.name.toUpperCase());
});

# Fix 5 - src/lib/d3-renderer.ts: Label policy change (HIGH)

Location: lines 251-289 (labels rendering block).

Currently renders all layout.labels including district labels (now handled separately in Fix 4). For shadcn/ui this means 50+ overlapping labels and total unreadability.

New policy:
- Skip district labels (handled in Fix 4 already).
- Show node labels only for highlighted nodes (entry, core, hotspot).
- Cap at 25 labels total.
- Use paint-order stroke for readability against any background.

const highlightedNodeIds = new Set(layout.highlights.map(h => h.nodeId));
const filteredLabels = layout.labels
  .filter(label => highlightedNodeIds.has(label.nodeId))
  .slice(0, 25);

const labelGroup = g.append('g').attr('class', 'labels');
filteredLabels.forEach((label) => {
  const node = nodeMap.get(label.nodeId);
  if (!node) return;

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
    .text(label.text);
});

# Fix 6 - functions/lib/agents/layout.ts: Node prioritization (MEDIUM)

Location: lines 167-239 (prioritizeFiles function) + lines 399-404 (force strengths).

Currently sortedSource is sorted by LOC descending. For libraries like shadcn/ui, LOC-heavy files are typically examples/legacy/migration, which displace actual core components from the displayed set. So "button-example" appears but the actual "button" component is filtered out.

(a) In prioritizeFiles, replace:
const sortedSource = [...sourceFiles].sort((a, b) => b.loc - a.loc);

With scoring function + sort:

function scoreFile(file: ParsedFile): number {
  let score = Math.sqrt(file.loc);  // Dampen LOC influence

  const path = file.path.toLowerCase();
  // Penalties
  if (path.includes('example') || path.includes('examples/')) score -= 50;
  if (path.includes('test') || path.includes('spec')) score -= 30;
  if (path.includes('fixture') || path.includes('mock')) score -= 30;
  if (path.includes('__')) score -= 20;
  if (path.includes('legacy') || path.includes('deprecated')) score -= 40;

  // Bonus: short filename (likely core component)
  const fileName = path.split('/').pop() || '';
  if (fileName.length < 15) score += 10;

  // Bonus: shallow path (top-level)
  const depth = file.path.split('/').length;
  if (depth <= 3) score += 15;

  return score;
}

const sortedSource = [...sourceFiles].sort((a, b) => scoreFile(b) - scoreFile(a));

(b) Force strengths (lines 399-404) - tighten district clustering:

.force('x', forceX<SimNode>()
  .x(d => districtAnchors.get(d.district)?.x ?? canvasWidth / 2)
  .strength(0.25))   // was 0.1
.force('y', forceY<SimNode>()
  .y(d => districtAnchors.get(d.district)?.y ?? canvasHeight / 2)
  .strength(0.25))   // was 0.1

# Verification

1. pnpm build passes (tsc + vite, no errors)
2. pnpm test → 78/78 still passing
3. Files changed: src/lib/d3-renderer.ts, functions/lib/agents/layout.ts. No other files touched.
4. Leave changes in work tree only. User will git commit + push manually.

# Expected visual outcome after deploy

Demo repos (shadcn/ui, hono, drizzle-orm) should show:
- Layout fills the canvas evenly (no empty half)
- Visible node size variation (LOC-based, 20-100px range)
- District color tints with dashed borders, district names in uppercase at the top
- Clean labels on ~25 highlighted nodes only, readable against any background via paint-order stroke
- Core components surface (button, input, card) instead of examples/legacy
- Initial view fits viewport without requiring user pan/zoom

Save session reports to bob_sessions/11-visual-quality/.

Estimated coin budget: ≤8 coins (6 issues, mostly single-file changes with some complexity in coordinate transformation).

---

## Outcome Summary

- 6 visual quality issues fixed in one coordinated pass
- Files modified: src/lib/d3-renderer.ts (Fixes 1-5), functions/lib/agents/layout.ts (Fix 6)
- pnpm build: exit 0 (tsc + vite clean)
- pnpm test: 78/78 still passing
- No pipeline structure changes
- Ready for commit + push → Cloudflare auto-redeploy
- Coin usage: TBD (≤8 budget)
