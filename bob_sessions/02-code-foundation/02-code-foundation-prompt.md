# 02-code-foundation: User Prompts

**Session:** Code Mode | Phase 1: Foundation Setup
**Date:** 2026-05-17
**Coins Used:** ~2.90
**Coin Budget:** ≤5 coins
**Output:** Full project scaffold (package.json, tsconfig, Vite, Tailwind, types, App shell, scripts/cache-repos.ts, etc.)

---

## Prompt

We're now in Code mode for Phase 1: Foundation Setup.

Refer to bob_sessions/01-plan/architecture.md for full context. Follow it strictly except for the corrections noted below.

# Corrections to architecture.md

1. Skip pnpm-workspace.yaml. We are NOT using a monorepo (architecture.md says "flat structure, no /packages"). pnpm without workspaces.
2. Cloudflare Pages config: do NOT use service-worker format from wrangler.toml. Pages uses the /functions directory convention directly with no wrangler.toml needed for basic setup. If wrangler.toml is created, it should be Pages-style (no [build.upload]).
3. Use _routes.json if needed to control which paths are handled by Functions vs static assets.

# Task: Initialize the Atlas codebase

Set up the complete project foundation:

1. **package.json**: All required dependencies (React 18, react-dom, Vite 5, D3.js v7 + types, Octokit, Tailwind CSS, autoprefixer, postcss, TypeScript 5, @cloudflare/workers-types, tsx for scripts). Use pnpm. Scripts: dev, build, preview, cache-repos.

2. **Folder structure** (create all directories per architecture.md):
   - src/components/ src/lib/ src/types/
   - functions/api/ functions/lib/agents/
   - public/cache/ (empty for now, populated by cache-repos script later)
   - scripts/
   - bob_sessions/02-code-foundation/ through bob_sessions/07-review-security/ with .gitkeep each

3. **TypeScript config**: tsconfig.json strict mode + path aliases (@/components, @/lib, @/types, @/functions). Also tsconfig.node.json for Vite config files.

4. **Vite config**: vite.config.ts with React plugin, Tailwind, path aliases, output dir = dist.

5. **Tailwind setup**: tailwind.config.js + postcss.config.js + src/index.css with @tailwind directives.

6. **Cloudflare Pages config**:
   - No wrangler.toml needed for basic Pages + Functions
   - public/_routes.json if filtering needed (initially: include none, all paths default)
   - .env.example with GITHUB_TOKEN placeholder
   - .dev.vars for local Functions dev (gitignored)

7. **Shared types** (src/types/index.ts): ALL interfaces from architecture.md Appendix verbatim (RepoManifest, FileNode, CodeStructure, ParsedFile, Dependency, RepoMetrics, FileType, LayoutData, LayoutNode, LayoutEdge, District, AnnotatedLayout, Highlight, Label).

8. **Minimal App.tsx + main.tsx**: Shell with Tailwind-styled "Atlas - Coming Soon" placeholder. Confirms build pipeline works. Dark theme default per City Map aesthetic (dark slate background).

9. **README.md** (replace placeholder): Project description, tech stack, setup instructions (pnpm install, GITHUB_TOKEN setup, pnpm dev), Cloudflare Pages deploy steps, demo URL placeholder.

10. **scripts/cache-repos.ts**: Full implementation from architecture.md Pre-cached Repos Strategy section, with proper error handling.

# Constraints

- pnpm only (not npm/yarn)
- TypeScript strict mode (no `any`)
- No business logic yet, scaffolding only
- All files must build clean (pnpm install + pnpm build = exit 0)
- Estimated coin budget: ≤5 coins for this session

# Deliverables

After this session, the user should be able to:
- Run `pnpm install` successfully
- Run `pnpm dev` and see placeholder UI
- Run `pnpm build` without errors
- Run `GITHUB_TOKEN=xxx pnpm tsx scripts/cache-repos.ts` and get JSON files in public/cache/
- Commit and have it auto-deployable on Cloudflare Pages

Generate all files with full content. After done, summarize what was created and any deviations from architecture.md.

---

## Outcome Summary

- 18 files created (7 config + 5 source + 3 Cloudflare + 3 scripts/docs)
- 10 directories with .gitkeep
- All 3 corrections applied (no pnpm-workspace.yaml, no service-worker wrangler.toml, Pages convention)
- Build verification passed: 228 packages, TypeScript clean, Vite 899ms, bundle 143.59 kB (gzipped 46.21 kB)
- Under budget: 2.90 / 5 coins
