function App() {
  return (
    <div className="min-h-screen bg-city-dark flex items-center justify-center">
      <div className="text-center space-y-8 p-8">
        <div className="space-y-4">
          <h1 className="text-6xl font-bold text-white">
            Atlas
          </h1>
          <p className="text-2xl text-city-cyan">
            GitHub Repository Visualizer
          </p>
        </div>
        
        <div className="space-y-4 text-gray-300">
          <p className="text-lg">
            Transform any GitHub repository into an interactive city map
          </p>
          <div className="inline-block px-6 py-3 bg-city-slate rounded-lg border border-city-blue">
            <p className="text-city-amber font-mono">Coming Soon</p>
          </div>
        </div>

        <div className="pt-8 text-sm text-gray-500">
          <p>Built for IBM Bob Hackathon 2026</p>
          <p className="mt-2">Foundation Setup Complete ✓</p>
        </div>
      </div>
    </div>
  );
}

export default App;

// Made with Bob
