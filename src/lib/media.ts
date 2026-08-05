/**
 * Media queries the layout actually branches on, in one place.
 *
 * Several components need to know the same two facts, and they need to agree:
 * the map key hides at exactly the width the inspector stops being a takeover,
 * and a control that assumes a mouse has to know when there is not one. Written
 * out twice they drift, and the drift is invisible until a tablet lands
 * between the two values.
 */

import { useEffect, useState } from 'react';

/** Tailwind's `lg`. The key column appears here and the inspector stops covering. */
export const WIDE = '(min-width: 1024px)';

/** The primary pointer is a finger rather than a mouse. */
export const COARSE = '(pointer: coarse)';

/** One off read, for event handlers that need the answer now and not later. */
export function matchesMedia(query: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(query).matches;
}

/**
 * Live answer.
 *
 * Both queries genuinely change without a reload: a phone rotating crosses
 * `WIDE` in either direction on a tablet, and attaching a keyboard case changes
 * `COARSE`.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchesMedia(query));

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const list = matchMedia(query);
    const onChange = () => setMatches(list.matches);
    // Re-read on subscribe: the query can have changed between the initial
    // render and this effect, which is exactly what happens when React mounts,
    // unmounts and mounts again in development.
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
