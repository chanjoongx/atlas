export function LoadingState() {
  return (
    <div className="w-full min-h-[80vh] bg-slate-950 rounded-lg overflow-hidden border border-slate-800 flex flex-col items-center justify-center gap-8 p-8">
      {/* Skeleton City Map */}
      <div className="relative w-full max-w-4xl h-96 bg-slate-900 rounded-lg overflow-hidden">
        {/* Animated shimmer effect */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-slate-800/20 to-transparent animate-shimmer" />
        
        {/* Placeholder "buildings" */}
        <div className="absolute inset-0 p-8 flex flex-wrap gap-4 content-start">
          {Array.from({ length: 24 }).map((_, i) => (
            <div
              key={i}
              className="bg-slate-800/50 rounded animate-pulse"
              style={{
                width: `${Math.random() * 60 + 40}px`,
                height: `${Math.random() * 60 + 40}px`,
                animationDelay: `${i * 0.05}s`,
              }}
            />
          ))}
        </div>

        {/* Placeholder districts */}
        <div className="absolute top-8 left-8 w-64 h-48 border-2 border-slate-700/30 rounded-lg animate-pulse" />
        <div className="absolute top-8 right-8 w-48 h-64 border-2 border-slate-700/30 rounded-lg animate-pulse" style={{ animationDelay: '0.2s' }} />
        <div className="absolute bottom-8 left-1/4 w-56 h-40 border-2 border-slate-700/30 rounded-lg animate-pulse" style={{ animationDelay: '0.4s' }} />
      </div>

      {/* Loading message */}
      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center gap-3">
          <svg
            className="animate-spin h-6 w-6 text-blue-500"
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
          <p className="text-xl font-medium text-slate-300">
            Generating your map...
          </p>
        </div>
        
        <p className="text-sm text-slate-500">
          Analyzing repository structure and dependencies
        </p>
      </div>

      {/* Progress indicators */}
      <div className="flex gap-2">
        {['Ingesting', 'Parsing', 'Layout', 'Annotating'].map((step, i) => (
          <div
            key={step}
            className="px-3 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-400 animate-pulse"
            style={{ animationDelay: `${i * 0.3}s` }}
          >
            {step}
          </div>
        ))}
      </div>
    </div>
  );
}

// Made with Bob
