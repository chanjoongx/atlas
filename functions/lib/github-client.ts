import { Octokit } from '@octokit/rest';

/**
 * Cloudflare Functions environment interface
 * Contains secrets and environment variables
 */
export interface Env {
  GITHUB_TOKEN: string;
}

/**
 * Create an authenticated Octokit instance
 * @param token GitHub personal access token
 * @returns Configured Octokit REST client
 */
export function createGitHubClient(token: string): Octokit {
  return new Octokit({
    auth: token,
    userAgent: 'atlas-repo-visualizer/1.0.0',
    timeZone: 'UTC',
  });
}

/**
 * Create Octokit instance from Cloudflare Functions environment
 * @param env Cloudflare Functions Env object
 * @returns Configured Octokit REST client
 */
export function createGitHubClientFromEnv(env: Env): Octokit {
  if (!env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN not found in environment');
  }
  return createGitHubClient(env.GITHUB_TOKEN);
}

// Made with Bob
