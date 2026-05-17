# Atlas Architecture
**IBM Bob Hackathon 2026 | Knowledge Transfer Solution**

Generated: 2026-05-17  
Target: 25-30 hour build window  
Demo repo: shadcn/ui

---

## Executive Summary

Atlas is a stateless web application that transforms any GitHub repository into a single-page visual map using a "City Map" metaphor. The system uses pre-cached repository data (build-time) to avoid GitHub API rate limits and Cloudflare Workers timeout constraints. Output is an interactive SVG visualization with client-side PNG export capability.

**Key Decision: Cloudflare Pages + Functions** (not Workers)
- Cloudflare Pages handles static frontend (Vite build)
- Cloudflare Functions (`/functions` directory) handles API routes
- No separate Workers deployment needed
- Automatic GitHub integration for continuous deployment
- 25MB function size limit (sufficient for our use case)

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        USER BROWSER                          │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  React UI (Vite)                                       │ │
│  │  - Repo URL input                                      │ │
│  │  - D3.js SVG renderer                                  │ │
│  │  - Client-side PNG export (canvas.toBlob)             │ │
│  └────────────────────────────────────────────────────────┘ │
│                            │                                 │
│                            │ HTTPS                            │
│                            ▼                                 │
└─────────────────────────────────────────────────────────────┘
                             │
                             │
┌─────────────────────────────────────────────────────────────┐
│              CLOUDFLARE PAGES (*.pages.dev)                  │
│                                                              │
│  ┌──────────────────────┐    ┌──────────────────────────┐  │
│  │   Static Assets      │    │  Functions (/functions)  │  │
│  │   (Vite dist/)       │    │  - /api/analyze          │  │
│  │   - index.html       │    │  - /api/health           │  │
│  │   - bundle.js        │    │                          │  │
│  │   - styles.css       │    │  Agent Pipeline:         │  │
│  └──────────────────────┘    │  1. Repo Ingester        │  │
│                               │  2. Structure Parser     │  │
│  ┌──────────────────────┐    │  3. Layout Engine        │  │
│  │  Pre-cached Data     │    │  4. Annotator            │  │
│  │  (/public/cache/)    │◄───┤                          │  │
│  │  - shadcn-ui.json    │    │  Returns: LayoutData     │  │
│  │  - hono.json         │    └──────────────────────────┘  │
│  │  - drizzle-orm.json  │                                   │
│  └──────────────────────┘                                   │
└─────────────────────────────────────────────────────────────┘
                             │
                             │ Build-time only
                             ▼
                    ┌─────────────────┐
                    │  GitHub API     │
                    │  (Octokit)      │
                    │  - Tree API     │
                    │  - Commits API  │
                    └─────────────────┘
