import { useEffect, useRef } from 'react';
import type { ThemeName } from '../lib/palette';
import { createSkyline, type SkylineHandle } from '../lib/iso/skyline';

interface SkylineArtProps {
  theme: ThemeName;
  className?: string;
}

/**
 * The animated skyline above the fold.
 *
 * Purely decorative, so it is hidden from assistive technology and it stops
 * moving the moment it is not being looked at: off screen, or in a background
 * tab, or when the visitor has asked their system for less motion.
 */
export function SkylineArt({ theme, className }: SkylineArtProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const skylineRef = useRef<SkylineHandle | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    const skyline = createSkyline(canvas, theme, reduced);
    skylineRef.current = skyline;

    const observer = new IntersectionObserver(
      ([entry]) => skyline.setRunning(entry.isIntersecting),
      { threshold: 0.01 },
    );
    observer.observe(canvas);

    // Re-observing re-fires the callback, which re-applies whatever the
    // current visibility actually is instead of assuming it should resume.
    const onVisibility = () => {
      if (document.hidden) {
        skyline.setRunning(false);
      } else {
        observer.unobserve(canvas);
        observer.observe(canvas);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      skyline.destroy();
      skylineRef.current = null;
    };
    // The engine outlives theme changes; only a remount rebuilds the city.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    skylineRef.current?.setTheme(theme);
  }, [theme]);

  return <canvas ref={canvasRef} className={className} aria-hidden role="presentation" />;
}
