import { AlertTriangle, RefreshCw } from 'lucide-react';
import { ApiError } from '../lib/api-client';

interface ErrorStateProps {
  error: unknown;
  repo: string | null;
  onRetry: () => void;
  onDismiss: () => void;
}

interface Explanation {
  title: string;
  body: string;
  retry: boolean;
}

/**
 * Error copy that tells the visitor what to do next. A raw status code helps
 * nobody, and "something went wrong" helps them slightly less.
 */
function explain(error: unknown, repo: string | null): Explanation {
  const name = repo ?? 'that repository';

  if (error instanceof ApiError) {
    switch (error.status) {
      case 404:
        return {
          title: 'No public repository there',
          body: `GitHub has nothing public at ${name}. Check the spelling, and note that private repositories cannot be mapped.`,
          retry: false,
        };
      case 403:
        return {
          title: 'GitHub turned the request away',
          body: 'The API quota for this site is exhausted or the access token needs renewing. The three prebuilt demos still work, and custom repositories should recover shortly.',
          retry: true,
        };
      case 413:
        return {
          title: 'That repository is too large',
          body: `${name} has more files than a single map can carry. Try a smaller repository, or a package inside a monorepo.`,
          retry: false,
        };
      case 400:
        return {
          title: 'The request was malformed',
          body: 'Atlas could not read that as an owner and repository pair.',
          retry: false,
        };
      default:
        return {
          title: 'The analysis failed',
          body:
            error.message ||
            'The pipeline stopped part way through. Trying again often clears it, since most failures here are transient.',
          retry: true,
        };
    }
  }

  return {
    title: 'Could not reach the analyzer',
    body: 'The request never completed. Check your connection and try again.',
    retry: true,
  };
}

export function ErrorState({ error, repo, onRetry, onDismiss }: ErrorStateProps) {
  const { title, body, retry } = explain(error, repo);

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
      <div className="surface animate-fade-up w-full max-w-md p-5" role="alert">
        <div className="flex gap-3">
          <span className="text-danger mt-0.5 shrink-0" aria-hidden>
            <AlertTriangle size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-primary text-sm font-semibold">{title}</h2>
            <p className="text-secondary mt-1.5 text-xs leading-relaxed">{body}</p>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          {retry && (
            <button type="button" onClick={onRetry} className="btn btn-primary">
              <RefreshCw size={14} aria-hidden />
              Try again
            </button>
          )}
          <button type="button" onClick={onDismiss} className="btn btn-secondary">
            Pick another repository
          </button>
        </div>
      </div>
    </div>
  );
}
