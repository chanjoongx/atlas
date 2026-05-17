import type { Octokit } from '@octokit/rest';
import type { IngesterInput, RepoManifest, FileNode, AgentResult, AgentError } from '../types';
import { BINARY_EXTENSIONS, EXCLUDED_DIRS } from '../types';

/**
 * Agent 1: Repo Ingester
 * 
 * Fetches repository metadata and file tree from GitHub API.
 * Uses Tree API with recursive=1 for efficient single-request fetch.
 * 
 * @param input Repository coordinates (owner, repo, optional branch)
 * @param octokit Authenticated Octokit client
 * @returns RepoManifest with metadata and filtered file tree
 */
export async function ingestRepo(
  input: IngesterInput,
  octokit: Octokit
): Promise<AgentResult<RepoManifest>> {
  try {
    // Validate input
    if (!input.owner || !input.repo) {
      return {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Owner and repo are required',
        },
      };
    }

    // Fetch repository metadata
    const repoResponse = await octokit.rest.repos.get({
      owner: input.owner,
      repo: input.repo,
    });

    const repo = repoResponse.data;
    const branch = input.branch || repo.default_branch;

    // Fetch latest commit on the branch to get tree SHA
    const branchResponse = await octokit.rest.repos.getBranch({
      owner: input.owner,
      repo: input.repo,
      branch,
    });

    const treeSha = branchResponse.data.commit.commit.tree.sha;

    // Fetch entire file tree recursively (single API call)
    const treeResponse = await octokit.rest.git.getTree({
      owner: input.owner,
      repo: input.repo,
      tree_sha: treeSha,
      recursive: 'true',
    });

    // Check if tree is truncated (>100k files)
    if (treeResponse.data.truncated) {
      return {
        success: false,
        error: {
          code: 'REPO_TOO_LARGE',
          message: 'Repository has more than 100,000 files. This is beyond MVP scope.',
          details: { fileCount: treeResponse.data.tree.length },
        },
      };
    }

    // Filter and transform tree
    const filteredTree = filterTree(treeResponse.data.tree);

    // Build manifest
    const manifest: RepoManifest = {
      metadata: {
        owner: input.owner,
        repo: input.repo,
        branch,
        defaultBranch: repo.default_branch,
        description: repo.description || '',
        stars: repo.stargazers_count,
        lastCommitDate: branchResponse.data.commit.commit.committer?.date || new Date().toISOString(),
      },
      tree: filteredTree,
    };

    return {
      success: true,
      data: manifest,
    };

  } catch (error: unknown) {
    return handleError(error);
  }
}

/**
 * Filter out excluded directories and binary files from tree
 */
function filterTree(tree: Array<{ path?: string; type?: string; size?: number; sha?: string }>): FileNode[] {
  return tree
    .filter((node) => {
      if (!node.path) return false;

      // Exclude specific directories
      const pathParts = node.path.split('/');
      for (const dir of EXCLUDED_DIRS) {
        if (pathParts.includes(dir)) {
          return false;
        }
      }

      // Exclude binary files
      const ext = getFileExtension(node.path);
      if (ext && BINARY_EXTENSIONS.includes(ext as any)) {
        return false;
      }

      return true;
    })
    .map((node) => ({
      path: node.path!,
      type: (node.type === 'tree' ? 'dir' : 'file') as 'file' | 'dir',
      size: node.size || 0,
      sha: node.sha || '',
    }));
}

/**
 * Extract file extension from path
 */
function getFileExtension(path: string): string | null {
  const match = path.match(/\.([^.]+)$/);
  return match ? `.${match[1].toLowerCase()}` : null;
}

/**
 * Convert API errors to typed AgentError
 */
function handleError(error: unknown): AgentResult<never> {
  // Handle Octokit RequestError
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status;
    const message = (error as { message?: string }).message || 'Unknown error';

    if (status === 404) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Repository not found or not accessible',
          details: { originalMessage: message },
        },
      };
    }

    if (status === 403) {
      return {
        success: false,
        error: {
          code: 'RATE_LIMIT',
          message: 'GitHub API rate limit exceeded or authentication failed',
          details: { originalMessage: message },
        },
      };
    }

    if (status >= 500) {
      return {
        success: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'GitHub API server error',
          details: { status, originalMessage: message },
        },
      };
    }
  }

  // Generic error fallback
  return {
    success: false,
    error: {
      code: 'UNKNOWN',
      message: error instanceof Error ? error.message : 'An unknown error occurred',
      details: error,
    },
  };
}

// Made with Bob
