/**
 * Pre-render the demo repositories into public/cache/.
 *
 * Runs the full agent pipeline in this process, so no wrangler dev server is
 * needed. The GitHub token is read from .dev.vars (gitignored) or from the
 * GITHUB_TOKEN environment variable, and is never printed.
 *
 *   pnpm tsx scripts/cache-repos.ts                    # all demo repos
 *   pnpm tsx scripts/cache-repos.ts honojs/hono        # one repo
 *   pnpm tsx scripts/cache-repos.ts honojs/hono#next   # one repo, explicit branch
 *
 * When no local token is available, the same pipeline can be driven through a
 * deployed instance, which holds its own token in the Cloudflare environment:
 *
 *   pnpm tsx scripts/cache-repos.ts --via https://atlas-1q0.pages.dev
 *
 * That mode maps whatever code is deployed at that URL, so deploy first and
 * regenerate second, or the cache will be built by the previous pipeline.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createGitHubClient } from '../functions/lib/github-client';
import { ingestRepo } from '../functions/lib/agents/ingester';
import { parseStructure } from '../functions/lib/agents/parser';
import { generateLayout, selectRenderableEdges } from '../functions/lib/agents/layout';
import { annotateLayout } from '../functions/lib/agents/annotator';
import type { AnnotatedLayout, LayoutMeta } from '../src/types/index';

interface RepoTarget {
  owner: string;
  repo: string;
  branch?: string;
}

/** Where the pipeline actually runs for this invocation. */
type Source =
  | { kind: 'local'; token: string }
  | { kind: 'remote'; baseUrl: string };

const DEMO_REPOS: RepoTarget[] = [
  { owner: 'shadcn-ui', repo: 'ui', branch: 'main' },
  { owner: 'honojs', repo: 'hono', branch: 'main' },
  { owner: 'drizzle-team', repo: 'drizzle-orm', branch: 'main' },
];

const CACHE_DIR = join(process.cwd(), 'public', 'cache');
const DEV_VARS_PATH = join(process.cwd(), '.dev.vars');

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const MAX_NODES = 500;

/**
 * Read a single key from a .dev.vars style KEY=value file.
 * The value is returned to the caller and never logged.
 *
 * @param path Path to the file
 * @param key Key to look up
 * @returns The value, or null when the file or key is missing
 */
function readDevVar(path: string, key: string): string | null {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf-8');
  } catch {
    return null;
  }

  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }

    const separator = line.indexOf('=');
    if (separator === -1) {
      continue;
    }

    if (line.slice(0, separator).trim() !== key) {
      continue;
    }

    const value = line.slice(separator + 1).trim();
    const unquoted = value.replace(/^["']/, '').replace(/["']$/, '');
    return unquoted === '' ? null : unquoted;
  }

  return null;
}

/**
 * Parse a CLI argument of the form `owner/repo` or `owner/repo#branch`
 *
 * @param argument Raw command line argument
 * @returns Repo target, or null when the argument is malformed
 */
function parseRepoArgument(argument: string): RepoTarget | null {
  const [coordinates, branch] = argument.split('#');
  const [owner, repo] = coordinates.split('/');

  if (!owner || !repo) {
    return null;
  }

  return { owner, repo, branch: branch || undefined };
}

/**
 * Drive a deployed instance instead of running the pipeline here.
 *
 * Useful when there is no usable local token, since the deployment holds its
 * own in the Cloudflare environment. The result is only as current as the code
 * running at that URL.
 *
 * @param target Repository coordinates
 * @param baseUrl Origin of the deployment, with no trailing path
 * @returns Annotated layout exactly as the deployment produced it
 */