```

**Data Flow:**
1. User enters GitHub repo URL (e.g., `shadcn/ui`)
2. Frontend checks if repo exists in pre-cached data (`/cache/shadcn-ui.json`)
3. If cached: load JSON directly (instant)
4. If not cached: call `/api/analyze?repo=owner/name` (Cloudflare Function)
5. Function runs 4-agent pipeline, returns structured layout data
6. Frontend renders SVG using D3.js force-directed layout
7. User clicks "Export PNG" → client-side canvas conversion

---

## Tech Stack (Final)

| Layer | Technology | Justification |
|-------|-----------|---------------|
| **Hosting** | Cloudflare Pages | Free tier, auto-deploy from GitHub, global CDN, integrated Functions |
| **Frontend** | React 18 + TypeScript | Component reusability, type safety |
| **Build Tool** | Vite 5 | Fast HMR, optimized production builds |
| **Visualization** | D3.js v7 | Industry standard for SVG data viz, force-directed layouts |
| **Backend Runtime** | Cloudflare Functions | Serverless, 0ms cold start (Pages integration), TypeScript support |
| **GitHub Client** | Octokit (REST) | Official GitHub SDK, tree API for efficient file fetching |
| **Styling** | Tailwind CSS | Rapid UI development, small bundle size |
| **Package Manager** | pnpm | Fast, disk-efficient, workspace support |

**Rejected Alternatives:**
- ❌ Cloudflare Workers: Requires separate deployment, more complex setup
- ❌ Vercel: Less familiar to developer, similar capabilities
- ❌ Canvas API: D3.js SVG is more flexible, client-side PNG export is trivial
- ❌ GraphQL API: REST is simpler, tree API is sufficient

---

## Folder Structure

```
atlas/
├── .github/
│   └── workflows/
│       └── deploy.yml              # Optional: manual deploy trigger
├── bob_sessions/
│   ├── 01-plan/
│   │   └── architecture.md         # This document
│   ├── 02-code-ingester/
│   ├── 03-code-parser/
│   ├── 04-code-layout/
│   ├── 05-code-annotator/
│   ├── 06-code-frontend/
│   └── 07-review-security/
├── public/
│   └── cache/                      # Pre-cached demo repos (build-time)
│       ├── shadcn-ui.json
│       ├── hono.json
│       └── drizzle-orm.json
├── src/
│   ├── components/
│   │   ├── RepoInput.tsx           # URL input + validation
│   │   ├── CityMap.tsx             # D3.js visualization wrapper
│   │   ├── ExportButton.tsx        # PNG export logic
│   │   └── LoadingState.tsx        # Skeleton UI
│   ├── lib/
│   │   ├── d3-renderer.ts          # D3.js layout + rendering logic
│   │   ├── png-export.ts           # SVG → Canvas → PNG
│   │   └── api-client.ts           # Fetch wrapper for /api/analyze
│   ├── types/
│   │   └── index.ts                # Shared TypeScript interfaces
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── functions/
│   ├── api/
│   │   ├── analyze.ts              # Main API endpoint
│   │   └── health.ts               # Health check
│   └── lib/
│       ├── agents/
│       │   ├── ingester.ts         # Agent 1: Repo Ingester
│       │   ├── parser.ts           # Agent 2: Structure Parser
│       │   ├── layout.ts           # Agent 3: Layout Engine
│       │   └── annotator.ts        # Agent 4: Annotator
│       ├── github-client.ts        # Octokit wrapper
│       └── types.ts                # Backend types
├── scripts/
│   └── cache-repos.ts              # Build-time script to pre-cache repos
├── .gitignore
├── package.json
├── pnpm-workspace.yaml             # pnpm workspace config
├── tsconfig.json
├── vite.config.ts
├── wrangler.toml                   # Cloudflare Pages config
└── README.md
```

**Key Design Decisions:**
- `/functions` directory: Cloudflare Pages convention for serverless functions
- `/public/cache`: Static JSON files served directly by CDN (no function invocation)
- `/scripts`: Build-time utilities (not deployed)
- Flat structure: No `/packages` monorepo complexity (overkill for 30-hour build)

---

## Agent Contracts

### Agent 1: Repo Ingester
**Purpose:** Fetch raw repository data from GitHub API

**Input Contract:**
```typescript
interface IngesterInput {
  owner: string;        // e.g., "shadcn"
  repo: string;         // e.g., "ui"
  branch?: string;      // default: "main"
}
```

**Output Contract:**
```typescript
interface RepoManifest {
  metadata: {
    owner: string;
    repo: string;
    branch: string;
    defaultBranch: string;
    description: string;
    stars: number;
    lastCommitDate: string;  // ISO 8601
  };
  tree: FileNode[];
}

interface FileNode {
  path: string;           // "src/components/Button.tsx"
  type: "file" | "dir";
  size: number;           // bytes (0 for dirs)
  sha: string;            // git blob SHA
}
```

**Dependencies:**
- Octokit REST client
- GitHub Tree API (`GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1`)

**Complexity:** **S (Small)**
- Single API call with recursive flag
- Minimal data transformation
- Error handling for 404/rate limits

**Implementation Notes:**
- Use tree API (not contents API) for efficiency: 1 request vs N requests
- Filter out `.git/`, `node_modules/`, binary files (`.png`, `.jpg`, etc.)
- Handle repos with >100k files (GitHub API limit: paginate if needed)

---

### Agent 2: Structure Parser
**Purpose:** Extract code structure, dependencies, and metrics

**Input Contract:**
```typescript
interface ParserInput {
  tree: FileNode[];       // From Agent 1
  owner: string;
  repo: string;
}
```

**Output Contract:**
```typescript
interface CodeStructure {
  files: ParsedFile[];
  dependencies: Dependency[];
  metrics: RepoMetrics;
}

