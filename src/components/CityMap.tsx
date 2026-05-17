import { useEffect, useRef, useState } from 'react';
import type { AnnotatedLayout } from '../types';
import { renderCityMap } from '../lib/d3-renderer';

interface CityMapProps {
  layout: AnnotatedLayout;
  onSvgReady?: (svg: SVGSVGElement | null) => void;
}

export function CityMap({ layout, onSvgReady }: CityMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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
      renderCityMap(svgRef.current, layout, {
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
      className="w-full min-h-[80vh] bg-slate-950 rounded-lg overflow-hidden border border-slate-800"
    >
      <svg
        ref={svgRef}
        className="w-full h-full"
        style={{
          shapeRendering: 'geometricPrecision',
        }}
      />
    </div>
  );
}

// Made with Bob