async function analyzeRemotely(target: RepoTarget, baseUrl: string): Promise<AnnotatedLayout> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner: target.owner, repo: target.repo, branch: target.branch }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Remote analyze failed: ${response.status} ${body.slice(0, 300)}`);
  }

  const layout = (await response.json()) as AnnotatedLayout;
  if (!Array.isArray(layout?.nodes)) {
    throw new Error('Remote analyze returned a payload without a nodes array');
  }

  return layout;
}

/**
 * Run the four agent pipeline for one repository
 *
 * @param target Repository coordinates
 * @param token GitHub personal access token
 * @returns Annotated layout with repository statistics attached
 */
async function analyzeRepo(target: RepoTarget, token: string): Promise<AnnotatedLayout> {
  const octokit = createGitHubClient(token);

  const ingesterResult = await ingestRepo(
    { owner: target.owner, repo: target.repo, branch: target.branch },
    octokit
  );
  if (!ingesterResult.success) {
    throw new Error(`Ingester failed: ${ingesterResult.error.code} ${ingesterResult.error.message}`);
  }

  const parserResult = await parseStructure(
    { tree: ingesterResult.data.tree, owner: target.owner, repo: target.repo },
    octokit
  );
  if (!parserResult.success) {
    throw new Error(`Parser failed: ${parserResult.error.code} ${parserResult.error.message}`);
  }

  const layoutResult = await generateLayout(parserResult.data, {
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: CANVAS_HEIGHT,
    maxNodes: MAX_NODES,
  });
  if (!layoutResult.success) {
    throw new Error(`Layout failed: ${layoutResult.error.code} ${layoutResult.error.message}`);
  }

  const annotatedResult = await annotateLayout(layoutResult.data, parserResult.data);
  if (!annotatedResult.success) {
    throw new Error(`Annotator failed: ${annotatedResult.error.code} ${annotatedResult.error.message}`);
  }

  const nodeIds = new Set(annotatedResult.data.nodes.map(node => node.id));
  const edgeSelection = selectRenderableEdges(parserResult.data.dependencies, nodeIds);

  const meta: LayoutMeta = {
    owner: ingesterResult.data.metadata.owner,
    repo: ingesterResult.data.metadata.repo,
    branch: ingesterResult.data.metadata.branch,
    description: ingesterResult.data.metadata.description,
    stars: ingesterResult.data.metadata.stars,
    lastCommitDate: ingesterResult.data.metadata.lastCommitDate,
    totalFiles: parserResult.data.files.length,
    renderedNodes: annotatedResult.data.nodes.length,
    totalLOC: parserResult.data.metrics.totalLOC,
    languageBreakdown: parserResult.data.metrics.languageBreakdown,
    edgeCount: annotatedResult.data.edges.length,
    droppedEdges: edgeSelection.dropped,
    generatedAt: new Date().toISOString(),
  };

  return { ...annotatedResult.data, meta };
}

/**
 * Count highlights by type
 */
function countHighlights(layout: AnnotatedLayout): Record<string, number> {
  const counts: Record<string, number> = { entry: 0, core: 0, hotspot: 0 };

  for (const highlight of layout.highlights) {
    counts[highlight.type] = (counts[highlight.type] ?? 0) + 1;
  }

  return counts;
}

/**
 * Analyze one repository and write its cache file
 *
 * @param target Repository coordinates
 * @param source Where the pipeline runs: in this process, or in a deployment
 */
async function cacheRepo(target: RepoTarget, source: Source): Promise<void> {
  const label = `${target.owner}/${target.repo}`;
  console.log(`\nAnalyzing ${label} ...`);

  const started = Date.now();
  const layout =
    source.kind === 'remote'
      ? await analyzeRemotely(target, source.baseUrl)
      : await analyzeRepo(target, source.token);
  const elapsedSeconds = ((Date.now() - started) / 1000).toFixed(1);

  const filename = `${target.owner}-${target.repo}.json`;
  const filepath = join(CACHE_DIR, filename);
  const json = JSON.stringify(layout, null, 2);

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(filepath, json);

  const counts = countHighlights(layout);
  const meta = layout.meta;

  console.log(`  nodes       ${layout.nodes.length}`);
  console.log(`  edges       ${layout.edges.length} (dropped ${meta?.droppedEdges ?? 0})`);
  console.log(`  districts   ${layout.districts.length}`);
  console.log(`  highlights  entry ${counts.entry} / core ${counts.core} / hotspot ${counts.hotspot}`);
  console.log(`  labels      ${layout.labels.length}`);
  console.log(`  repo        ${meta?.totalFiles ?? 0} files, ${meta?.totalLOC ?? 0} LOC`);
  console.log(`  wrote       public/cache/${filename} (${Math.round(json.length / 1024)} KB, ${elapsedSeconds}s)`);
}

/**
 * Entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targets: RepoTarget[] = [];
  let baseUrl: string | null = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--via') {
      baseUrl = args[i + 1] ?? null;
      i += 1;
      if (!baseUrl) {
        console.error('--via needs a URL, for example --via https://atlas-1q0.pages.dev');
        process.exit(1);
      }
      continue;
    }

    const target = parseRepoArgument(arg);
    if (!target) {
      console.error(`Skipping malformed argument: ${arg} (expected owner/repo)`);
      continue;
    }
    targets.push(target);
  }

  let source: Source;
  if (baseUrl) {
    source = { kind: 'remote', baseUrl };
  } else {
    const token = readDevVar(DEV_VARS_PATH, 'GITHUB_TOKEN') || process.env.GITHUB_TOKEN || '';
    if (!token) {
      console.error('GITHUB_TOKEN not found.');
      console.error('Add it to .dev.vars as GITHUB_TOKEN=... or export it in the environment,');
      console.error('or drive a deployment instead: --via https://atlas-1q0.pages.dev');
      process.exit(1);
    }
    source = { kind: 'local', token };
  }

  const selected = targets.length > 0 ? targets : DEMO_REPOS;

  console.log('Atlas cache generation');
  console.log(`Pipeline: ${source.kind === 'remote' ? source.baseUrl : 'in process'}`);
  console.log(`Repositories: ${selected.map(t => `${t.owner}/${t.repo}`).join(', ')}`);
  console.log(`Cache directory: ${CACHE_DIR}`);

  let successCount = 0;
  let failCount = 0;

  for (const target of selected) {
    try {
      await cacheRepo(target, source);
      successCount += 1;
    } catch (error) {
      failCount += 1;
      console.error(`Failed to cache ${target.owner}/${target.repo}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(`\nCached ${successCount}, failed ${failCount}`);

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
