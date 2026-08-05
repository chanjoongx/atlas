import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
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

/**
 * Emits the Cloudflare Pages `_headers` file, with a Content Security Policy
 * whose script hashes are computed from the HTML that actually shipped.
 *
 * This matters more here than on a typical site. Atlas renders **untrusted
 * data**: it serialises file paths from arbitrary public repositories into SVG
 * markup and assigns it with `innerHTML`. Those paths are escaped, and that is
 * the real defence, but escaping is one function away from a regression.
 *
 * A `script-src` without `'unsafe-inline'` is the second line, because it stops
 * inline event handlers from running. That closes the whole `onerror=` class of
 * injection even if an escape is ever missed. It is only possible because the
 * one inline script in the document is hashed here rather than waved through,
 * so the hash can never drift from the script.
 *
 * `style-src` does keep `'unsafe-inline'`. React style props, the per building
 * `--i` custom property and the label sizing all set style attributes, which
 * that directive also governs. Injected CSS is a far smaller problem than
 * injected script, so this is a deliberate trade rather than an oversight.
 */
function securityHeaders(): Plugin {
  return {
    name: 'atlas-security-headers',
    apply: 'build',
    /*
     * `writeBundle`, and the hashes are read back off the file that was
     * actually written.
     *
     * The obvious implementation, collecting hashes in `transformIndexHtml`
     * and emitting the header in `generateBundle`, is wrong and fails quietly:
     * the HTML transform runs inside a later hook, so the hash list is still
     * empty when the header is written. That shipped a policy of
     * `script-src 'self'` with no hash at all, which blocks the pre-paint
     * theme script and gives every first time visitor a flash of the wrong
     * background. Reading the finished file cannot drift from what shipped,
     * and the assertion below turns any future version of that mistake into a
     * failed build rather than a subtle one.
     */
    writeBundle(options) {
      const outDir = options.dir ?? path.resolve(__dirname, 'dist');
      const htmlPath = path.join(outDir, 'index.html');
      const html = readFileSync(htmlPath, 'utf8');

      // Only executable inline scripts need a hash. A `type="application/ld+json"`
      // block is a data island that browsers never execute, so CSP ignores it.
      const hashes: string[] = [];
      for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
        const [, attrs, body] = match;
        if (/\ssrc=/i.test(attrs)) continue;
        if (/type\s*=\s*["'](?!text\/javascript|module)/i.test(attrs)) continue;
        if (!body.trim()) continue;

        // Normalise line endings before hashing. A browser hashes the script
        // as it sits in the DOM, and HTML input stream preprocessing has
        // already turned every CRLF and lone CR into LF by then. Hashing the
        // bytes on disk instead produces a different digest on a Windows
        // checkout than on a Linux one: the policy would silently block the
        // script when built on one machine and work when built on the other,
        // which is about the worst failure mode a build step can have.
        const normalised = body.replace(/\r\n?/g, '\n');
        hashes.push(`'sha256-${createHash('sha256').update(normalised, 'utf8').digest('base64')}'`);
      }

      if (hashes.length === 0) {
        throw new Error(
          'atlas-security-headers: found no inline script to hash in the built index.html. ' +
            'Either the pre-paint theme script was removed, or the matcher stopped matching it. ' +
            'Shipping now would emit a policy that blocks it.',
        );
      }

      const csp = [
        "default-src 'self'",
        `script-src 'self' ${hashes.join(' ')}`.trim(),
        "style-src 'self' 'unsafe-inline'",
        // blob: is the PNG exporter, which rasterises a serialised SVG through
        // an <img>. data: covers the base64 font embedded in that SVG.
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "manifest-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        // Framing is allowed on purpose. Clickjacking needs something worth
        // stealing a click for, and this app has no account, no state and no
        // destructive action. Meanwhile an article or a documentation page
        // embedding a live `?repo=` map is a genuinely good outcome, and
        // 'none' would forbid it for no gain.
        "frame-ancestors 'self' https:",
        "object-src 'none'",
        'upgrade-insecure-requests',
      ].join('; ');

      const headers = `/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/cache/*.json
  Cache-Control: public, max-age=600, stale-while-revalidate=86400
`;

      writeFileSync(path.join(outDir, '_headers'), headers, 'utf8');
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), siteOrigin(), securityHeaders()],
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
