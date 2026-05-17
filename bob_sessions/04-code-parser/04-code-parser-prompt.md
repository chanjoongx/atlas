# 04-code-parser: User Prompts

**Session:** Code Mode | Phase 3: Agent 2 - Structure Parser
**Date:** 2026-05-17
**Coins Used:** ~6.0
**Coin Budget:** ≤7 coins
**Output:** functions/lib/agents/parser.ts (502 lines), parser.test.ts (598 lines, 29 tests), analyze.ts (updated to chain Agent 1 → Agent 2), types.ts (re-exports)

---

## Prompt

We're now in Code mode for Phase 3: Agent 2 - Structure Parser.

Refer to bob_sessions/01-plan/architecture.md (Agent 2: Structure Parser section) for full spec including input/output contracts (ParserInput, CodeStructure, ParsedFile, Dependency, RepoMetrics).

Phase 2 (Repo Ingester) is complete and tested. Agent 1 produces RepoManifest with file tree. Agent 2 takes that tree and extracts code structure.

# Task: Implement the Structure Parser agent

Build the Structure Parser at functions/lib/agents/parser.ts.

1. **Function signature**:
   - Input: ParserInput { tree: FileNode[], owner: string, repo: string }
   - Output: Promise<CodeStructure>

2. **File classification** (each FileNode → ParsedFile):
   - Language detection from extension: .ts/.tsx → typescript, .js/.jsx → javascript, .py → python, .rs → rust, .go → go, .java → java, .cpp/.cc → cpp, .rb → ruby, .php → php, .swift → swift, .kt → kotlin, .md → markdown. Default: "unknown"
   - Type classification:
     - "test": path contains __tests__/, .test., .spec.
     - "config": package.json, tsconfig*.json, *.config.{js,ts,mjs}, .eslintrc*, .prettierrc*, vite.config.*, webpack.config.*, .env*, Dockerfile, etc.
     - "docs": *.md, *.rst, *.txt in docs/, README*, LICENSE*, CHANGELOG*
     - "asset": in public/, assets/, static/, images/, fonts/
     - "source": everything else (default)

3. **LOC estimation** (from file size, no content fetch for non-entry files):
   - Rough estimate: max(size / 35, 1) lines (35 bytes/line avg)
   - For entry points (where we fetch content), use actual line count from content

4. **Entry point detection**:
   - package.json's "main" and "exports" fields (fetch this file's content)
   - Common entry files (mark isEntryPoint: true): src/index.{ts,tsx,js,jsx}, src/main.{ts,tsx,js,jsx}, src/App.{tsx,jsx}, app/page.{tsx,jsx}, pages/index.{tsx,jsx}

5. **Imports/dependencies extraction**:
   - MVP scope: Only fetch content of TOP-LEVEL source files (src/index.*, src/main.*, package.json) + entry points. This is critical to avoid Workers timeout.
   - For other files: leave imports array empty (out of MVP scope)
   - When fetching: use GitHub blob API (octokit.git.getBlob with file SHA from manifest tree), decode base64
   - Regex patterns for TypeScript/JavaScript:
     - `import\s+.*?\s+from\s+['"]([^'"]+)['"]`
     - `import\s*\(\s*['"]([^'"]+)['"]\s*\)` (dynamic)
     - `require\s*\(\s*['"]([^'"]+)['"]\s*\)` (commonjs)
   - Resolve relative imports (./*, ../*) to absolute paths within repo
   - External packages (bare specifiers like "react", "lodash") → filter out (only intra-repo edges matter for visualization)

6. **Metrics calculation** (RepoMetrics):
   - totalFiles: count of all non-asset files
   - totalLOC: sum of all estimated LOC
   - languageBreakdown: { typescript: totalLocOfTsFiles, ... }
   - directoryDepth: max depth of any file path

7. **Tests** (functions/lib/agents/__tests__/parser.test.ts):
   - Use vitest with mocked GitHub blob fetches
   - Test cases: language detection (all extensions), type classification (each category), entry point detection (multiple patterns), import extraction (TS/JS regex), relative path resolution, metrics calculation
   - Edge cases: empty tree, single file, deeply nested files, binary files filtered, unknown extensions

8. **API endpoint update** (functions/api/analyze.ts):
   - Chain Agent 1 → Agent 2: ingester returns manifest, pass tree to parser
   - Return CodeStructure (replace previous RepoManifest response)
   - Keep TODO comments for Agent 3 and 4
   - Error handling: if Agent 1 fails, return early. If Agent 2 fails on individual file content fetch, log and continue (partial result better than no result)

# Constraints

- Strict TypeScript, no `any`
- Imports extraction limited to entry points + top-level source files (performance + Workers timeout safety)
- All file extensions/patterns in exported constant arrays (LANGUAGE_MAP, ENTRY_POINT_PATTERNS, TEST_PATTERNS, CONFIG_PATTERNS, ASSET_PATTERNS, DOC_PATTERNS)
- Estimated coin budget: ≤7 coins (complexity M per architecture)

# Deliverables

After this session:
- pnpm test passes (all tests including new parser tests, expect 25-30 tests total)
- POST /api/analyze with { owner: "shadcn", repo: "ui" } returns valid CodeStructure
- File types properly classified (source/test/config/docs/asset)
- Top-level imports extracted as Dependency edges
- Metrics aggregated correctly

Generate all files with full content. After done, summarize what was created and any architecture.md deviations.

Save session reports to bob_sessions/04-code-parser/.

---

## Outcome Summary

- 4 files: parser.ts (502 lines), parser.test.ts (598 lines, 29 tests), analyze.ts (updated), types.ts (re-exports)
- 44/44 total tests passing (15 ingester + 29 parser)
- 15+ languages detected via extension mapping
- 5 file types classified
- Import extraction with relative path resolution
- Selective content fetching (entry points + top-level source only)
- 100% architecture compliant, no deviations
- Coin usage: ~6.0 / 7 budget (86% efficiency)
