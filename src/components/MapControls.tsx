import { useId, useState } from 'react';
import {
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
}: MapControlsProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const sliderId = useId();

  return (
    <div className="absolute right-3 top-3 z-20 flex items-start gap-2">
      {open && (
        <div
          id={panelId}
          className="surface animate-fade-up w-60 p-3 shadow-lg"
          style={{ backgroundColor: 'var(--bg-overlay)', backdropFilter: 'blur(12px)' }}
        >
          <p className="eyebrow mb-3">View</p>

          <label htmlFor={sliderId} className="text-secondary flex items-baseline justify-between text-xs">
            Height exaggeration
            <span className="tabular text-tertiary mono text-2xs">
              {settings.exaggeration.toFixed(2)}x
            </span>
          </label>
          <input
            id={sliderId}
            type="range"
            min={0.4}
            max={2}
            step={0.05}
            value={settings.exaggeration}
            onChange={(event) => onSettings({ exaggeration: Number(event.target.value) })}
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
          onClick={() => setOpen((value) => !value)}
          pressed={open}
          controls={panelId}
        >
          <Settings2 size={15} aria-hidden />
        </IconButton>
      </div>
    </div>
  );
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
