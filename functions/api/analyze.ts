/**
 * POST /api/analyze
 *
 * Main API endpoint for repository analysis.
 * Implements the complete agent pipeline:
 * - Agent 1: Repo Ingester
 * - Agent 2: Structure Parser
 * - Agent 3: Layout Engine
 * - Agent 4: Annotator
 */

import { ingestRepo } from '../lib/agents/ingester';
import { parseStructure, type ParserInput } from '../lib/agents/parser';
import { generateLayout, selectRenderableEdges, type LayoutConfig } from '../lib/agents/layout';
import { annotateLayout } from '../lib/agents/annotator';
import type { AnnotatedLayout, CodeStructure, Env, IngesterInput, LayoutMeta, RepoManifest } from '../lib/types';

interface AnalyzeRequestBody {
  owner: string;
  repo: string;
  branch?: string;
}

/**
 * Owner and repository names, as GitHub itself defines them.
 *
 * The browser already validates this, but a request does not have to come from
 * the browser. Checking here rejects junk before it costs a GitHub call, and
 * keeps anything strange out of the API path in the first place.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_OWNER_LENGTH = 39;
const MAX_REPO_LENGTH = 100;
const MAX_BRANCH_LENGTH = 255;

/**
 * Origins allowed to read this endpoint from a browser.
 *
 * It used to answer `Access-Control-Allow-Origin: *`, which let any page on
 * the internet drive this site's GitHub token from a visitor's browser. The
 * endpoint is only ever called same-origin by the app itself, so nothing is
 * lost by reflecting a known origin instead. Requests without an `Origin`
 * header, which is every server side caller including the cache generator,
 * are unaffected: CORS is a browser mechanism and this only changes what a
 * browser is permitted to read.
 */
function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;

  try {
    const url = new URL(origin);
    const host = url.hostname;
    const secure = url.protocol === 'https:';
    const local = url.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1');

    if (local) return origin;
    if (!secure) return null;
    // The custom domain, its www form, and any pages.dev deployment of this
    // project, which covers preview builds on their generated hostnames.
    if (host === 'atlascity.dev' || host === 'www.atlascity.dev') return origin;
    if (host === 'atlas-1q0.pages.dev' || host.endsWith('.atlas-1q0.pages.dev')) return origin;
    return null;
  } catch {
    return null;
  }
}

function corsHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };

  const origin = allowedOrigin(request);
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

/**
 * Handle OPTIONS preflight request
 */
function handleOptions(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

/**
 * Cloudflare Functions handler
 */
export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const CORS_HEADERS = corsHeaders(context.request);

  try {
    // Parse request body
    const body = await context.request.json() as AnalyzeRequestBody;

    // Validate input
    const validationError = validateTarget(body);
    if (validationError) {
      return new Response(
        JSON.stringify({ error: { code: 'INVALID_INPUT', message: validationError } }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    if (!body.owner || !body.repo) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'INVALID_INPUT',
            message: 'Missing required fields: owner and repo',
          },
        }),
        {
          status: 400,
          headers: CORS_HEADERS,
        }
      );
    }

    // Agent 1: Repo Ingester. No credential: the archive is public.
    const ingesterInput: IngesterInput = {
      owner: body.owner,
      repo: body.repo,
      branch: body.branch,
    };

    const ingesterResult = await ingestRepo(ingesterInput);

    if (!ingesterResult.success) {
      // Map agent error codes to HTTP status codes
      const statusCode = getStatusCodeForError(ingesterResult.error.code);
      return new Response(
        JSON.stringify({ error: publicError(ingesterResult.error) }),
        {
          status: statusCode,
          headers: CORS_HEADERS,
        }
      );
    }

    // Agent 2: Structure Parser. Fetches nothing; the ingester already read it.
    const parserInput: ParserInput = {
      tree: ingesterResult.data.tree,
      contents: ingesterResult.data.contents,
    };

    const parserResult = await parseStructure(parserInput);

    if (!parserResult.success) {
      const statusCode = getStatusCodeForError(parserResult.error.code);
      return new Response(
        JSON.stringify({ error: publicError(parserResult.error) }),
        {
          status: statusCode,
          headers: CORS_HEADERS,
        }
      );
    }

    // Agent 3: Layout Engine
    const layoutConfig: LayoutConfig = {
      canvasWidth: 1920,
      canvasHeight: 1080,
      maxNodes: 500
    };

    const layoutResult = await generateLayout(parserResult.data, layoutConfig);

    if (!layoutResult.success) {
      const statusCode = getStatusCodeForError(layoutResult.error.code);
      return new Response(
        JSON.stringify({ error: publicError(layoutResult.error) }),
        {
          status: statusCode,
          headers: CORS_HEADERS,
        }
      );
    }

    // Agent 4: Annotator
    const annotatedResult = await annotateLayout(layoutResult.data, parserResult.data);

    if (!annotatedResult.success) {
      const statusCode = getStatusCodeForError(annotatedResult.error.code);
      return new Response(
        JSON.stringify({ error: publicError(annotatedResult.error) }),
        {
          status: statusCode,
          headers: CORS_HEADERS,
        }
      );
    }

    // Attach repository statistics for the UI
    const layout: AnnotatedLayout = {
      ...annotatedResult.data,
      meta: buildLayoutMeta(
        ingesterResult.data,
        parserResult.data,
        annotatedResult.data
      ),
    };

    // Return Agent 4 output (AnnotatedLayout) - complete pipeline
    return new Response(
      JSON.stringify(layout),
      {
        status: 200,
        headers: CORS_HEADERS,
      }
    );

  } catch (error) {
    console.error('Unexpected error in /api/analyze:', error);
    
    return new Response(
      JSON.stringify({
        // Deliberately no `details`. The message goes to the log, not to the
        // caller: internal error text tells an attacker about the shape of the
        // system and helps nobody who is using the site.
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      }),
      {
        status: 500,
        headers: CORS_HEADERS,
      }
    );
  }
}

