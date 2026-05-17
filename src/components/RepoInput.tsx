import { useState } from 'react';

interface DemoRepo {
  owner: string;
  repo: string;
  name: string;
  description: string;
}

const DEMO_REPOS: DemoRepo[] = [
  {
    owner: 'shadcn-ui',
    repo: 'ui',
    name: 'shadcn/ui',
    description: 'Beautifully designed components built with Radix UI and Tailwind CSS',
  },
  {
    owner: 'honojs',
    repo: 'hono',
    name: 'Hono',
    description: 'Fast, lightweight web framework for the Edge',
  },
  {
    owner: 'drizzle-team',
    repo: 'drizzle-orm',
    name: 'Drizzle ORM',
    description: 'TypeScript ORM that is production ready',
  },
];

interface RepoInputProps {
  onAnalyze: (owner: string, repo: string) => void;
  loading: boolean;
}

export function RepoInput({ onAnalyze, loading }: RepoInputProps) {
  const [selectedRepo, setSelectedRepo] = useState<DemoRepo | null>(null);

  const handleAnalyze = () => {
    if (selectedRepo) {
      onAnalyze(selectedRepo.owner, selectedRepo.repo);
    }
  };

  return (
    <div className="flex flex-col gap-4 w-full max-w-2xl">
      {/* Demo Repo Dropdown */}
      <div className="flex flex-col gap-2">
        <label htmlFor="repo-select" className="text-sm font-medium text-slate-300">
          Select a demo repository
        </label>
        <select
          id="repo-select"
          value={selectedRepo ? `${selectedRepo.owner}/${selectedRepo.repo}` : ''}
          onChange={(e) => {
            const [owner, repo] = e.target.value.split('/');
            const found = DEMO_REPOS.find((r) => r.owner === owner && r.repo === repo);
            setSelectedRepo(found || null);
          }}
          className="px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          disabled={loading}
        >
          <option value="">Choose a repository...</option>
          {DEMO_REPOS.map((repo) => (
            <option key={`${repo.owner}/${repo.repo}`} value={`${repo.owner}/${repo.repo}`}>
              {repo.name} - {repo.description}
            </option>
          ))}
        </select>
      </div>

      {/* Custom Repo Input (Disabled for MVP) */}
      <div className="flex flex-col gap-2 opacity-50">
        <label htmlFor="custom-repo" className="text-sm font-medium text-slate-300">
          Or enter a custom repository
        </label>
        <div className="relative">
          <input
            id="custom-repo"
            type="text"
            placeholder="owner/repo"
            className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-not-allowed"
            disabled
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 bg-slate-900 px-2 py-1 rounded">
            Coming in v2
          </div>
        </div>
      </div>

      {/* Analyze Button */}
      <button
        onClick={handleAnalyze}
        disabled={!selectedRepo || loading}
        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-950"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg
              className="animate-spin h-5 w-5"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Analyzing...
          </span>
        ) : (
          'Generate City Map'
        )}
      </button>
    </div>
  );
}

// Made with Bob
