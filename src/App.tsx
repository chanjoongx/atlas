import { useState } from 'react';
import type { AnnotatedLayout } from './types';
import { fetchAnnotatedLayout, ApiError } from './lib/api-client';
import { RepoInput } from './components/RepoInput';
import { CityMap } from './components/CityMap';
import { ExportButton } from './components/ExportButton';
import { LoadingState } from './components/LoadingState';

function App() {
  const [layout, setLayout] = useState<AnnotatedLayout | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [svgElement, setSvgElement] = useState<SVGSVGElement | null>(null);

  const handleAnalyze = async (owner: string, repo: string) => {
    setLoading(true);
    setError(null);
    setLayout(null);
    setSelectedRepo(`${owner}/${repo}`);

    try {
      const result = await fetchAnnotatedLayout(owner, repo);
      setLayout(result);
    } catch (err) {
      const errorMessage =
        err instanceof ApiError
          ? err.message
          : 'Failed to analyze repository. Please try again.';
      setError(errorMessage);
      console.error('Analysis failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                  />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold">Atlas</h1>
                <p className="text-sm text-slate-400">
                  One repo. One image. Grok in 30 seconds.
                </p>
              </div>
            </div>
            {layout && svgElement && (
              <ExportButton
                svgElement={svgElement}
                disabled={loading}
                repoName={selectedRepo || undefined}
              />
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-0 container mx-auto px-4 py-4">
        <div className="flex flex-col gap-4">
          {/* Input Section */}
          {!layout && !loading && (
            <div className="flex-1 flex flex-col items-center justify-center gap-6">
              <div className="text-center max-w-2xl">
                <h2 className="text-3xl font-bold mb-4">
                  Visualize Your Codebase
                </h2>
                <p className="text-slate-400 text-lg">
                  Transform any GitHub repository into an interactive city map.
                  See your code's architecture at a glance.
                </p>
              </div>
              <RepoInput onAnalyze={handleAnalyze} loading={loading} />
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 flex items-start gap-3">
              <svg
                className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div className="flex-1">
                <h3 className="font-medium text-red-400">Analysis Failed</h3>
                <p className="text-sm text-red-300 mt-1">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="text-red-400 hover:text-red-300"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="flex-1 flex items-center justify-center">
              <LoadingState />
            </div>
          )}

          {/* City Map */}
          {layout && !loading && (
            <div className="flex-1 flex flex-col gap-2 min-h-0">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold">{selectedRepo}</h2>
                  <p className="text-sm text-slate-400">
                    {layout.nodes.length} files • {layout.districts.length} districts
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setLayout(null);
                      setSelectedRepo(null);
                    }}
                    className="px-4 py-2 text-slate-400 hover:text-slate-300 transition-colors"
                  >
                    Analyze Another
                  </button>
                </div>
              </div>
              <CityMap layout={layout} onSvgReady={setSvgElement} />
              <div className="text-sm text-slate-500 text-center">
                <p>💡 Drag to pan • Scroll to zoom • Hover nodes for details</p>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="flex-shrink-0 border-t border-slate-800">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between text-sm text-slate-500">
            <p>Built with IBM Bob • May 2026</p>
            <a
              href="https://github.com/chanjoongx/atlas"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 hover:text-slate-400 transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path
                  fillRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                  clipRule="evenodd"
                />
              </svg>
              View on GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;

// Made with Bob
