/**
 * Theme plumbing. Resolves once before React paints (see index.html) and then
 * stays in sync with the OS until the visitor picks a side explicitly.
 */

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import type { ThemeName } from './palette';

export type { ThemeName };

const STORAGE_KEY = 'atlas.theme';
const DEFAULT: ThemeName = 'carbon';

export function readStoredTheme(): ThemeName | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === 'carbon' || raw === 'paper' ? raw : null;
  } catch {
    return null;
  }
}

export function systemTheme(): ThemeName {
  if (typeof matchMedia !== 'function') return DEFAULT;
  return matchMedia('(prefers-color-scheme: light)').matches ? 'paper' : 'carbon';
}

export function resolveTheme(): ThemeName {
  return readStoredTheme() ?? systemTheme();
}

function applyTheme(theme: ThemeName): void {
  const colour = theme === 'carbon' ? '#0b0c0e' : '#faf9f7';
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.background = colour;

  // index.html ships a media-scoped pair for visitors without scripting. Drop
  // the media attribute so this tag matches unconditionally, otherwise a light
  // OS keeps winning through the second tag no matter what the visitor picked.
  const meta = root.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.removeAttribute('media');
    meta.setAttribute('content', colour);
  }
}

export function useTheme(): {
  theme: ThemeName;
  setTheme: (next: ThemeName) => void;
  toggleTheme: () => void;
} {
  const [theme, setThemeState] = useState<ThemeName>(() =>
    typeof document === 'undefined'
      ? DEFAULT
      : ((document.documentElement.dataset.theme as ThemeName | undefined) ?? resolveTheme()),
  );

  /**
   * The attribute is written before React state changes, not in an effect
   * afterwards.
   *
   * The map renderer reads its sky, grid and label colours back out of the
   * CSS custom properties with getComputedStyle. React runs child effects
   * before parent effects, so an effect here would apply `data-theme` only
   * after the canvas had already redrawn, and the canvas would spend one frame
   * painting the new palette's buildings onto the old palette's sky.
   */
  const commit = useCallback((next: ThemeName) => {
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode: the choice just will not survive a reload */
    }
    setThemeState(next);
  }, []);

  // Belt and braces for the very first paint. index.html resolves the theme
  // before React boots, but nothing should depend on that having happened.
  useLayoutEffect(() => {
    if (document.documentElement.dataset.theme !== theme) applyTheme(theme);
  }, [theme]);

  // Follow the OS until the visitor states a preference.
  useEffect(() => {
    if (readStoredTheme() || typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      // Re-checked here, not only at mount. A visitor who arrives with no
      // stored preference gets this listener, and it used to stay live after
      // they picked a theme: anyone on scheduled dark mode had their choice
      // undone at sunset, with the page and the stored preference disagreeing
      // until the next reload.
      if (readStoredTheme()) return;
      const next: ThemeName = mq.matches ? 'paper' : 'carbon';
      applyTheme(next);
      setThemeState(next);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggleTheme = useCallback(
    () => commit(document.documentElement.dataset.theme === 'paper' ? 'carbon' : 'paper'),
    [commit],
  );

  return { theme, setTheme: commit, toggleTheme };
}

/**
 * Snapshot of the map-facing CSS custom properties, so the renderer can draw
 * onto a themed canvas without hard-coding any of it.
 */
export interface MapTokens {
  skyTop: string;
  skyMid: string;
  skyBottom: string;
  halo: string;
  grid: string;
  gridMajor: string;
  groundShadow: string;
  edge: string;
  label: string;
  labelHalo: string;
  districtLabel: string;
  vignette: string;
}

const MAP_TOKEN_VARS: Record<keyof MapTokens, string> = {
  skyTop: '--map-sky-top',
  skyMid: '--map-sky-mid',
  skyBottom: '--map-sky-bottom',
  halo: '--map-halo',
  grid: '--map-grid',
  gridMajor: '--map-grid-major',
  groundShadow: '--map-ground-shadow',
  edge: '--map-edge',
  label: '--map-label',
  labelHalo: '--map-label-halo',
  districtLabel: '--map-district-label',
  vignette: '--map-vignette',
};

const FALLBACK: Record<ThemeName, MapTokens> = {
  carbon: {
    skyTop: '#090a0d',
    skyMid: '#0e1116',
    skyBottom: '#14181f',
    halo: 'rgba(69,137,255,0.10)',
    grid: 'rgba(150,165,190,0.055)',
    gridMajor: 'rgba(150,165,190,0.10)',
    groundShadow: 'rgba(0,0,0,0.55)',
    edge: 'rgba(160,178,208,0.5)',
    label: '#ffffff',
    labelHalo: 'rgba(6,7,9,0.88)',
    districtLabel: 'rgba(255,255,255,0.62)',
    vignette: 'rgba(0,0,0,0.42)',
  },
  paper: {
    skyTop: '#fbfaf8',
    skyMid: '#f4f2ed',
    skyBottom: '#eae6de',
    halo: 'rgba(15,98,254,0.05)',
    grid: 'rgba(60,52,40,0.055)',
    gridMajor: 'rgba(60,52,40,0.10)',
    groundShadow: 'rgba(52,44,32,0.16)',
    edge: 'rgba(72,64,52,0.42)',
    label: '#17150f',
    labelHalo: 'rgba(255,255,255,0.92)',
    districtLabel: 'rgba(28,26,23,0.55)',
    vignette: 'rgba(80,70,55,0.09)',
  },
};

export function readMapTokens(theme: ThemeName): MapTokens {
  if (typeof getComputedStyle !== 'function') return FALLBACK[theme];
  const style = getComputedStyle(document.documentElement);
  const out = {} as MapTokens;
  (Object.keys(MAP_TOKEN_VARS) as Array<keyof MapTokens>).forEach((key) => {
    const value = style.getPropertyValue(MAP_TOKEN_VARS[key]).trim();
    out[key] = value || FALLBACK[theme][key];
  });
  return out;
}
