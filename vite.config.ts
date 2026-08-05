import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { SITE_HOST, SITE_ORIGIN } from './src/lib/site';

/**
 * Substitutes the site origin into index.html.
 *
 * The canonical link, the Open Graph tags and the manifest all need an
 * absolute URL, and HTML cannot import a module. Rather than leaving the
 * hostname copied into a dozen tags, index.html holds `__SITE_ORIGIN__` and
 * `__SITE_HOST__` and this fills them in from src/lib/site.ts, so moving to a
 * custom domain is one edit rather than a search and replace.
 */
function siteOrigin(): Plugin {
  return {
    name: 'atlas-site-origin',
    transformIndexHtml(html) {
      return html.replaceAll('__SITE_ORIGIN__', SITE_ORIGIN).replaceAll('__SITE_HOST__', SITE_HOST);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), siteOrigin()],
  resolve: {
    alias: {
      '@/components': path.resolve(__dirname, './src/components'),
      '@/lib': path.resolve(__dirname, './src/lib'),
      '@/types': path.resolve(__dirname, './src/types/index.ts'),
      '@/functions': path.resolve(__dirname, './functions'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
