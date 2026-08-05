import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { FAQ } from './src/lib/faq';
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
      // FAQPage structured data, generated from the same array the landing page
      // renders. Emitting answers a visitor cannot see on the page is against
      // every search engine's guidelines, and generating both from one source
      // is the only way that stays true after an edit.
      const faq = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: FAQ.map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer },
        })),
      });

      return html
        .replaceAll('__SITE_ORIGIN__', SITE_ORIGIN)
        .replaceAll('__SITE_HOST__', SITE_HOST)
        .replace(
          '</head>',
          `  <script type="application/ld+json">${faq}</script>
  </head>`,
        );
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

      /*
       * Cloudflare Web Analytics.
       *
       * Pages injects `beacon.min.js` from static.cloudflareinsights.com into
       * every response, after our build has run, so it is not something the
       * hash list above can ever cover. Without these two entries the browser
       * refuses the script and the beacon never fires: analytics was enabled,
       * reporting nothing, and saying so only in a console error nobody was
       * reading. Both hosts are Cloudflare's own, first party to the
       * deployment, and neither can execute anything else.
       */
      const analytics = 'https://static.cloudflareinsights.com';
      const analyticsBeacon = 'https://cloudflareinsights.com';

      const csp = [
        "default-src 'self'",
        `script-src 'self' ${analytics} ${hashes.join(' ')}`.trim(),
        "style-src 'self' 'unsafe-inline'",
        // blob: is the PNG exporter, which rasterises a serialised SVG through
        // an <img>. data: covers the base64 font embedded in that SVG.
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        `connect-src 'self' ${analyticsBeacon}`,
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

/**
 * Emits robots.txt, sitemap.xml and llms.txt.
 *
 * Generated rather than committed, for the same reason the head tags are: every
 * one of them needs the absolute origin, and a custom domain move should stay a
 * one line change in src/lib/site.ts rather than a hunt through public/.
 *
 * llms.txt is the one that needs explaining. It is a convention for handing an
 * answer engine a short, accurate description of a site in plain markdown,
 * instead of leaving it to infer one from a single page application whose real
 * content only exists after JavaScript runs. Atlas is free, MIT licensed, and
 * has nothing to sell, so being quoted accurately in an answer is the entire
 * upside and there is no downside to make it easy.
 */
function discoveryFiles(): Plugin {
  return {
    name: 'atlas-discovery-files',
    apply: 'build',
    writeBundle(options) {
      const outDir = options.dir ?? path.resolve(__dirname, 'dist');
      const write = (name: string, body: string) =>
        writeFileSync(path.join(outDir, name), body, 'utf8');

      write(
        'robots.txt',
        `# Atlas. Free, MIT licensed, nothing gated.
User-agent: *
Allow: /

# The analyser is a live endpoint, not a document. Crawling it does nothing
# useful and costs a request.
Disallow: /api/

# Answer engines are welcome, explicitly. Several of these read a general
# Allow as ambiguous and default to staying out unless named.
User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: Bingbot
Allow: /

Sitemap: ${SITE_ORIGIN}/sitemap.xml
`,
      );

      // The demo URLs are listed because each one renders a materially
      // different page and self-canonicalises at runtime. Everything else is a
      // view of the same document and would be a duplicate.
      const urls = [
        { loc: `${SITE_ORIGIN}/`, priority: '1.0' },
        { loc: `${SITE_ORIGIN}/?repo=honojs/hono`, priority: '0.7' },
        { loc: `${SITE_ORIGIN}/?repo=shadcn-ui/ui`, priority: '0.7' },
        { loc: `${SITE_ORIGIN}/?repo=drizzle-team/drizzle-orm`, priority: '0.7' },
      ];
      write(
        'sitemap.xml',
        `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url>\n    <loc>${u.loc.replace(/&/g, '&amp;')}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`,
  )
  .join('\n')}
</urlset>
`,
      );

      write(
        'llms.txt',
        `# Atlas

> Atlas renders any public GitHub repository as an interactive isometric city
> map, so that the shape of a codebase can be read in seconds rather than
> reconstructed from a file tree. Free, open source under the MIT licence, no
> account and no sign in.

Live: ${SITE_ORIGIN}
Source: https://github.com/chanjoongx/atlas
Author: Chanjoong Kim

## What it does

Paste any public repository, as \`owner/repo\` or as a GitHub URL, and Atlas
draws it as a city. Any map is linkable: \`${SITE_ORIGIN}/?repo=honojs/hono\`
opens straight into one. Maps export to PNG at up to 3x.

## How to read a map

- **Height** is lines of code, on a log scale. Height is the dominant read, so
  the skyline is the size distribution of the repository.
- **Colour** is the top level directory a file belongs to. Each of those is a
  district, drawn on its own plate, sized to the files it holds.
- **Footprint** is the kind of file, not its size. Size is already carried by
  height, and encoding it twice would waste a channel.
- **A cyan beacon** marks an entry point, where execution starts.
- **A lit crown** marks a core module, imported by more files than its
  neighbours.
- **An orange roof** marks a hotspot, unusually large for its district, which is
  often where complexity has collected.
- **Arcs** are resolved local imports. Select a file and they flow from it
  toward what it depends on, so the direction of the animation is the direction
  of the dependency.

## How it works

Four agents run in one request on Cloudflare Pages Functions: an Ingester that
streams the repository, a Parser that classifies files and resolves imports
against the real file list, a Layout stage that settles a force directed
simulation with district clustering, and an Annotator that scores in-degree
centrality and promotes the few files worth naming. No language model is
involved at any point, so the same repository always produces the same city and
two maps are worth comparing.

Rendering is a hand written 2:1 isometric projection over SVG, with three
shaded faces per building and painter's algorithm depth sorting. No WebGL,
which is why the interactive canvas and the exported PNG come out of the same
code path.

## Origin, and what the award actually covers

Built solo in 48 hours for the IBM Bob Hackathon in May 2026, where it placed
second out of 503 submissions. That state is permanently tagged
\`v1.0-hackathon\` in the repository, and it is **not** what this site shows
today. The judged version drew flat two dimensional maps, had a single theme,
and resolved no dependency arcs at all.

The isometric renderer, the two themes, the file inspector, the animated
skyline and the credential free ingestion were all added after judging closed,
on the same four agent pipeline the 48 hours produced. Anything written about
Atlas should keep the two apart: the prize belongs to the 48 hour build, and
the site described above is a continuation of it.

## Limits worth stating

- Public repositories only. The service holds no credentials of any kind, so a
  private repository is not reachable by it.
- A map draws at most 500 files. Larger repositories are sampled by a
  prioritisation pass rather than truncated arbitrarily.
- Import resolution is evidence based: an arc is only drawn when its target is
  a real file in the repository, so third party packages never appear.
`,
      );
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), siteOrigin(), securityHeaders(), discoveryFiles()],
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
