# Atlas

**One repo. One image. Grok any codebase in 30 seconds.**

Atlas transforms any public GitHub repository into an interactive city map visualization. Districts are directories. Blocks are files. Hotspots are the code that actually matters.

🌐 **Live demo:** https://atlas-1q0.pages.dev
🐙 **Source:** https://github.com/chanjoongx/atlas

Built end to end with [IBM Bob](https://www.ibm.com/) during the [lablab.ai IBM Bob Hackathon](https://lablab.ai/ai-hackathons/ibm-bob-hackathon), May 2026.

---

## ✨ Features

- **City Map Visualization**: Force directed D3.js layout with color coded districts
- **Pre cached demo repos**: shadcn/ui, Hono, Drizzle ORM load instantly (zero API calls)
- **Live custom analysis**: Paste any public GitHub repo for on demand visualization
- **Interactive**: Pan, zoom (in/out/reset controls), hover for file details
- **PNG export**: One click high resolution image, full visualization regardless of zoom state
- **Serverless**: Built on Cloudflare Pages and Functions

---

## 🚀 Try It

1. Visit **[atlas-1q0.pages.dev](https://atlas-1q0.pages.dev)**
2. Pick a demo repo, or paste any public GitHub repo as `owner/repo`
3. Click **Generate City Map**. Visualization in seconds.

Demo repos load instantly from pre cached JSON. Custom repos run the live analysis pipeline.

---

## 🏗️ How It Works

Atlas runs a 4 agent pipeline on Cloudflare Functions:

```
GitHub repo  →  [Ingester]  →  [Parser]   →  [Layout]    →  [Annotator]  →  City Map
                 file tree     structure     D3 force        centrality
                 metadata      + deps        layout          + labels
```

1. **Ingester** fetches repo metadata and file tree via GitHub API
2. **Parser** analyzes structure, classifies files (source / test / config / docs), extracts import dependencies
3. **Layout Engine** positions every node using D3 force directed simulation with district clustering
4. **Annotator** computes centrality metrics, picks highlights (entry points / core / hotspots), generates labels

See [`bob_sessions/01-plan/architecture.md`](./bob_sessions/01-plan/architecture.md) for the full design doc.

---

## 🛠️ Tech Stack

| Layer | Tools |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Visualization | D3.js v7 (`d3-force`, `d3-scale`, `d3-scale-chromatic`) |
| Backend | Cloudflare Pages Functions, Octokit REST |
| Package manager | pnpm |

---

## 💻 Local Development

### Prerequisites

- Node.js 20+
- pnpm 9+
- GitHub PAT with `public_repo` scope (only needed for live custom repo analysis)

### Setup

```bash
git clone https://github.com/chanjoongx/atlas.git
cd atlas
pnpm install

# (Optional) Add token for live custom repo analysis during dev
cp .env.example .dev.vars
# Edit .dev.vars: GITHUB_TOKEN=ghp_yourtoken
```

The 3 pre cached demo repos work **without** a token. The token is only needed if you want to analyze custom repos locally.

### Run

```bash
pnpm dev          # http://localhost:5173
pnpm build        # production build
pnpm test         # vitest suite (78 tests)
```

### Cache additional repos (optional)

The 3 demo repos are already cached in [`public/cache/`](./public/cache/). To cache more:

```bash
pnpm dev                              # terminal 1
pnpm tsx scripts/cache-repos.ts       # terminal 2
```

Cached JSON is served as a static asset at `/cache/{owner}-{repo}.json`.

---

## 🌐 Deployment (Cloudflare Pages)

Atlas auto deploys on every push to `main`.

### Deploy your own fork

1. **Connect repo to Cloudflare Pages**
   - Cloudflare dashboard → Workers & Pages → Create application → Pages → Connect to Git
   - Select your fork, branch: `main`
   - Framework preset: **Vite** (auto detected)
   - Build command: `pnpm build`
   - Build output directory: `dist`

2. **Add environment variables** (Settings → Environment variables → Production *and* Preview)
   - Name: `GITHUB_TOKEN`
   - Value: your PAT (scope: `public_repo`)
   - **⚠️ Mark as Encrypted (Secret).** Required for security; visible as `••••••` after save.
   - Without this, demo repos still work via cache, but custom repo analysis returns 500

3. **Add Functions compatibility flag** (Settings → Functions → Compatibility flags)
   - Add `nodejs_compat` to both Production and Preview
   - Required for `@octokit/rest` to bundle correctly

4. **Trigger deployment**
   - Push any commit (auto deploys), or click "Retry deployment" in the dashboard
   - **Note:** Environment variable changes only apply to *new* deployments

---

## 🤖 Built with IBM Bob

Atlas was built end to end during the IBM Bob Hackathon (May 16 to 17, 2026) with [IBM Bob](https://www.ibm.com/) as the AI development partner.

| Stat | Count |
|---|---|
| Bob sessions | 12 (planning, 4 agents, frontend, fixes, polish, custom input) |
| Tests passing | 78 / 78 |
| Pipeline agents | Ingester, Parser, Layout, Annotator |
| Commits | 20 across 12 sessions |

Each session is exported to [`bob_sessions/`](./bob_sessions/), fully traceable: what was prompted, what Bob produced, what was committed. The highlight was Bob holding full repo context across every session. Iterating on the layout algorithm in one session and having the annotator in the next session immediately understand the data shape, with zero re-explaining, was the real productivity unlock.

---

## 📁 Project Structure

```
atlas/
├── src/                          Frontend (React + Vite)
│   ├── components/               UI: CityMap, RepoInput, ExportButton, LoadingState
│   ├── lib/                      d3-renderer, api-client, png-export
│   ├── types/                    Shared TypeScript types
│   └── App.tsx                   Root component
├── functions/                    Cloudflare Functions (serverless backend)
│   ├── api/analyze.ts            POST /api/analyze endpoint
│   └── lib/agents/               4 agent pipeline + tests (78/78 passing)
├── public/
│   ├── cache/                    Pre cached demo visualizations (JSON)
│   └── _routes.json              Cloudflare Pages routing config
├── scripts/cache-repos.ts        Cache generation script
└── bob_sessions/                 Bob AI session logs (per phase)
```

---

## 📜 License

MIT. See [LICENSE](./LICENSE).

---

## 🙏 Acknowledgments

- **[IBM Bob](https://www.ibm.com/)**: the AI dev partner that made this weekend possible
- **[lablab.ai](https://lablab.ai/ai-hackathons/ibm-bob-hackathon)**: for hosting the hackathon
- **[Cloudflare Pages](https://pages.cloudflare.com/)**: serverless hosting
- **[D3.js](https://d3js.org/)**: force directed graph layout
- **[Octokit](https://github.com/octokit/octokit.js)**: GitHub API client
- **[shadcn/ui](https://github.com/shadcn-ui/ui), [Hono](https://github.com/honojs/hono), [Drizzle ORM](https://github.com/drizzle-team/drizzle-orm)**: the open source projects featured as demo subjects

---

<p align="center">Built with IBM Bob · Chanjoong Kim · May 2026</p>
