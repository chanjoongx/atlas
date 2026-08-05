import { useLayoutEffect, useRef, useState } from 'react';
import { SIGNAL_LABEL, signalColor, type ThemeName } from '../lib/palette';
import type { SceneNode } from '../lib/iso';

interface NodeTooltipProps {
  node: SceneNode | null;
  at: { x: number; y: number } | null;
  theme: ThemeName;
}

const OFFSET = 16;
const MARGIN = 12;

export function NodeTooltip({ node, at, theme }: NodeTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({ left: 0, top: 0 });

  // Measure after paint so the card can flip rather than leave the viewport.
  useLayoutEffect(() => {
    if (!node || !at || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    const flipX = at.x + OFFSET + box.width + MARGIN > window.innerWidth;
    const flipY = at.y + OFFSET + box.height + MARGIN > window.innerHeight;
    setPlacement({
      left: flipX ? Math.max(MARGIN, at.x - OFFSET - box.width) : at.x + OFFSET,
      top: flipY ? Math.max(MARGIN, at.y - OFFSET - box.height) : at.y + OFFSET,
    });
  }, [node, at]);

  if (!node || !at) return null;

  const dir = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/') + 1) : '';

  return (
    <div
      ref={ref}
      role="tooltip"
      className="surface pointer-events-none fixed z-50 max-w-[19rem] px-3 py-2.5 shadow-lg"
      style={{ left: placement.left, top: placement.top }}
    >
      <p className="mono truncate text-xs leading-snug">
        {dir && <span className="text-tertiary">{dir}</span>}
        <span className="text-primary font-medium">{node.label}</span>
      </p>

      <dl className="tabular mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-2xs">
        <dt className="text-tertiary">Lines</dt>
        <dd className="text-secondary">{node.loc.toLocaleString()}</dd>
        <dt className="text-tertiary">Language</dt>
        <dd className="text-secondary">{node.language === 'unknown' ? 'other' : node.language}</dd>
        <dt className="text-tertiary">District</dt>
        <dd className="text-secondary truncate">{node.districtName}</dd>
        {(node.inDegree > 0 || node.outDegree > 0) && (
          <>
            <dt className="text-tertiary">Imports</dt>
            <dd className="text-secondary">
              {node.outDegree} out, {node.inDegree} in
            </dd>
          </>
        )}
      </dl>

      {node.signals.length > 0 && (
        <ul className="border-subtle mt-2 flex flex-wrap gap-1.5 border-t pt-2">
          {node.signals.map((signal) => (
            <li
              key={signal}
              className="text-2xs flex items-center gap-1.5 font-medium"
              style={{ color: signalColor(signal, theme) }}
            >
              <span
                aria-hidden
                className="size-1.5 rounded-full"
                style={{ backgroundColor: signalColor(signal, theme) }}
              />
              {SIGNAL_LABEL[signal]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
