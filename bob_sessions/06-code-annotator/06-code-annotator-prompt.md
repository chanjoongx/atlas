# 06-code-annotator: User Prompts

**Session:** Code Mode | Phase 5: Agent 4 - Annotator
**Date:** 2026-05-17
**Coins Used:** ~4
**Coin Budget:** ≤4 coins
**Output:** functions/lib/agents/annotator.ts (310 lines), annotator.test.ts (754 lines, 17 tests), analyze.ts (full 4-agent pipeline), types.ts (AnnotatedLayout exports)
**Complexity:** S (lowest)

---

## Prompt

We're now in Code mode for Phase 5: Agent 4 - Annotator.

Refer to bob_sessions/01-plan/architecture.md (Agent 4: Annotator section) for full spec including input/output contracts (AnnotatedLayout, Highlight, Label).

Phases 2-4 complete. Agent 3 produces LayoutData with positioned nodes. Agent 4 takes that + CodeStructure context and adds highlights + labels for the City Map visualization.

This is the lowest-complexity agent (architecture spec: S, ~3-4 coins).

# Task: Implement the Annotator agent

Build the Annotator at functions/lib/agents/annotator.ts.

1. **Function signature**:
   - Input: LayoutData (from Agent 3) + CodeStructure (from Agent 2, for centrality calculations on dependencies)
   - Output: Promise<AnnotatedLayout> = LayoutData + highlights[] + labels[]

2. **Centrality calculation** (simple, not PageRank):
   - For each node, compute:
     - inDegree: count of edges where this node is the target (how many files import it)
     - outDegree: count of edges where this node is the source (how many imports it makes)
   - Use existing edges from LayoutData
   - Store as map: nodeId → { inDegree, outDegree }

3. **Highlight calculation** (top important nodes):
   - Always highlight:
     - "entry": all isEntryPoint nodes (use ParsedFile.isEntryPoint from CodeStructure)
   - Add:
     - "core": top 10% nodes by inDegree (excluding entries already highlighted)
     - "hotspot": top 5% nodes by LOC (excluding entries and cores)
   - intensity: normalize centrality/LOC to [0, 1] within each type
   - reason: short human-readable string, e.g.:
     - entry: "Entry point"
     - core: "Imported by 12 files"
     - hotspot: "Largest source file (450 LOC)"
   - Cap total highlights at MAX_HIGHLIGHTS=50

4. **District labels** (one per district):
   - For each district in LayoutData.districts: produce 1 Label
   - Label.text: district.name (truncate to MAX_LABEL_LENGTH=15 if longer)
   - Label.nodeId: use first node id in district as anchor
   - Label.position: 'top' (above the district bounds)

5. **Node labels** (selective, not all nodes):
   - Only label:
     - All entry points
     - Top 10% nodes by LayoutNode.width * height (largest visible buildings)
   - Label.text: file name without extension (basename), truncated to MAX_NODE_LABEL_LENGTH=12 with ellipsis
   - Label.nodeId: the node being labeled
   - Label.position: 'right' default; 'left' if node x > 80% of canvas width; 'top' if node y < 20%

6. **Tests** (functions/lib/agents/__tests__/annotator.test.ts):
   - vitest with LayoutData + CodeStructure fixtures
   - Test cases:
     - Entry points always highlighted (regardless of degree/LOC)
     - Top inDegree nodes get "core" highlight
     - Top LOC nodes get "hotspot" highlight (no overlap with entry/core)
     - District labels: exactly one per district
     - Node labels: only entries + top size, others unlabeled
     - Empty layout: no highlights, no labels (graceful)
     - intensity values are in [0, 1]
     - All Highlight.nodeId and Label.nodeId reference valid layout nodes

7. **API endpoint update** (functions/api/analyze.ts):
   - Final chain: Agent 1 → Agent 2 → Agent 3 → Agent 4
   - Return AnnotatedLayout (full pipeline complete, this is final API response)
   - Remove TODO comments for Agent 4

# Constraints

- Strict TypeScript, no `any`
- Centrality: only inDegree/outDegree counts (no advanced graph algorithms)
- All thresholds in named constants (TOP_CORE_PERCENT=0.1, TOP_HOTSPOT_PERCENT=0.05, MAX_HIGHLIGHTS=50, MAX_LABEL_LENGTH=15, MAX_NODE_LABEL_LENGTH=12)
- Estimated coin budget: ≤4 coins (complexity S)

# Deliverables

After this session:
- pnpm test passes (all tests, expect ~75-80 total)
- POST /api/analyze with { owner: "shadcn", repo: "ui" } returns full AnnotatedLayout
- Entry points clearly highlighted with reason text
- District labels readable, one per district
- Selective node labels (not overwhelming)
- Full pipeline ready for frontend rendering

Generate all files with full content. After done, summarize what was created and any architecture.md deviations.

Save session reports to bob_sessions/06-code-annotator/.

---

## Outcome Summary

- 2 files: annotator.ts (310 lines), annotator.test.ts (754 lines, 17 tests)
- 78/78 total tests passing (15 + 29 + 17 + 17 across 4 agents)
- Centrality: inDegree/outDegree from edges
- Highlights: entry (always) + core (top 10% inDegree) + hotspot (top 5% LOC), max 50 total
- District labels: one per district, position 'top'
- Node labels: entries + top 10% by visual size, adaptive positioning
- Full 4-agent pipeline operational: Ingester → Parser → Layout → Annotator
- 100% architecture compliant, no deviations
- Coin usage: ~4 / 4 budget (on budget)
- Implementation time: ~15 minutes
