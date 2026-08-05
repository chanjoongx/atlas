import { ArrowDownLeft, ArrowUpRight, Crosshair, ExternalLink, X } from 'lucide-react';
import { SIGNAL_LABEL, districtColor, signalColor, type ThemeName } from '../lib/palette';
import type { Scene, SceneNode } from '../lib/iso';

interface InspectorProps {
  node: SceneNode;
  scene: Scene;
  theme: ThemeName;
  repo: { owner: string; repo: string } | null;
  onSelect: (nodeId: string | null) => void;
  onLocate: (nodeId: string) => void;
  onClose: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  source: 'Source',
  test: 'Test',
  config: 'Config',
  docs: 'Docs',
  asset: 'Asset',
};

export function Inspector({ node, scene, theme, repo, onSelect, onLocate, onClose }: InspectorProps) {
  const related = scene.edgesByNode.get(node.id) ?? [];
  const imports = related.filter((edge) => edge.source === node.id).map((edge) => edge.target);
  const importedBy = related.filter((edge) => edge.target === node.id).map((edge) => edge.source);
  const dir = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '';

  return (
    <aside
      className="border-line bg-surface animate-fade-in flex h-full w-full flex-col border-l"
      aria-label="File details"
    >
      <header className="border-subtle flex items-start gap-2 border-b px-4 py-3">
        <span
          aria-hidden
          className="mt-1.5 size-2.5 shrink-0 rounded-[2px]"
          style={{ backgroundColor: districtColor(node.districtIndex, theme) }}
        />
        <div className="min-w-0 flex-1">
          <h2 className="mono text-primary truncate text-sm font-medium">{node.label}</h2>
          {dir && <p className="mono text-tertiary truncate text-2xs">{dir}/</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="btn btn-ghost btn-icon -mr-1.5 -mt-1 size-7"
          aria-label="Close details"
        >
          <X size={15} aria-hidden />
        </button>
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {node.signals.length > 0 && (
          <ul className="border-subtle flex flex-wrap gap-1.5 border-b px-4 py-3">
            {node.signals.map((signal) => (
              <li
                key={signal}
                className="text-2xs flex items-center gap-1.5 rounded-full px-2 py-1 font-medium"
                style={{
                  color: signalColor(signal, theme),
                  backgroundColor: `color-mix(in srgb, ${signalColor(signal, theme)} 14%, transparent)`,
                }}
              >
                <span
                  aria-hidden
                  className="size-1.5 rotate-45"
                  style={{ backgroundColor: signalColor(signal, theme) }}
                />
                {SIGNAL_LABEL[signal]}
              </li>
            ))}
          </ul>
        )}

        {node.reason && (
          <p className="border-subtle text-secondary border-b px-4 py-3 text-xs leading-relaxed">
            {node.reason}
          </p>
        )}

        <dl className="border-subtle grid grid-cols-2 gap-px border-b" style={{ backgroundColor: 'var(--border-subtle)' }}>
          <Metric label="Lines" value={node.loc.toLocaleString()} />
          <Metric label="Language" value={node.language === 'unknown' ? 'other' : node.language} />
          <Metric label="Type" value={TYPE_LABEL[node.type] ?? node.type} />
          <Metric label="District" value={node.districtName} mono />
        </dl>

        <RelatedList
          title="Imports"
          icon={<ArrowUpRight size={13} aria-hidden />}
          ids={imports}
          scene={scene}
          onSelect={onSelect}
          empty="No local imports resolved."
        />
        <RelatedList
          title="Imported by"
          icon={<ArrowDownLeft size={13} aria-hidden />}
          ids={importedBy}
          scene={scene}
          onSelect={onSelect}
          empty="Nothing in this map imports it."
        />
      </div>

      <footer className="border-subtle flex gap-2 border-t px-4 py-3">
        <button type="button" onClick={() => onLocate(node.id)} className="btn btn-secondary flex-1">
          <Crosshair size={14} aria-hidden />
          Locate
        </button>
        {repo && (
          <a
            href={`https://github.com/${repo.owner}/${repo.repo}/blob/HEAD/${node.path}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary flex-1"
          >
            <ExternalLink size={14} aria-hidden />
            Open file
          </a>
        )}
      </footer>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */

function Metric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-surface px-4 py-2.5">
      <dt className="text-tertiary text-2xs">{label}</dt>
      <dd className={`text-primary truncate text-sm ${mono ? 'mono text-xs' : 'tabular'}`}>{value}</dd>
    </div>
  );
}

function RelatedList({
  title,
  icon,
  ids,
  scene,
  onSelect,
  empty,
}: {
  title: string;
  icon: React.ReactNode;
  ids: string[];
  scene: Scene;
  onSelect: (nodeId: string) => void;
  empty: string;
}) {
  return (
    <section className="border-subtle border-b px-4 py-3">
      <p className="eyebrow flex items-center gap-1.5">
        <span className="text-tertiary">{icon}</span>
        {title}
        <span className="tabular ml-auto font-normal normal-case tracking-normal">{ids.length}</span>
      </p>

      {ids.length === 0 ? (
        <p className="text-tertiary mt-1.5 text-2xs">{empty}</p>
      ) : (
        <ul className="mt-1.5 space-y-px">
          {ids.slice(0, 12).map((id) => {
            const target = scene.nodeById.get(id);
            if (!target) return null;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onSelect(id)}
                  className="hover:bg-surface-hover -mx-1.5 flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left transition-colors"
                  title={target.path}
                >
                  <span className="mono text-secondary min-w-0 flex-1 truncate text-xs">
                    {target.label}
                  </span>
                  <span className="tabular text-tertiary text-2xs">{target.loc}</span>
                </button>
              </li>
            );
          })}
          {ids.length > 12 && (
            <li className="text-tertiary pt-1 text-2xs">and {ids.length - 12} more</li>
          )}
        </ul>
      )}
    </section>
  );
}
