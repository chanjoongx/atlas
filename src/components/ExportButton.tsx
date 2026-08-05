import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Clipboard, Download, Loader2 } from 'lucide-react';
import type { ThemeName } from '../lib/palette';
import type { IsoRenderer, SceneStats } from '../lib/iso';
import { canCopyImages, copyPngToClipboard, downloadPng, type ExportScale } from '../lib/png-export';

interface ExportButtonProps {
  renderer: IsoRenderer | null;
  theme: ThemeName;
  repo: string | null;
  stats: SceneStats | null;
}

/** Fixed export frame, so every shared map has the same proportions. */
const FRAME = { width: 1600, height: 1000 };
const CAPTION = 64;
const SCALES: ExportScale[] = [1, 2, 3];

export function ExportButton({ renderer, theme, repo, stats }: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'download' | 'copy' | null>(null);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(() => setDone(false), 1800);
    return () => window.clearTimeout(id);
  }, [done]);

  const payload = () => {
    if (!renderer) return null;
    return {
      markup: renderer.exportMarkup(FRAME.width, FRAME.height),
      width: FRAME.width,
      height: FRAME.height,
      theme,
      title: repo ?? undefined,
      subtitle: stats
        ? `${stats.fileCount.toLocaleString()} files, ${stats.districtCount} districts, ${stats.totalLoc.toLocaleString()} lines`
        : undefined,
    };
  };

  const run = async (task: 'download' | 'copy', scale: ExportScale = 2) => {
    const base = payload();
    if (!base) return;
    setOpen(false);
    setFailed(false);
    setBusy(task);
    try {
      if (task === 'copy') {
        await copyPngToClipboard({ ...base, scale });
      } else {
        const slug = (repo ?? 'repository').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
        await downloadPng({ ...base, scale }, `atlas-${slug}-${scale}x.png`);
      }
      setDone(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  const disabled = !renderer || busy !== null;

  return (
    <div ref={wrapper} className="relative">
      <div className="flex">
        <button
          type="button"
          onClick={() => run('download', 2)}
          disabled={disabled}
          className="btn btn-secondary rounded-r-none border-r-0 pr-2.5"
        >
          {busy === 'download' ? (
            <Loader2 size={14} aria-hidden className="animate-spin" />
          ) : done ? (
            <Check size={14} aria-hidden className="text-success" />
          ) : (
            <Download size={14} aria-hidden />
          )}
          <span className="hidden sm:inline">{done ? 'Saved' : 'Export'}</span>
        </button>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="Export options"
          className="btn btn-secondary rounded-l-none px-1.5"
        >
          <ChevronDown size={14} aria-hidden />
        </button>
      </div>

      {open && (
        <div
          role="menu"
          className="surface animate-fade-up absolute right-0 top-full z-40 mt-1.5 w-56 p-1 shadow-lg"
        >
          <p className="eyebrow px-2 pb-1 pt-1.5">Download PNG</p>
          {SCALES.map((scale) => (
            <button
              key={scale}
              role="menuitem"
              type="button"
              onClick={() => run('download', scale)}
              className="hover:bg-surface-hover flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-xs transition-colors"
            >
              <span className="text-secondary">{scale}x</span>
              <span className="tabular text-tertiary text-2xs">
                {FRAME.width * scale} x {(FRAME.height + CAPTION) * scale}
              </span>
            </button>
          ))}

          {canCopyImages() && (
            <>
              <div className="bg-subtle my-1 h-px" aria-hidden />
              <button
                role="menuitem"
                type="button"
                onClick={() => run('copy', 2)}
                className="hover:bg-surface-hover flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors"
              >
                <Clipboard size={13} aria-hidden className="text-tertiary" />
                <span className="text-secondary">Copy to clipboard</span>
              </button>
            </>
          )}
        </div>
      )}

      {failed && (
        <p role="status" className="text-danger absolute right-0 top-full mt-1 whitespace-nowrap text-2xs">
          Export failed. Try again.
        </p>
      )}
    </div>
  );
}
