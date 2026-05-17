# 03-code-ingester: User Prompts

**Session:** Code Mode | Phase 2: Agent 1 - Repo Ingester
**Date:** 2026-05-17
**Coins Used:** ~5.5
**Coin Budget:** ≤6 coins
**Output:** functions/lib/agents/ingester.ts (193 lines), github-client.ts, types.ts, analyze.ts, vitest.config.ts, ingester.test.ts (15/15 tests passing)

---

## Prompt

We're now in Code mode for Phase 2: Agent 1 - Repo Ingester.

Refer to bob_sessions/01-plan/architecture.md (Agent 1: Repo Ingester section) for full spec including input/output contracts.

# Task: Implement the Repo Ingester agent

Build the Repo Ingester at functions/lib/agents/ingester.ts following the spec:

1. **Function signature**:
   - Input: IngesterInput { owner, repo, branch? }
   - Output: Promise<RepoManifest>
   - Uses Octokit for GitHub API via the github-client wrapper

2. **Implementation requirements**:
   - Use GitHub Tree API (recursive=1) for single-request fetch of entire file tree
   - Filter out: .git/, node_modules/, dist/, build/, binary files (.png .jpg .jpeg .gif .ico .pdf .zip .tar .gz .woff .woff2 .ttf .eot .otf .mp3 .mp4 .mov .webm .webp .svg)
   - Default branch detection: use repo metadata's default_branch if no branch specified
   - Handle repos with >100k files via graceful error (out of MVP scope)
   - Proper error handling: 404 (repo not found), 403 (rate limit / auth fail), 5xx (server error)
   - All errors return typed error objects, never throw uncaught

3. **GitHub client wrapper** (functions/lib/github-client.ts):
   - Octokit instance factory taking auth token
   - Cloudflare Functions Env interface with GITHUB_TOKEN

4. **Tests** (functions/lib/agents/__tests__/ingester.test.ts):
   - Use vitest (add to devDependencies if not present, plus @vitest/ui optional)
   - Mock Octokit with realistic responses
   - Test cases: small repo success, large repo (mock 500 files), 404, 403 rate limit, malformed response, branch fallback

5. **API endpoint integration** (functions/api/analyze.ts):
   - Skeleton POST endpoint taking { owner, repo, branch? } body
   - Calls Agent 1 only (other agents come in later phases, leave TODO comments)
   - Returns RepoManifest JSON or error JSON with proper status code
   - CORS headers for browser fetch (allow localhost + *.pages.dev)

# Constraints

- Strict TypeScript, no `any`
- Excluded file extensions in single exported constant arrays (BINARY_EXTENSIONS, EXCLUDED_DIRS)
- Don't implement parser/layout/annotator yet (separate phases)
- Estimated coin budget: ≤6 coins

# Deliverables

After this session:
- pnpm test passes (vitest)
- POST /api/analyze with { owner: "shadcn", repo: "ui" } returns valid RepoManifest
- Testable locally via `pnpm dev` with GitHub token in .dev.vars

Generate all files with full content. After done, summarize what was created and any architecture.md deviations.

Save session reports to bob_sessions/03-code-ingester/.

---

## Outcome Summary

- 7 files created: github-client.ts, types.ts, ingester.ts (193 lines), ingester.test.ts (15 tests), analyze.ts, vitest.config.ts, package.json update
- 15/15 tests passing (548ms)
- 35 binary extensions + 15 excluded directories filtered
- 7 typed error codes (404, 403, 5xx, etc.)
- CORS-enabled API endpoint
- 100% architecture compliant, no deviations
- Coin usage: ~5.5 / 6 budget (92% efficiency)