interface ParsedFile {
  path: string;
  type: FileType;         // "source" | "test" | "config" | "docs" | "asset"
  language: string;       // "typescript" | "javascript" | "python" | etc.
  loc: number;            // lines of code (estimated from size)
  imports: string[];      // relative paths to imported files
  exports: string[];      // exported symbols (functions/classes)
  isEntryPoint: boolean;  // package.json "main", index.*, etc.
}

interface Dependency {
  from: string;           // file path
  to: string;             // file path
  type: "import" | "dynamic";
}

interface RepoMetrics {
  totalFiles: number;
  totalLOC: number;
  languageBreakdown: Record<string, number>;  // { "typescript": 15000, ... }
  directoryDepth: number;
}

type FileType = "source" | "test" | "config" | "docs" | "asset";
```

**Dependencies:**
- File extension mapping (`.ts` → TypeScript, `.py` → Python)
- Regex patterns for import detection (language-specific)
- GitHub Blob API for file contents (only for entry points + top-level files)

**Complexity:** **M (Medium)**
- Language-specific import parsing (regex-based, not AST)
- Heuristics for file classification (test: `*.test.*`, `__tests__/`)
- LOC estimation from file size (avg 40 chars/line)

**Implementation Notes:**
- **Do NOT fetch all file contents** (rate limit + timeout risk)
- Fetch only: `package.json`, `*.config.*`, entry points, top 20 largest files
- Use regex for import detection:
  - JS/TS: `/import .* from ['"](.*)['"];/g`
  - Python: `/from (.*) import|import (.*)/g`
- Classify files by path patterns:
  - Test: `test/`, `__tests__/`, `*.test.*`, `*.spec.*`
  - Config: `*.config.*`, `.eslintrc`, `tsconfig.json`
  - Docs: `README`, `docs/`, `*.md`

---

### Agent 3: Layout Engine
**Purpose:** Position all nodes on a 2D canvas using force-directed algorithm

**Input Contract:**
```typescript
interface LayoutInput {
  structure: CodeStructure;  // From Agent 2
  canvasSize: { width: number; height: number };  // e.g., 1920x1080
}
```

**Output Contract:**
```typescript
interface LayoutData {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  districts: District[];
  bounds: { width: number; height: number };
}

interface LayoutNode {
  id: string;             // file path
  x: number;              // canvas coordinate
  y: number;
  width: number;          // building footprint
  height: number;         // building height (LOC-based)
  type: FileType;
  label: string;          // short filename
  metadata: {
    path: string;
    loc: number;
    language: string;
  };
}

interface LayoutEdge {
  source: string;         // node id
  target: string;
  strength: number;       // 0-1 (import frequency)
}

interface District {
  name: string;           // directory name
  nodes: string[];        // node ids in this district
  bounds: { x: number; y: number; width: number; height: number };
  color: string;          // hex color for district background
}
```

**Dependencies:**
- D3.js force simulation (or custom implementation)
- Clustering algorithm for districts (group by directory)

**Complexity:** **L (Large)**
- Force-directed layout is computationally expensive
- Need to balance readability vs density
- Edge bundling for visual clarity

**Implementation Notes:**
- Use D3's `forceSimulation()` with:
  - `forceManyBody()`: repulsion between nodes
  - `forceLink()`: attraction along edges
  - `forceCollide()`: prevent overlap
  - `forceCenter()`: center the graph
- Node size: `width = sqrt(LOC) * 2`, `height = LOC / 50`
- District clustering: group nodes by top-level directory
- Limit to 500 nodes max (filter by LOC threshold if needed)
- Run simulation for 300 ticks (balance speed vs quality)

---

### Agent 4: Annotator
**Purpose:** Highlight important nodes and add descriptive labels

**Input Contract:**
```typescript
interface AnnotatorInput {
  layout: LayoutData;     // From Agent 3
  structure: CodeStructure;  // From Agent 2
}
```

**Output Contract:**
```typescript
interface AnnotatedLayout extends LayoutData {
  highlights: Highlight[];
  labels: Label[];
}

interface Highlight {
  nodeId: string;
  type: "core" | "entry" | "hotspot";
  reason: string;         // "High centrality" | "Entry point" | "Recent activity"
  intensity: number;      // 0-1 (glow strength)
}

interface Label {
  nodeId: string;
  text: string;           // "API Routes" | "UI Components" | "Database Layer"
  position: "top" | "bottom" | "left" | "right";
}
```

**Dependencies:**
- Centrality algorithm (degree centrality or PageRank)
- District naming heuristics

**Complexity:** **S (Small)**
- Simple graph metrics
- Rule-based labeling

**Implementation Notes:**
- **Core nodes** (capital city): top 5 by degree centrality
  - Degree centrality = number of incoming + outgoing edges
- **Entry points**: nodes marked `isEntryPoint: true` by Agent 2
- **Hotspots**: (future) nodes with recent git activity (skip for MVP)
- **District labels**: use directory name, capitalize first letter
  - `src/components` → "Components"
  - `lib/utils` → "Utils"
- Glow effect: CSS `filter: drop-shadow()` with intensity-based blur radius

---

## MVP Scope (25-30 Hours)

### ✅ MUST HAVE (Core Demo)
1. **Pre-cached demo repos** (shadcn/ui, hono, drizzle-orm)
   - Build-time script fetches data, saves to `/public/cache/*.json`
   - Frontend loads instantly from static JSON
2. **4-agent pipeline** (all agents implemented)
3. **D3.js city map visualization**
   - Force-directed layout
   - Node size = LOC
   - Edges = imports
   - District backgrounds (directory grouping)
4. **Core node highlighting** (degree centrality)
5. **Client-side PNG export** (SVG → Canvas → download)
6. **Cloudflare Pages deployment** (auto-deploy from GitHub)
7. **Basic UI** (repo input, loading state, export button)

**Estimated Time:** 20-22 hours

### 🎯 NICE TO HAVE (If Time Permits)
1. **Live repo analysis** (non-cached repos via `/api/analyze`)
   - Requires GitHub token input from user
   - 5-10 second processing time
2. **Git activity heatmap** (recent commits glow)
   - Requires Commits API call
3. **Interactive tooltips** (hover to see file details)
4. **Zoom/pan controls** (D3.js zoom behavior)
5. **Multiple layout algorithms** (force-directed vs grid vs radial)

**Estimated Time:** 5-8 hours

### ❌ OUT OF SCOPE
- User authentication
- Database/caching layer (Supabase)
- Real-time collaboration
- Custom color themes
- PDF export (PNG is sufficient)
- Mobile responsive design (desktop-first)

---

## Top 5 Risks & Mitigation

### 1. **Cloudflare Function Timeout (10s CPU limit)**
**Risk:** Large repos (>1000 files) may timeout during analysis

**Mitigation:**
- Pre-cache demo repos (eliminates risk for judging)
- For live analysis: implement aggressive filtering
  - Skip files >100KB
  - Limit to 500 nodes max
  - Use sampling for large directories
- Add timeout warning in UI ("Large repos may take 10+ seconds")

**Likelihood:** Medium | **Impact:** High

---

### 2. **GitHub API Rate Limits**
**Risk:** Unauthenticated = 60 req/hour, may hit limit during development

**Mitigation:**
- Use personal access token during development (store in `.env`, never commit)
- Pre-cached repos eliminate runtime API calls for demo
- For live analysis: require user to provide their own token
- Implement exponential backoff + retry logic

**Likelihood:** Low (with pre-caching) | **Impact:** Medium

---

### 3. **D3.js Performance (Large Graphs)**
**Risk:** 1000+ nodes may cause browser lag/freeze

**Mitigation:**
- Hard limit: 500 nodes max (filter by LOC threshold)
- Use `requestAnimationFrame` for smooth rendering
- Implement virtual scrolling (only render visible nodes)
- Add "Simplify" button to reduce node count

**Likelihood:** Medium | **Impact:** Medium

---

### 4. **Import Parsing Accuracy**
**Risk:** Regex-based parsing may miss dynamic imports or non-standard syntax

**Mitigation:**
- Accept 80% accuracy for MVP (perfect parsing requires AST, too slow)
- Focus on common patterns: ES6 imports, CommonJS require
- Document known limitations in README
- For demo repos: manually verify import graph is reasonable

**Likelihood:** High | **Impact:** Low (acceptable for demo)

---

### 5. **Time Overrun**
**Risk:** 30 hours is tight for 4 agents + frontend + deployment

**Mitigation:**
- Build agents sequentially (see build sequence below)
- Use pre-built components (Tailwind UI, shadcn/ui components)
- Skip nice-to-haves if behind schedule
- Timebox each agent: Ingester (3h), Parser (5h), Layout (6h), Annotator (2h), Frontend (6h), Integration (4h), Buffer (4h)

**Likelihood:** Medium | **Impact:** High

---

## Build Sequencing

### Phase 1: Foundation (4 hours)
**Goal:** Project setup + deployment pipeline

1. Initialize Vite + React + TypeScript project
2. Configure Tailwind CSS
3. Set up Cloudflare Pages (`wrangler.toml`)
4. Create GitHub repo integration (Cloudflare dashboard)
5. Deploy "Hello World" to verify pipeline
6. Create shared TypeScript types (`src/types/index.ts`, `functions/lib/types.ts`)

**Deliverable:** Working deployment pipeline + type definitions

**Bob Mode:** Code mode (1 session)

---

### Phase 2: Agent 1 - Repo Ingester (3 hours)
**Goal:** Fetch GitHub repo data

1. Implement `functions/lib/github-client.ts` (Octokit wrapper)
2. Implement `functions/lib/agents/ingester.ts`
3. Write unit tests (mock GitHub API responses)
4. Create `/scripts/cache-repos.ts` (pre-cache shadcn/ui)
5. Test with shadcn/ui repo

**Deliverable:** Working ingester + cached `shadcn-ui.json`

**Bob Mode:** Code mode (1 session)

**Why First?** Foundation for all other agents, simplest to implement, validates GitHub API integration

---

### Phase 3: Agent 2 - Structure Parser (5 hours)
**Goal:** Extract dependencies and metrics

1. Implement file type classification logic
2. Implement import regex patterns (JS/TS/Python)
3. Implement LOC estimation
4. Implement `functions/lib/agents/parser.ts`
5. Test with cached shadcn/ui data
6. Verify import graph is reasonable

**Deliverable:** Working parser with accurate import detection

**Bob Mode:** Code mode (1 session)

**Why Second?** Depends on Agent 1 output, provides data for layout engine

---

### Phase 4: Agent 3 - Layout Engine (6 hours)
**Goal:** Position nodes on canvas

1. Implement D3.js force simulation
2. Implement district clustering (group by directory)
3. Implement collision detection
4. Implement `functions/lib/agents/layout.ts`
5. Test with parsed shadcn/ui data
6. Tune force parameters for readability

**Deliverable:** Working layout with positioned nodes

**Bob Mode:** Code mode (1 session)

**Why Third?** Most complex agent, needs parser output, critical path for visualization

---

### Phase 5: Agent 4 - Annotator (2 hours)
**Goal:** Highlight important nodes

1. Implement degree centrality calculation
2. Implement district labeling
3. Implement `functions/lib/agents/annotator.ts`
4. Test with layout data

**Deliverable:** Working annotator with highlights

**Bob Mode:** Code mode (1 session)

**Why Fourth?** Simplest agent, depends on layout output, non-critical for MVP

---

### Phase 6: Backend Integration (3 hours)
**Goal:** Wire agents into API endpoint

1. Implement `functions/api/analyze.ts` (orchestrate 4 agents)
2. Implement error handling + logging
3. Test end-to-end with cached data
4. Deploy to Cloudflare Pages
5. Verify `/api/analyze` works in production

**Deliverable:** Working API endpoint

**Bob Mode:** Code mode (1 session)

---

### Phase 7: Frontend (6 hours)
**Goal:** Build React UI

1. Implement `RepoInput.tsx` (URL validation)
2. Implement `CityMap.tsx` (D3.js rendering)
3. Implement `ExportButton.tsx` (PNG export)
4. Implement `LoadingState.tsx`
5. Wire up API client (`lib/api-client.ts`)
6. Style with Tailwind CSS
7. Test with cached shadcn/ui data

**Deliverable:** Working UI with visualization

**Bob Mode:** Code mode (1 session)

---

### Phase 8: Polish & Testing (3 hours)
**Goal:** Bug fixes + demo preparation

1. Test with all 3 cached repos (shadcn/ui, hono, drizzle-orm)
2. Fix visual bugs (overlapping nodes, edge routing)
3. Add loading states + error messages
4. Optimize bundle size (code splitting)
5. Write README with demo instructions
6. Record 5-minute demo video

**Deliverable:** Production-ready demo

**Bob Mode:** Review mode (1 session) + Ask mode (1 session)

---

### Phase 9: Submission (1 hour)
**Goal:** Package deliverables

1. Export all Bob session reports to `bob_sessions/`
2. Write submission statement (problem, solution, impact)
3. Upload video to YouTube (unlisted)
4. Submit to hackathon portal

**Deliverable:** Submitted project

**Bob Mode:** Ask mode (1 session)

---

## Bob Mode Budget Allocation

| Phase | Mode | Sessions | Estimated Coins |
|-------|------|----------|-----------------|
| Planning | Plan | 1 | 5 |
| Foundation | Code | 1 | 5 |
| Agent 1 | Code | 1 | 5 |
| Agent 2 | Code | 1 | 6 |
| Agent 3 | Code | 1 | 7 |
| Agent 4 | Code | 1 | 4 |
| Backend Integration | Code | 1 | 5 |
| Frontend | Code | 1 | 6 |
| Polish | Review + Ask | 2 | 4 |
| Submission | Ask | 1 | 2 |
| **TOTAL** | | **11** | **49** |

**Buffer:** -9 coins (over budget)

**Adjustment Strategy:**
- Reduce Agent 3 session (use Orchestrator mode to break into subtasks)
- Combine Backend Integration + Frontend into single Advanced mode session
- Skip Review mode if no security concerns

**Revised Total:** ~40 coins

---

## Deployment Configuration

### Cloudflare Pages Setup

**File:** `wrangler.toml`
```toml
name = "atlas"
compatibility_date = "2024-01-01"

[build]
command = "pnpm build"
cwd = "."
watch_dir = "src"

[build.upload]
format = "service-worker"
dir = "dist"

[[build.upload.rules]]
type = "ESModule"
globs = ["**/*.js"]

[env.production]
vars = { ENVIRONMENT = "production" }
```

**GitHub Integration:**
1. Go to Cloudflare Dashboard → Pages
2. Connect GitHub account
3. Select `chanjoongx/atlas` repo
4. Build settings:
   - Build command: `pnpm build`
   - Build output directory: `dist`
   - Root directory: `/`
5. Environment variables: (none needed for MVP)
6. Deploy

**Auto-deploy:** Every push to `main` triggers new deployment

**Custom Domain:** (optional) `atlas.pages.dev` → `atlas.yourdomain.com`

---

## Pre-cached Repos Strategy

### Build-Time Script

**File:** `scripts/cache-repos.ts`
```typescript
import { Octokit } from '@octokit/rest';
import fs from 'fs/promises';

const REPOS = [
  { owner: 'shadcn', repo: 'ui' },
  { owner: 'honojs', repo: 'hono' },
  { owner: 'drizzle-team', repo: 'drizzle-orm' },
];

async function cacheRepo(owner: string, repo: string) {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  
  // Fetch repo metadata
  const { data: repoData } = await octokit.repos.get({ owner, repo });
  
  // Fetch file tree
  const { data: treeData } = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: repoData.default_branch,
    recursive: 'true',
  });
  
  // Save to public/cache/
  const manifest = {
    metadata: {
      owner,
      repo,
      branch: repoData.default_branch,
      description: repoData.description,
      stars: repoData.stargazers_count,
      lastCommitDate: repoData.pushed_at,
    },
    tree: treeData.tree.filter(node => node.type === 'blob'),
  };
  
  await fs.writeFile(
    `public/cache/${owner}-${repo}.json`,
    JSON.stringify(manifest, null, 2)
  );
  
  console.log(`✓ Cached ${owner}/${repo}`);
}

async function main() {
  for (const { owner, repo } of REPOS) {
    await cacheRepo(owner, repo);
  }
}

main();
```

**Usage:**
```bash
GITHUB_TOKEN=ghp_xxx pnpm tsx scripts/cache-repos.ts
```

**Run:** Before every deployment (add to `package.json` build script)

---

## Success Metrics

### Demo Quality
- [ ] Visualization loads in <2 seconds (cached data)
- [ ] All 3 demo repos render correctly
- [ ] PNG export works (1920x1080 resolution)
- [ ] No visual bugs (overlapping nodes, broken edges)
- [ ] Core nodes are clearly highlighted

### Technical Quality
- [ ] TypeScript strict mode (no `any` types)
- [ ] All agents have unit tests
- [ ] No API keys in git history
- [ ] Cloudflare Pages deployment works
- [ ] Bundle size <500KB (gzipped)

### Hackathon Requirements
- [ ] 5-minute video recorded
- [ ] Written statement submitted
- [ ] All Bob sessions exported to `bob_sessions/`
- [ ] README includes demo instructions
- [ ] Public GitHub repo (chanjoongx/atlas)

---

## Next Steps

1. **Review this architecture** with user (confirm alignment)
2. **Switch to Code mode** to begin Phase 1 (Foundation)
3. **Create GitHub repo** (if not already done)
4. **Set up Cloudflare Pages** (GitHub integration)
5. **Begin implementation** following build sequence

---

## Appendix: Type Definitions

### Shared Types (`src/types/index.ts`)

```typescript
// Core data structures shared between frontend and backend

export interface RepoManifest {
  metadata: RepoMetadata;
  tree: FileNode[];
}

export interface RepoMetadata {
  owner: string;
  repo: string;
  branch: string;
  defaultBranch: string;
  description: string;
  stars: number;
  lastCommitDate: string;
}

export interface FileNode {
  path: string;
  type: 'file' | 'dir';
  size: number;
  sha: string;
}

export interface CodeStructure {
  files: ParsedFile[];
  dependencies: Dependency[];
  metrics: RepoMetrics;
}

export interface ParsedFile {
  path: string;
  type: FileType;
  language: string;
  loc: number;
  imports: string[];
  exports: string[];
  isEntryPoint: boolean;
}

export interface Dependency {
  from: string;
  to: string;
  type: 'import' | 'dynamic';
}

export interface RepoMetrics {
  totalFiles: number;
  totalLOC: number;
  languageBreakdown: Record<string, number>;
  directoryDepth: number;
}

export type FileType = 'source' | 'test' | 'config' | 'docs' | 'asset';

export interface LayoutData {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  districts: District[];
  bounds: { width: number; height: number };
}

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: FileType;
  label: string;
  metadata: {
    path: string;
    loc: number;
    language: string;
  };
}

export interface LayoutEdge {
  source: string;
  target: string;
  strength: number;
}

export interface District {
  name: string;
  nodes: string[];
  bounds: { x: number; y: number; width: number; height: number };
  color: string;
}

export interface AnnotatedLayout extends LayoutData {
  highlights: Highlight[];
  labels: Label[];
}

export interface Highlight {
  nodeId: string;
  type: 'core' | 'entry' | 'hotspot';
  reason: string;
  intensity: number;
}

export interface Label {
  nodeId: string;
  text: string;
  position: 'top' | 'bottom' | 'left' | 'right';
}
```

---

**End of Architecture Document**

*This document serves as the single source of truth for Atlas implementation. All code should conform to these contracts and design decisions.*