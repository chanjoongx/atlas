/**
 * Turns the live city into a shareable PNG.
 *
 * Two things make this harder than "serialise the SVG and draw it":
 *
 * 1. An SVG rasterised through an `<img>` runs in a sandbox with no access to
 *    the page. Fonts and CSS custom properties do not cross that boundary, so
 *    the export builds its own standalone document with a base64 `@font-face`
 *    and literal colours rather than tokens.
 * 2. The on screen canvas is wherever the visitor panned it. Exports reframe
 *    from scratch so the file always contains the whole city.
 */

import interWoff2 from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import type { ThemeName } from './palette';
import { SITE_HOST } from './site';

export type ExportScale = 1 | 2 | 3;

export interface ExportOptions {
  /** Markup from `IsoRenderer.exportMarkup(width, height)`. */
  markup: string;
  width: number;
  height: number;
  scale: ExportScale;
  theme: ThemeName;
  /** Repository, shown in the caption band. */
  title?: string;
  subtitle?: string;
  caption?: boolean;
}

const CAPTION_HEIGHT = 64;


const CHROME: Record<ThemeName, { bg: string; rule: string; title: string; muted: string }> = {
  carbon: { bg: '#0b0c0e', rule: '#24272e', title: '#e9eaec', muted: '#767d89' },
  paper: { bg: '#faf9f7', rule: '#ddd9d1', title: '#1c1a17', muted: '#7d776d' },
};

let fontPromise: Promise<string | null> | null = null;

/** Base64 the variable font once per session; exports after the first are cheap. */
async function embeddedFont(): Promise<string | null> {
  if (!fontPromise) {
    fontPromise = (async () => {
      try {
        const response = await fetch(interWoff2);
        if (!response.ok) return null;
        const buffer = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < buffer.length; i += CHUNK) {
          binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK));
        }
        return btoa(binary);
      } catch {
        return null;
      }
    })();
  }
  return fontPromise;
}

/** Build the standalone SVG document that gets rasterised. */
export async function buildExportSvg(options: ExportOptions): Promise<string> {
  const { markup, width, height, theme } = options;
  const chrome = CHROME[theme];
  const withCaption = options.caption !== false && Boolean(options.title);
  const captionHeight = withCaption ? CAPTION_HEIGHT : 0;
  const total = height + captionHeight;

  const font = await embeddedFont();
  const fontFace = font
    ? `@font-face{font-family:'Atlas Inter';src:url(data:font/woff2;base64,${font}) format('woff2-variations');font-weight:100 900;font-style:normal;}`
    : '';
  const family = font
    ? "'Atlas Inter', system-ui, sans-serif"
    : 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

  const caption = withCaption
    ? `<g transform="translate(0 ${height})">
         <rect x="0" y="0" width="${width}" height="${captionHeight}" fill="${chrome.bg}"/>
         <line x1="0" y1="0.5" x2="${width}" y2="0.5" stroke="${chrome.rule}" stroke-width="1"/>
         <text x="28" y="27" fill="${chrome.title}" font-size="17" font-weight="600" letter-spacing="-0.2">${escapeXml(
           options.title ?? '',
         )}</text>
         ${
           options.subtitle
             ? `<text x="28" y="46" fill="${chrome.muted}" font-size="12.5">${escapeXml(
                 options.subtitle,
               )}</text>`
             : ''
         }
         <text x="${width - 28}" y="38" fill="${chrome.muted}" font-size="12.5" text-anchor="end">Mapped with Atlas &#183; ${SITE_HOST}</text>
       </g>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${total}" viewBox="0 0 ${width} ${total}">
<style>${fontFace}text{font-family:${family};}</style>
<rect x="0" y="0" width="${width}" height="${total}" fill="${chrome.bg}"/>
<g>${markup}</g>
${caption}
</svg>`;
}

/** Rasterise to a PNG blob at the requested device scale. */
export async function renderPngBlob(options: ExportOptions): Promise<Blob> {
  const svg = await buildExportSvg(options);
  const withCaption = options.caption !== false && Boolean(options.title);
  const total = options.height + (withCaption ? CAPTION_HEIGHT : 0);

  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The map could not be rasterised.'));
      image.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(options.width * options.scale);
    canvas.height = Math.round(total * options.scale);

    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser did not provide a 2D canvas.');
    context.fillStyle = CHROME[options.theme].bg;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(options.scale, 0, 0, options.scale, 0, 0);
    context.drawImage(image, 0, 0, options.width, total);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('The PNG could not be encoded.'))),
        'image/png',
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadPng(options: ExportOptions, filename: string): Promise<void> {
  const blob = await renderPngBlob(options);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on a later task. Chrome copes with an immediate revoke, other
  // engines have historically raced the download against it.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function canCopyImages(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function' &&
    typeof ClipboardItem !== 'undefined'
  );
}

export async function copyPngToClipboard(options: ExportOptions): Promise<void> {
  const blob = await renderPngBlob(options);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
