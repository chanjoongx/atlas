# 01-plan: User Prompts

**Session:** Plan Mode | Architecture Design
**Date:** 2026-05-17
**Coins Used:** 0.35
**Output:** `architecture.md` (Atlas full architecture)

---

## Initial Prompt

We're building Atlas, a one-page visual map of any GitHub repository for the IBM Bob Hackathon (May 2026).

# Product Vision

Atlas takes a GitHub repository URL as input and produces a single high-quality visual map (PDF/PNG) that lets any developer understand the codebase's structure, key components, and entry points in 30 seconds. The target user is a solo developer or new team member who needs fast onboarding to a codebase they've never seen.

The visualization uses a "City Map" metaphor: directories are neighborhoods, files are buildings (height = lines of code), imports are roads, and recent git activity glows. Core logic appears as the capital city (high centrality). Output is a single PDF or PNG image, suitable for pinning in Slack or printing.

# Hackathon Theme Fit

This solution targets the "Knowledge Transfer" bottleneck identified by IBM: helping developers get up to speed on existing codebases instantly. Uses Bob's repository context strength directly.

# Hard Constraints

- Time: ~25-30 hours of build remaining
- Bob budget: 40 Bobcoins total. This Plan session should use ≤5 coins
- Public GitHub repo (chanjoongx/atlas, already initialized)
- Must include bob_sessions/ folder with exported session reports for judging
- Submission deliverables: working prototype + 5-minute video + written statement
- No API key exposure in commits (IBM Security scans 24/7)

# Tech Stack Preference (verify or recommend alternative)

- Backend: Cloudflare Workers + TypeScript (developer is familiar)
- Frontend: React + TypeScript + Vite
- Visualization: D3.js for SVG output
- Storage: none (stateless), or Supabase if caching is needed
- GitHub data: Octokit (GitHub REST API)

# Multi-Agent Design (verify or restructure)

Proposed 4 agents:

1. Repo Ingester: fetches GitHub repo content, parses file tree, returns structured manifest
2. Structure Parser: extracts dependencies (imports), LOC per file, classifies modules (data/logic/UI/test/config)
3. Layout Engine: lays out all data on a single canvas using force-directed or grid algorithm; ensures readability at one-page scale
4. Annotator: highlights core nodes by centrality, adds short descriptive text labels per district

# Bob Mode Usage Plan

- Plan mode (this session): architecture + folder structure + agent contracts
- Code mode: 4-5 sessions, one per agent + UI integration
- /review: 2-3 times for security audit + correctness check
- Orchestrator mode: 1-2 sessions for end-to-end pipeline
- Advanced mode: 1 session for GitHub MCP server if useful

# Demo Plan

Demo input: shadcn/ui GitHub repo
Demo output: single visual map showing project's components, entry points, and activity hotspots

# What I Want From This Plan Session

Produce a detailed architecture markdown that includes:

1. System architecture diagram (text or ASCII)
2. Detailed folder structure for chanjoongx/atlas repo
3. For each agent: precise input contract, output contract, dependencies, estimated complexity (S/M/L)
4. Tech stack decision (confirm proposal or recommend alternative with reasoning)
5. MVP scope: what to build in 25-30 hours vs what to cut
6. Top 5 risks with mitigation strategies
7. Build sequencing: which agent to build first and why

Be matter-of-fact and specific. Prefer concrete decisions over options. If you see a flaw in my proposal, push back directly.

When done, output the full architecture as markdown content I can save to bob_sessions/01-plan/architecture.md.

---

## Revision Response (after Bob raised clarifying questions)

Bob raised 4 questions: (1) Workers timeout, (2) PDF/PNG output format, (3) GitHub API rate limits, (4) monorepo structure. Initial response leaned Vercel; user clarified Cloudflare familiarity. Final answer:

Revising. Going with Cloudflare. Familiar stack is critical for shipping in 25h.

1: Keep Cloudflare. You decide the specific structure (Workers Sites vs Pages + Functions vs Workers + Static Assets) with best-practice reasoning. Timeout concern is resolved by pre-cache strategy (see #3 below).

2: SVG only (D3) + client-side PNG export via canvas-toBlob. Same as before.

3: Pre-cache demo repos (shadcn/ui, hono, drizzle-orm). Build-time: call GitHub API and save as static JSON assets. Runtime: backend only fetches and parses that JSON. This avoids both Workers timeout and token exposure at once.

4: Single Cloudflare deploy. Frontend (Vite + React) + backend agents. Folder structure depends on #1 decision.

5: Include Cloudflare Pages deployment in the architecture. The *.pages.dev URL will be the submission demo URL. Set up wrangler config + GitHub integration so every push auto-deploys. The user is on Windows, prefers git-integration via Cloudflare dashboard over CLI complexity.

Final decisions. Complete the architecture markdown now.
