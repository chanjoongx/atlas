/**
 * POST /api/analyze
 *
 * Main API endpoint for repository analysis.
 * Implements Agent 1 (Repo Ingester), Agent 2 (Structure Parser), and Agent 3 (Layout Engine).
 * Future phase will add Agent 4 (Annotator) to the pipeline.
 */

import { createGitHubClientFromEnv, type Env } from '../lib/github-client';
import { ingestRepo } from '../lib/agents/ingester';
import { parseStructure, type ParserInput } from '../lib/agents/parser';
import { generateLayout, type LayoutConfig } from '../lib/agents/layout';
import type { IngesterInput } from '../lib/types';

interface AnalyzeRequestBody {
  owner: string;
  repo: string;
  branch?: string;
}

/**
 * CORS headers for browser requests
 * Allows localhost development and Cloudflare Pages deployment
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

/**
 * Handle OPTIONS preflight request
 */
function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

/**
 * Cloudflare Functions handler
 */
export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  try {
    // Parse request body
    const body = await context.request.json() as AnalyzeRequestBody;

    // Validate input
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

    // Create GitHub client
    const octokit = createGitHubClientFromEnv(context.env);

    // Agent 1: Repo Ingester
    const ingesterInput: IngesterInput = {
      owner: body.owner,
      repo: body.repo,
      branch: body.branch,
    };

    const ingesterResult = await ingestRepo(ingesterInput, octokit);

    if (!ingesterResult.success) {
      // Map agent error codes to HTTP status codes
      const statusCode = getStatusCodeForError(ingesterResult.error.code);
      return new Response(
        JSON.stringify({ error: ingesterResult.error }),
        {
          status: statusCode,
          headers: CORS_HEADERS,
        }
      );
    }

    // Agent 2: Structure Parser
    const parserInput: ParserInput = {
      tree: ingesterResult.data.tree,
      owner: body.owner,
      repo: body.repo,
    };

    const parserResult = await parseStructure(parserInput, octokit);

    if (!parserResult.success) {
      const statusCode = getStatusCodeForError(parserResult.error.code);
      return new Response(
        JSON.stringify({ error: parserResult.error }),
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
        JSON.stringify({ error: layoutResult.error }),
        {
          status: statusCode,
          headers: CORS_HEADERS,
        }
      );
    }

    // TODO: Agent 4 - Annotator (Phase 6)
    // const annotatedResult = await annotateLayout(layoutResult.data);

    // Return Agent 3 output (LayoutData)
    return new Response(
      JSON.stringify(layoutResult.data),
      {
        status: 200,
        headers: CORS_HEADERS,
      }
    );

  } catch (error) {
    console.error('Unexpected error in /api/analyze:', error);
    
    return new Response(
      JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          details: error instanceof Error ? error.message : 'Unknown error',
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
export async function onRequestOptions(): Promise<Response> {
  return handleOptions();
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
