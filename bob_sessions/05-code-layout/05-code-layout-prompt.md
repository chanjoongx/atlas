# 05-code-layout: User Prompts

**Session:** Code Mode | Phase 4: Agent 3 - Layout Engine
**Date:** 2026-05-17
**Coins Used:** ~7-8 (not explicitly reported)
**Coin Budget:** ≤8 coins
**Output:** functions/lib/agents/layout.ts (545 lines), layout.test.ts (520 lines, 17 tests), analyze.ts (chained Agent 3), types.ts (LayoutData exports)
**Complexity:** L (highest)

---

## Prompt

We're now in Code mode for Phase 4: Agent 3 - Layout Engine.

Refer to bob_sessions/01-plan/architecture.md (Agent 3: Layout Engine section) for full spec including input/output contracts (LayoutData, LayoutNode, LayoutEdge, District).

Phase 2 (Ingester) + Phase 3 (Parser) complete. Agent 2 produces CodeStructure. Agent 3 takes that and produces LayoutData ready for D3 rendering on a one-page canvas.

This is the highest-complexity agent (architecture spec: L). The goal: produce ready-to-render layout data for a one-page City Map visualization.

# Task: Implement the Layout Engine agent

Build the Layout Engine at functions/lib/agents/layout.ts.

1. **Function signature**:
   - Input: CodeStructure (from Agent 2) + optional config { canvasWidth?: number (default 1920), canvasHeight?: number (default 1080), maxNodes?: number (default 500) }
   - Output: Promise<LayoutData> { nodes, edges, districts, bounds }
   - Synchronous force simulation logic, typed async for API consistency

2. **Node prioritization** (handle 500-node hard limit per architecture):
   - If total source files ≤ 500: use all source + entry points
   - If > 500: prioritize in this order:
     - All entry points (isEntryPoint: true) — always include
     - Top-N source files by LOC
     - Sample remaining proportionally by directory (keep distribution balanced)
   - Always skip: asset files
   - Skip if over limit: test files (drop first), then docs
   - Output: nodes capped at maxNodes (default 500)

3. **District calculation** (directory grouping → "neighborhoods"):
   - Group nodes by top-level directory (src/, lib/, components/, packages/, etc.)
   - Files in deeper paths roll up to top-level district
   - Root-level files (not in any directory) → district named "root"
   - Assign distinct color per district using d3.scaleOrdinal with d3.schemeTableau10 or schemeCategory10
   - District bounds calculated after node positioning (min/max x/y of contained nodes + padding)

4. **Node sizing** (City Map metaphor: buildings):
   - width: scaled by sqrt(LOC), range [20, 60]px
   - height: scaled by sqrt(LOC), range [20, 100]px
   - Entry points: scale by 1.5x
   - Test files: scale by 0.7x
   - Config/docs: scale by 0.8x
   - Use d3.scaleSqrt for area-correct sizing

5. **Force-directed positioning** (use d3-force from existing d3 dep):
   - forceSimulation with:
     - forceManyBody (repulsion): strength -100
     - forceLink (dependencies): id accessor on node.id, strength: edge.strength, distance: 50
     - forceCenter at canvas center
     - forceCollide (no overlap): radius = max(node.width, node.height) / 2 + 4
     - forceX, forceY toward district anchor positions (clustering)
   - Run simulation synchronously for 300 ticks (.tick() loop, no animation server-side)
   - District anchor positions: pre-computed grid layout based on number of districts

6. **Edge creation**:
   - Each Dependency from CodeStructure → LayoutEdge
   - strength: 1.0 for static imports, 0.5 for dynamic
   - Skip edges where source or target node is not in final selection (after prioritization)

7. **Bounds calculation**:
   - After simulation: compute min/max x/y of all final node positions (including width/height)
   - Pad by 50px
   - If bounds exceed 1920x1080: scale coordinates proportionally to fit (no clipping)
   - Return as { width, height }

8. **Tests** (functions/lib/agents/__tests__/layout.test.ts):
   - vitest with realistic CodeStructure fixtures
   - Test cases:
     - Small repo (50 nodes) — full layout, all visible
     - Large repo (1000 files) — capped at 500, prioritization preserved entry points
     - Empty structure (0 files) — graceful empty layout (bounds 0,0)
     - Single file — degenerate case (centered)
     - Many dependencies (50+ edges) — edges reference valid nodes only
     - Multiple districts — top-level dirs clearly separated
   - Invariants: no NaN positions, all node bounds within canvas, no duplicate node ids, all edge sources/targets are valid node ids

9. **API endpoint update** (functions/api/analyze.ts):
   - Chain: Agent 1 → Agent 2 → Agent 3
   - Return LayoutData (replace previous CodeStructure response)
   - Keep TODO comment for Agent 4 (annotator)
   - Error handling: continue chain only on success

# Constraints

- Strict TypeScript, no `any`
- Use existing d3 dependency: import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide, forceX, forceY } from 'd3-force'; import { scaleSqrt, scaleOrdinal, schemeTableau10 } from 'd3-scale'
- Synchronous simulation (300 ticks, no animation on backend)
- Performance: 500 nodes should layout in <500ms in Workers env
- All magic numbers in named constants (CANVAS_WIDTH=1920, CANVAS_HEIGHT=1080, MAX_NODES=500, FORCE_REPULSION=-100, etc.)
- Estimated coin budget: ≤8 coins (complexity L)

# Deliverables

After this session:
- pnpm test passes (all tests, expect ~65-75 total)
- POST /api/analyze with { owner: "shadcn", repo: "ui" } returns valid LayoutData with positioned nodes
- shadcn/ui test: returns ~300-500 nodes properly positioned without overlap or NaN
- Districts visually separable (different anchor regions)

Generate all files with full content. After done, summarize what was created and any architecture.md deviations.

Save session reports to bob_sessions/05-code-layout/.

---

## Outcome Summary

- 2 files: layout.ts (545 lines), layout.test.ts (520 lines, 17 tests)
- 61/61 total tests passing (15 ingester + 29 parser + 17 layout)
- Performance: <500ms for 500 nodes (target met)
- All node prioritization, district grouping, force simulation working
- Bounds auto-scaling to fit canvas
- 100% architecture compliant, no deviations
- Coin budget ≤8, actual not reported by Bob
