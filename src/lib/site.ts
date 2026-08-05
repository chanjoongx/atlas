/**
 * Where Atlas lives.
 *
 * Single source of truth. The exported PNG carries an attribution line, the
 * README links here, and `index.html` needs it for the canonical URL and the
 * Open Graph tags. HTML cannot import a module, so a small Vite plugin
 * substitutes `__SITE_ORIGIN__` and `__SITE_HOST__` from this file at build time.
 * Moving to a custom domain is therefore a one line change here.
 */

export const SITE_ORIGIN = 'https://atlascity.dev';

/** Host on its own, for places where a scheme would be noise. */
export const SITE_HOST = SITE_ORIGIN.replace(/^https?:\/\//, '');
