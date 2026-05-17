import { useEffect, useRef, useState } from 'react';
import type { AnnotatedLayout } from '../types';
import { renderCityMap, type CityMapHandle } from '../lib/d3-renderer';

interface CityMapProps {
  layout: AnnotatedLayout;
  onSvgReady?: (svg: SVGSVGElement | null) => void;
}

export function CityMap({ layout, onSvgReady }: CityMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<CityMapHandle | null>(null);
  const [dimensions, setDimensions] = useState({ width: 1200, height: 800 });

  // Expose SVG element to parent
  useEffect(() => {
    if (onSvgReady) {
      onSvgReady(svgRef.current);
    }
  }, [onSvgReady]);

  // Handle resize
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({
          width: Math.max(width, 800),
          height: Math.max(height, 600),
        });
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Render D3 visualization
  useEffect(() => {
    if (!svgRef.current || !layout) return;

    try {
      handleRef.current = renderCityMap(svgRef.current, layout, {
        width: dimensions.width,
        height: dimensions.height,
      });
    } catch (error) {
      console.error('Failed to render city map:', error);
    }
  }, [layout, dimensions]);

  return (
    <div
      ref={containerRef}
      className="w-full flex-1 min-h-0 relative bg-slate-950 rounded-lg overflow-hidden border border-slate-800"
    >
      <svg
        ref={svgRef}
        className="w-full h-full"
        style={{
          shapeRendering: 'geometricPrecision',
        }}
      />

      {/* Zoom controls */}
      <div className="absolute top-4 right-4 flex flex-col gap-1 bg-slate-900/80 backdrop-blur-sm rounded-lg border border-slate-700 shadow-lg p-1 z-10">
        <button
          onClick={() => handleRef.current?.zoomIn()}
          className="w-9 h-9 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors"
          aria-label="Zoom in"
          title="Zoom in"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12m6-6H6" />
          </svg>
        </button>
        <button
          onClick={() => handleRef.current?.zoomOut()}
          className="w-9 h-9 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors"
          aria-label="Zoom out"
          title="Zoom out"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 12H6" />
          </svg>
        </button>
        <div className="w-full h-px bg-slate-700 my-0.5" />
        <button
          onClick={() => handleRef.current?.reset()}
          className="w-9 h-9 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors"
          aria-label="Reset view"
          title="Reset view"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h6m-6 0v6m0-6l7 7m9 1v-6m0 6h-6m6 0l-7-7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// Made with Bob
