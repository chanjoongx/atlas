import type { AnnotatedLayout } from '../types';

export interface AnalyzeRequest {
  owner: string;
  repo: string;
  branch?: string;
}

// Backend returns raw AnnotatedLayout, not wrapped
// Keeping interface for reference but not using it
export interface AnalyzeResponse {
  layout: AnnotatedLayout;
  cached: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Fetch annotated layout for a repository.
 * Tries pre-cached JSON first, falls back to API analyze endpoint.
 */
export async function fetchAnnotatedLayout(
  owner: string,
  repo: string,
  branch?: string
): Promise<AnnotatedLayout> {
  // Try cache first (faster, no API call)
  const cacheKey = `${owner}-${repo}`;
  try {
    const cacheResponse = await fetch(`/cache/${cacheKey}.json`);
    if (cacheResponse.ok) {
      const data = await cacheResponse.json();
      console.log(`✓ Loaded from cache: ${cacheKey}`);
      return data as AnnotatedLayout;
    }
  } catch (error) {
    console.log(`Cache miss for ${cacheKey}, falling back to API`);
  }

  // Fallback to API analyze endpoint
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        owner,
        repo,
        branch: branch || 'main',
      } as AnalyzeRequest),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new ApiError(
        errorData.error || `API request failed: ${response.statusText}`,
        response.status,
        errorData
      );
    }

    const data = await response.json();
    console.log(`✓ Analyzed via API: ${owner}/${repo}`);
    return data as AnnotatedLayout;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      `Failed to fetch layout: ${error instanceof Error ? error.message : 'Unknown error'}`,
      undefined,
      error
    );
  }
}

// Made with Bob
