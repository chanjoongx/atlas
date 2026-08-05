import { useEffect, useId, useState } from 'react';
import {
  KeyRound,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  Settings2,
  Tag,
  Waypoints,
} from 'lucide-react';
import type { Azimuth } from '../lib/iso';

export interface ViewSettings {
  exaggeration: number;
  showEdges: boolean;
  showLabels: boolean;
  showGrid: boolean;
}

interface MapControlsProps {
  azimuth: Azimuth;
  settings: ViewSettings;
  edgeCount: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onRotate: (direction: -1 | 1) => void;
  onSettings: (patch: Partial<ViewSettings>) => void;
  onOpenKey: () => void;
}

const COMPASS = ['N', 'E', 'S', 'W'] as const;

export function MapControls({
  azimuth,
  settings,
  edgeCount,
  onZoomIn,
  onZoomOut,
  onReset,
  onRotate,
  onSettings,
  onOpenKey,
}: MapControlsProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const sliderId = useId();
  const coarse = useCoarsePointer();

  /*
   * Height exaggeration, held locally while a finger is on it.
   *
   * Every step of this slider rebuilds all three thousand SVG elements, which
   * a desktop absorbs and a mid range phone does not: measured at 4x CPU
   * throttling one step cost a full second of style recalculation, and dragging
   * it dropped the page to 0.4 frames per second. The thumb still tracks the
   * finger, because that is local state; only the redraw waits for release.
   */
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? settings.exaggeration;

  const commit = () => {
    if (draft === null) return;
    onSettings({ exaggeration: draft });
    setDraft(null);
  };

  return (
    <div className="inset-safe-right absolute top-3 z-20 flex items-start gap-2">
      {open && (
        <div
          id={panelId}
          className="surface animate-fade-up w-60 p-3 shadow-lg"
          style={{ backgroundColor: 'var(--bg-overlay)', backdropFilter: 'blur(12px)' }}
        >
          <p className="eyebrow mb-3">View</p>

          <label htmlFor={sliderId} className="text-secondary flex items-baseline justify-between text-xs">
            Height exaggeration
            <span className="tabular text-tertiary mono text-2xs">{value.toFixed(2)}x</span>
          </label>
          <input
            id={sliderId}
            type="range"
            min={0.4}
            max={2}
            step={0.05}
            value={value}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (coarse) setDraft(next);
              else onSettings({ exaggeration: next });
            }}
            onPointerUp={commit}
            onKeyUp={commit}
            onBlur={commit}
            className="accent-accent mt-1.5 w-full"
          />

          <div className="border-subtle mt-3 space-y-0.5 border-t pt-2">
            <Toggle
              label="Dependency arcs"
              icon={<Waypoints size={14} aria-hidden />}
              checked={settings.showEdges}
              disabled={edgeCount === 0}
              hint={edgeCount === 0 ? 'None resolved for this repo' : `${edgeCount.toLocaleString()} links`}
              onChange={(showEdges) => onSettings({ showEdges })}
            />
            <Toggle
              label="Landmark labels"
              icon={<Tag size={14} aria-hidden />}
              checked={settings.showLabels}
              onChange={(showLabels) => onSettings({ showLabels })}
            />
            <Toggle
              label="Ground grid"
              icon={<Grid aria-hidden />}
              checked={settings.showGrid}
              onChange={(showGrid) => onSettings({ showGrid })}
            />
          </div>
        </div>
      )}

      <div
        className="surface flex flex-col p-1 shadow-md"
        style={{ backgroundColor: 'var(--bg-overlay)', backdropFilter: 'blur(12px)' }}
      >
        <IconButton label="Zoom in" shortcut="+" onClick={onZoomIn}>
          <Plus size={16} aria-hidden />
        </IconButton>
        <IconButton label="Zoom out" shortcut="-" onClick={onZoomOut}>
          <Minus size={16} aria-hidden />
        </IconButton>
        <IconButton label="Fit to view" shortcut="0" onClick={onReset}>
          <Maximize2 size={15} aria-hidden />
        </IconButton>

        <Divider />

        <IconButton label="Rotate left" shortcut="[" onClick={() => onRotate(-1)}>
          <RotateCcw size={15} aria-hidden />
        </IconButton>
        <IconButton label="Rotate right" shortcut="]" onClick={() => onRotate(1)}>
          <RotateCw size={15} aria-hidden />
        </IconButton>
        <p
          className="text-tertiary mono select-none py-0.5 text-center text-2xs"
          aria-label={`Camera facing ${COMPASS[azimuth]}`}
        >
          {COMPASS[azimuth]}
        </p>

        <Divider />

        <IconButton
          label="View options"
          onClick={() => setOpen((current) => !current)}
          pressed={open}
          controls={panelId}
        >
          <Settings2 size={15} aria-hidden />
        </IconButton>

        {/*
          Below lg the key column is `display: none`, which took the whole
          explanation of the encoding with it: height, colour, the orange roofs
          and the beacons all went unexplained on every phone, every tablet in
          portrait and every phone in landscape. Same component, opened as a
          sheet.
        */}
        <div className="lg:hidden">
          <IconButton label="Map key" onClick={onOpenKey}>
            <KeyRound size={15} aria-hidden />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

/**
 * Whether the primary pointer is a finger.
 *
 * Read live rather than once, because a tablet with a keyboard case attached
 * changes answer without reloading the page.
 */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  );

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(pointer: coarse)');
    const onChange = () => setCoarse(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return coarse;
}

/* -------------------------------------------------------------------------- */

function IconButton({
  label,
  shortcut,
  onClick,
  pressed,
  controls,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  pressed?: boolean;
  controls?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={pressed}
      aria-expanded={controls ? pressed : undefined}
      aria-controls={controls}
      className="text-secondary hover:bg-surface-hover hover:text-primary flex size-8 items-center justify-center rounded-sm transition-colors aria-pressed:text-accent"
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="bg-subtle mx-1 my-1 h-px" aria-hidden />;
}

function Toggle({
  label,
  icon,
  checked,
  disabled,
  hint,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  hint?: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      className={`hover:bg-surface-hover -mx-1 flex cursor-pointer items-center gap-2.5 rounded-sm px-1 py-1.5 text-xs transition-colors ${
        disabled ? 'cursor-not-allowed opacity-45' : ''
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-accent size-3.5"
      />
      <span className="text-tertiary" aria-hidden>
        {icon}
      </span>
      <span className="text-secondary flex-1">{label}</span>
      {hint && <span className="text-tertiary text-2xs">{hint}</span>}
    </label>
  );
}

function Grid(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      {...props}
    >
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </svg>
  );
}
