# Atlas - GitHub Repository Visualizer

Transform any GitHub repository into an interactive city map visualization using a "City Map" metaphor. Built for the IBM Bob Hackathon 2026.

## 🌟 Features

- **City Map Visualization**: Repositories rendered as interactive city maps using D3.js
- **Pre-cached Demo Repos**: Instant loading for popular repositories (shadcn/ui, hono, drizzle-orm)
- **Live Analysis**: Analyze any public GitHub repository on-demand
- **PNG Export**: Client-side export of visualizations
- **Serverless Architecture**: Powered by Cloudflare Pages + Functions

## 🛠️ Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Visualization**: D3.js v7 (force-directed layouts)
- **Styling**: Tailwind CSS
- **Backend**: Cloudflare Functions (serverless)
- **GitHub API**: Octokit REST client
- **Package Manager**: pnpm

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ 
- pnpm 9+
- GitHub Personal Access Token (for caching repos)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/chanjoongx/atlas.git
cd atlas
```

2. Install dependencies:
```bash
pnpm install
```

3. Set up environment variables:
```bash
# Copy the example file
cp .env.example .dev.vars

# Edit .dev.vars and add your GitHub token
# Get token from: https://github.com/settings/tokens
# Required scope: public_repo
```

4. Cache demo repositories (optional but recommended):

**Why cache?** Pre-caching demo repositories provides instant loading without API calls, perfect for demos and development.

```bash
# Start the dev server first (in one terminal)
pnpm dev

# Then in another terminal, run the cache script
pnpm tsx scripts/cache-repos.ts
```

**What it does:**
- Analyzes 3 demo repos (shadcn/ui, hono, drizzle-orm)
- Saves AnnotatedLayout JSON to `public/cache/`
- Frontend tries cache first, falls back to API if not found

**Requirements:**
- Dev server must be running (`pnpm dev`)
- `GITHUB_TOKEN` set in `.dev.vars`
- Takes ~2-3 minutes for all 3 repos

**Output files:**
- `public/cache/shadcn-ui-ui.json`
- `public/cache/honojs-hono.json`
- `public/cache/drizzle-team-drizzle-orm.json`

These files are served as static assets and loaded instantly by the frontend.

### Development

Start the development server:
```bash
pnpm dev
```

The app will be available at `http://localhost:5173`

### Build

Build for production:
```bash
pnpm build
```

Preview production build:
```bash
pnpm preview
```

## 📦 Project Structure

```
atlas/
├── src/                    # Frontend source code
│   ├── components/         # React components
│   ├── lib/               # Utility functions
│   ├── types/             # TypeScript type definitions
│   ├── App.tsx            # Main app component
│   └── main.tsx           # Entry point
├── functions/             # Cloudflare Functions (API)
│   ├── api/              # API endpoints
│   └── lib/              # Backend utilities & agents
├── public/               # Static assets
│   └── cache/           # Pre-cached repository data
├── scripts/             # Build-time scripts
└── bob_sessions/        # Bob AI session logs
```

## 🌐 Deployment

### Cloudflare Pages

1. Push your code to GitHub
2. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → Pages
3. Connect your GitHub repository
4. Configure build settings:
   - Build command: `pnpm build`
   - Build output directory: `dist`
   - Root directory: `/`
5. Deploy!

Your app will be available at `https://atlas.pages.dev`

### Environment Variables

For production deployment, add environment variables in Cloudflare Pages dashboard:
- `GITHUB_TOKEN`: Your GitHub Personal Access Token (optional, for live analysis)

## 🎯 Demo

Live demo: [Coming Soon]

Demo repositories:
- shadcn/ui
- honojs/hono
- drizzle-team/drizzle-orm

## 📝 Architecture

Atlas uses a 4-agent pipeline to transform GitHub repositories into visualizations:

1. **Repo Ingester**: Fetches repository data from GitHub API
2. **Structure Parser**: Extracts code structure, dependencies, and metrics
3. **Layout Engine**: Positions nodes using D3.js force-directed layout
4. **Annotator**: Highlights important nodes and adds labels

See `bob_sessions/01-plan/architecture.md` for detailed architecture documentation.

## 🤝 Contributing

This project was built for the IBM Bob Hackathon 2026. Contributions are welcome!

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- IBM Bob AI for development assistance
- Cloudflare for hosting infrastructure
- D3.js community for visualization tools
- GitHub for API access

---

Built with ❤️ using IBM Bob AI
