import type { AnnotatedLayout } from '../types';
import type { RepoRef } from './repo-ref';

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string } | string;
}

/**
 * Fetch a layout for a repository.
 *
 * Demo repositories are pre-rendered into `public/cache` at build time and are
 * served as plain static JSON, which is why they open instantly and keep
 * working even when the GitHub token behind the live pipeline is unavailable.
 * Everything else goes through the four agent pipeline in `functions/api`.
 */
export async function fetchAnnotatedLayout(ref: RepoRef): Promise<AnnotatedLayout> {
  const cached = await readCache(ref);
  if (cached) return cached;

  let response: Response;
  try {
    response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: ref.owner, repo: ref.repo, branch: ref.branch }),
    });
  } catch (error) {
    throw new ApiError(
      'The analyzer could not be reached.',
      undefined,
      'NETWORK',
      error,
    );
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorBody;
    const detail = typeof body.error === 'object' ? body.error : undefined;
    throw new ApiError(
      detail?.message ?? (typeof body.error === 'string' ? body.error : response.statusText),
      response.status,
      detail?.code,
      body,
    );
  }

  return (await response.json()) as AnnotatedLayout;
}

/** A cache miss is the normal path for custom repositories, not an error. */
async function readCache(ref: RepoRef): Promise<AnnotatedLayout | null> {
  if (ref.branch) return null; // cached maps are of the default branch only
  try {
    const response = await fetch(`/cache/${ref.owner}-${ref.repo}.json`);
    if (!response.ok) return null;
    const data = (await response.json()) as AnnotatedLayout;
    return Array.isArray(data?.nodes) ? data : null;
  } catch {
    return null;
  }
}