/**
 * Handle OPTIONS preflight for CORS
 */
export async function onRequestOptions(context: { request: Request }): Promise<Response> {
  return handleOptions(context.request);
}

/**
 * Build the repository statistics that travel with a layout.
 *
 * Counts come from the manifest and the parser, so they describe the whole
 * repository rather than the subset that survived node selection.
 *
 * @param manifest Agent 1 output
 * @param structure Agent 2 output
 * @param layout Agent 4 output
 * @returns Populated LayoutMeta
 */
function buildLayoutMeta(
  manifest: RepoManifest,
  structure: CodeStructure,
  layout: AnnotatedLayout
): LayoutMeta {
  const nodeIds = new Set(layout.nodes.map(node => node.id));
  const edgeSelection = selectRenderableEdges(structure.dependencies, nodeIds);

  return {
    owner: manifest.metadata.owner,
    repo: manifest.metadata.repo,
    branch: manifest.metadata.branch,
    commitSha: manifest.metadata.commitSha,
    truncated: manifest.metadata.truncated === true,
    totalFiles: structure.files.length,
    renderedNodes: layout.nodes.length,
    totalLOC: structure.metrics.totalLOC,
    languageBreakdown: structure.metrics.languageBreakdown,
    edgeCount: layout.edges.length,
    droppedEdges: edgeSelection.dropped,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Map agent error codes to HTTP status codes
 */
function getStatusCodeForError(code: string): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'RATE_LIMIT':
    case 'AUTH_FAILED':
      return 403;
    case 'INVALID_INPUT':
      return 400;
    case 'REPO_TOO_LARGE':
      return 413; // Payload Too Large
    case 'SERVER_ERROR':
      return 502; // Bad Gateway
    default:
      return 500;
  }
}

// Made with Bob

/**
 * Reject a malformed target before it reaches GitHub.
 *
 * @param body Parsed request body
 * @returns A human readable reason, or null when the target looks sane
 */
function validateTarget(body: AnalyzeRequestBody): string | null {
  const { owner, repo, branch } = body ?? ({} as AnalyzeRequestBody);

  if (typeof owner !== 'string' || typeof repo !== 'string') {
    return 'owner and repo must be strings';
  }
  if (owner.length === 0 || repo.length === 0) {
    return 'Missing required fields: owner and repo';
  }
  if (owner.length > MAX_OWNER_LENGTH || repo.length > MAX_REPO_LENGTH) {
    return 'owner or repo is longer than GitHub allows';
  }
  if (!SEGMENT.test(owner) || !SEGMENT.test(repo)) {
    return 'owner and repo may only contain letters, digits, dot, dash and underscore';
  }
  if (branch !== undefined) {
    if (typeof branch !== 'string' || branch.length === 0 || branch.length > MAX_BRANCH_LENGTH) {
      return 'branch must be a short non empty string';
    }
    if (/[\s~^:?*\[\\]/.test(branch) || branch.includes('..')) {
      return 'branch contains characters git does not allow in a ref';
    }
  }

  return null;
}

/**
 * Strip an agent error down to what a caller should see.
 *
 * The agents attach a `details` field for debugging, and the ingester puts the
 * whole caught error object in it. Handing that to any caller describes the
 * internals of the system to somebody probing it and helps nobody who is just
 * using the site. The code and the message are enough to act on; the rest goes
 * to the log.
 *
 * @param error Agent error, possibly carrying internal detail
 * @returns The same error with `details` removed
 */
function publicError(error: { code: string; message: string; details?: unknown }): {
  code: string;
  message: string;
} {
  if (error.details !== undefined) {
    console.warn(`[analyze] ${error.code}: ${error.message}`, error.details);
  }
  return { code: error.code, message: error.message };
}
