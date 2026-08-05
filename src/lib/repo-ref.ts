/**
 * Parsing whatever a visitor pastes into the repository field.
 *
 * People paste the browser URL far more often than they type `owner/repo`, and
 * that URL usually carries a branch, a deep path or a `.git` suffix. Rejecting
 * those is a bad first impression for a tool whose entire promise is speed.
 */

export interface RepoRef {
  owner: string;
  repo: string;
  /** Present when the input pointed at a specific branch or tag. */
  branch?: string;
}

/** GitHub's own rule: alphanumerics, hyphen, underscore and dot. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const NOISE = new Set(['tree', 'blob', 'commits', 'releases', 'issues', 'pulls', 'tags', 'wiki']);

/**
 * Longest input worth looking at.
 *
 * An owner and a repository top out around 140 characters together, and this
 * runs on whatever arrives in `?repo=`, which anyone can put in a link. The
 * trailing separator strip below is quadratic in a run of slashes, so a link
 * carrying a few hundred thousand of them froze the tab for seconds. Refusing
 * to look at anything that could not possibly be a repository is cheaper than
 * making every step linear.
 */
const MAX_INPUT_LENGTH = 400;

export function parseRepoRef(input: string): RepoRef | null {
  if (typeof input !== 'string' || input.length > MAX_INPUT_LENGTH) return null;

  let text = input.trim();
  if (!text) return null;

  // Strip a scheme, any host that looks like GitHub, and a leading slash.
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  text = text.replace(/^(?:www\.)?github\.com\//i, '');
  text = text.replace(/^git@github\.com:/i, '');
  text = text.replace(/^\/+/, '');
  text = text.replace(/[?#].*$/, '');
  text = text.replace(/\.git$/i, '');
  text = text.replace(/\/+$/, '');

  const parts = text.split('/').filter(Boolean);
  if (parts.length < 2) return null;

  const [owner, repo] = parts;
  if (!SEGMENT.test(owner) || !SEGMENT.test(repo)) return null;
  if (owner.length > 39 || repo.length > 100) return null;

  // `owner/repo/tree/some-branch` carries a ref we can honour.
  let branch: string | undefined;
  if (parts.length >= 4 && NOISE.has(parts[2].toLowerCase())) {
    const candidate = parts[3];
    if (SEGMENT.test(candidate)) branch = candidate;
  }

  return branch ? { owner, repo, branch } : { owner, repo };
}

export function formatRepoRef(ref: RepoRef): string {
  return `${ref.owner}/${ref.repo}`;
}
