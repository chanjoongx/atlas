/**
 * Turning an AnnotatedLayout into a renderable city.
 *
 * Two invariants here are load bearing. Footprints must never overlap, because
 * the painter's algorithm has no depth buffer to fall back on. And district
 * identity must be a pure function of the layout, because the same repo has to
 * render as the same city on every reload and in every export.
 */

import { describe, it, expect } from 'vitest';
import type { AnnotatedLayout, District, FileType, Highlight, LayoutEdge, LayoutNode } from '../../types';
import {
  UNCLASSIFIED,
  buildScene,
  placeDistricts,
  placeNodes,
  sceneBounds,
  type SceneNode,
} from '../iso/scene';
import { AZIMUTHS } from '../iso/projection';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

interface NodeSpec {
  id: string;
  loc?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  type?: FileType;
  language?: string;
  label?: string;
}

function node(spec: NodeSpec): LayoutNode {
  return {
    id: spec.id,
    x: spec.x ?? 0,
    y: spec.y ?? 0,
    width: spec.width ?? 40,
    height: spec.height ?? 60,
    type: spec.type ?? 'source',
    label: spec.label ?? spec.id.split('/').pop() ?? spec.id,
    metadata: {
      path: spec.id,
      loc: spec.loc ?? 100,
      language: spec.language ?? 'typescript',
    },
  };
}

function district(name: string, nodes: string[]): District {
  return {
    name,
    nodes,
    // buildScene derives its own plate bounds, so these are placeholders.
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    color: '#000000',
  };
}

interface HighlightSpec {
  nodeId: string;
  type: string;
  reason?: string;
  intensity?: number;
}

function highlight(spec: HighlightSpec): Highlight {
  return {
    nodeId: spec.nodeId,
    // The backend types this as a union, but it arrives over the wire as JSON,
    // so the scene builder has to cope with anything a string can hold.
    type: spec.type as Highlight['type'],
    reason: spec.reason ?? 'because',
    intensity: spec.intensity ?? 1,
  };
}

interface LayoutSpec {
  nodes?: LayoutNode[];
  edges?: LayoutEdge[];
  districts?: District[];
  highlights?: Highlight[];
}

function layout(spec: LayoutSpec = {}): AnnotatedLayout {
  return {
    nodes: spec.nodes ?? [],
    edges: spec.edges ?? [],
    districts: spec.districts ?? [],
    bounds: { width: 1920, height: 1080 },
    highlights: spec.highlights ?? [],
    labels: [],
  };
}

/** Deterministic PRNG, so a property style test never flakes. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/*
 * A model of how the layout agent sizes a node, so the property tests below run
 * against the shapes the force simulation actually produces rather than against
 * invented numbers. Mirrors functions/lib/agents/layout.ts.
 */
const MIN_NODE_SIZE = 20;
const MAX_NODE_WIDTH = 60;
const MAX_NODE_HEIGHT = 100;
/** Mirrors FORCE_COLLISION_PADDING in the layout agent. */
const COLLISION_PADDING = 4;
const SIZE_SCALE: Record<FileType, number> = {
  source: 1,
  docs: 1,
  asset: 1,
  test: 0.7,
  config: 0.8,
};

function layoutSize(loc: number, maxLoc: number, type: FileType, isEntry: boolean) {
  const t = Math.sqrt(Math.min(loc, maxLoc) / maxLoc);
  const scale = SIZE_SCALE[type] * (isEntry ? 1.5 : 1);
  return {
    width: Math.max(MIN_NODE_SIZE, (MIN_NODE_SIZE + t * (MAX_NODE_WIDTH - MIN_NODE_SIZE)) * scale),
    height: Math.max(MIN_NODE_SIZE, (MIN_NODE_SIZE + t * (MAX_NODE_HEIGHT - MIN_NODE_SIZE)) * scale),
  };
}

/** The radius forceCollide used to keep two nodes apart. */
function collisionRadius(n: LayoutNode): number {
  return Math.max(n.width, n.height) / 2 + COLLISION_PADDING;
}

/** A spread of nodes covering the whole size range the layout can emit. */
function realisticNodes(count: number, seed = 20260805): LayoutNode[] {
  const random = mulberry32(seed);
  const types: FileType[] = ['source', 'test', 'config', 'docs', 'asset'];
  const maxLoc = 4000;
  const out: LayoutNode[] = [];
  for (let i = 0; i < count; i += 1) {
    const type = types[i % types.length];
    const isEntry = i % 17 === 0;
    // Bias toward small files, which is where the footprint floor bites.
    const loc = Math.round(maxLoc * random() ** 3);
    const size = layoutSize(loc, maxLoc, type, isEntry);
    out.push(
      node({
        id: `src/dir${i % 7}/file${i}.ts`,
        loc,
        type,
        x: random() * 1920,
        y: random() * 1080,
        width: size.width,
        height: size.height,
      }),
    );
  }
  return out;
}

function overlaps(a: SceneNode, b: SceneNode): boolean {
  return Math.abs(a.wx - b.wx) < a.hx + b.hx && Math.abs(a.wy - b.wy) < a.hy + b.hy;
}

const heightsOf = (spec: LayoutSpec, exaggeration?: number) =>
  buildScene(layout(spec), exaggeration === undefined ? {} : { exaggeration }).nodes.map(
    (n) => n.height,
  );

/* -------------------------------------------------------------------------- */

describe('building height', () => {
  it('grows strictly with lines of code', () => {
    const locs = [0, 1, 2, 5, 20, 90, 400, 1800, 9000];
    const heights = heightsOf({
      nodes: locs.map((loc, i) => node({ id: `f${i}.ts`, loc })),
    });

    for (let i = 1; i < heights.length; i += 1) {
      expect(heights[i]).toBeGreaterThan(heights[i - 1]);
    }
  });

  it('still gives an empty file a building rather than a smear on the ground', () => {
    const heights = heightsOf({
      nodes: [node({ id: 'empty.ts', loc: 0 }), node({ id: 'big.ts', loc: 5000 })],
    });

    // MIN_HEIGHT in the source is 9 layout units.
    expect(heights[0]).toBeGreaterThanOrEqual(9);
    expect(heights[0]).toBe(Math.min(...heights));
    expect(Number.isFinite(heights[0])).toBe(true);
  });

  it('never pushes a tower past the designed ceiling at 1x', () => {
    const heights = heightsOf({
      nodes: [node({ id: 'a.ts', loc: 0 }), node({ id: 'b.ts', loc: 250000 })],
    });
    // MAX_HEIGHT in the source is 104 layout units.
    expect(Math.max(...heights)).toBeLessThanOrEqual(104);
  });

  it('multiplies every building by the exaggeration, in proportion', () => {
    const spec: LayoutSpec = {
      nodes: [0, 30, 700, 12000].map((loc, i) => node({ id: `f${i}.ts`, loc })),
    };
    const base = heightsOf(spec, 1);
    const tall = heightsOf(spec, 2.5);

    tall.forEach((height, i) => expect(height).toBeCloseTo(base[i] * 2.5, 10));
  });

  it('does not divide by zero when every file in the repo is the same size', () => {
    for (const loc of [0, 1, 2, 100]) {
      const heights = heightsOf({
        nodes: Array.from({ length: 5 }, (_, i) => node({ id: `f${i}.ts`, loc })),
      });

      expect(heights).toHaveLength(5);
      for (const height of heights) {
        expect(Number.isNaN(height)).toBe(false);
        expect(Number.isFinite(height)).toBe(true);
        expect(height).toBeGreaterThan(0);
      }
      expect(new Set(heights).size).toBe(1);
    }
  });

  it('survives a repo where every file is empty', () => {
    const heights = heightsOf({
      nodes: Array.from({ length: 3 }, (_, i) => node({ id: `f${i}.ts`, loc: 0 })),
    });
    expect(heights.every((h) => h >= 9)).toBe(true);
  });
});

describe('footprints', () => {
  it('never overlap, because the painter has no depth buffer to save it', () => {
    // The property: every half extent stays strictly inside the separation the
    // force simulation guaranteed, which is max(width, height) / 2.
    const nodes = realisticNodes(400);
    const scene = buildScene(layout({ nodes }));

    expect(scene.nodes).toHaveLength(nodes.length);
    scene.nodes.forEach((placed, i) => {
      const source = nodes[i];
      const separation = Math.max(source.width, source.height) / 2;

      expect(placed.hx).toBeLessThan(separation);
      expect(placed.hy).toBeLessThan(separation);
      expect(placed.hx).toBeGreaterThan(0);
      expect(placed.hx).toBe(placed.hy);
    });
  });

  it('stay clear of a diagonal neighbour parked at the exact collision distance', () => {
    // The per node bound above is necessary but not sufficient on its own: two
    // centres separated by a circular collision radius are only 1/sqrt(2) as far
    // apart along each axis, and footprints are axis aligned squares. This is
    // the pairwise check that actually proves the invariant.
    const profiles = realisticNodes(60);

    for (let i = 0; i < profiles.length; i += 1) {
      for (let j = i + 1; j < profiles.length; j += 1) {
        const gap = (collisionRadius(profiles[i]) + collisionRadius(profiles[j])) / Math.SQRT2;
        const a = { ...profiles[i], id: 'a', x: 0, y: 0 };
        const b = { ...profiles[j], id: 'b', x: gap, y: gap };
        const scene = buildScene(layout({ nodes: [a, b] }));

        expect(overlaps(scene.nodes[0], scene.nodes[1])).toBe(false);
      }
    }
  });

  it('shrink for the file types that should read as low rise outbuildings', () => {
    const nodes: LayoutNode[] = (['source', 'test', 'config', 'docs', 'asset'] as FileType[]).map(
      (type) => node({ id: `${type}.ts`, type, width: 60, height: 100 }),
    );
    const scene = buildScene(layout({ nodes }));
    const half = (type: string) => scene.nodes.find((n) => n.id === `${type}.ts`)!.hx;

    expect(half('test')).toBeLessThan(half('source'));
    expect(half('config')).toBeLessThan(half('source'));
    expect(half('docs')).toBeLessThan(half('source'));
    expect(half('asset')).toBeLessThan(half('config'));
  });

  /*
   * DEFECT. MIN_FOOTPRINT is a flat 5.5 and is not bounded by the node's own
   * size, so any node whose larger axis is under 11 units gets a footprint wider
   * than the gap the simulation left around it, and two neighbours intersect.
   * Nothing in scene.ts enforces the coupling: the only reason this is not
   * visible today is MIN_NODE_SIZE = 20 over in the layout agent.
   */
  it('keeps the invariant for a node smaller than the layout agent minimum', () => {
    // The minimum footprint used to be an unconditional floor, which a node
    // below 11 units on its larger axis could not satisfy without spilling
    // outside the gap the simulation left around it.
    const scene = buildScene(
      layout({ nodes: [node({ id: 'tiny.ts', width: 10, height: 10, loc: 3 })] }),
    );
    expect(scene.nodes[0].hx).toBeLessThan(Math.max(10, 10) / 2);
  });

  it('never exceeds the diagonal safe bound, for every size the layout can emit', () => {
    // forceCollide separates centres by max(w, h) / 2 in Euclidean distance,
    // but footprints are axis aligned squares. On the diagonal the axis gap is
    // only 1/sqrt(2) of that, so this is the bound that actually matters.
    const sizes = [
      [20, 20],
      [20, 34],
      [48, 20],
      [48, 80],
      [34, 62],
      [10, 10],
    ];
    const scene = buildScene(
      layout({
        nodes: sizes.map(([width, height], i) =>
          node({ id: `n${i}.ts`, width, height, loc: 100 }),
        ),
      }),
    );

    scene.nodes.forEach((built, i) => {
      const [width, height] = sizes[i];
      const safe = Math.max(width, height) / (2 * Math.SQRT2);
      expect(built.hx).toBeLessThanOrEqual(safe + 1e-9);
      expect(built.hy).toBeLessThanOrEqual(safe + 1e-9);
    });
  });
});

describe('district identity', () => {
  const spec: LayoutSpec = {
    nodes: [
      node({ id: 'zzz/a.ts' }),
      node({ id: 'zzz/b.ts' }),
      node({ id: 'zzz/c.ts' }),
      node({ id: 'aaa/a.ts' }),
      node({ id: 'aaa/b.ts' }),
      node({ id: 'aaa/c.ts' }),
      node({ id: 'mid/a.ts' }),
      node({ id: 'mid/b.ts' }),
      node({ id: 'solo/a.ts' }),
    ],
    districts: [
      district('mid', ['mid/a.ts', 'mid/b.ts']),
      district('solo', ['solo/a.ts']),
      district('zzz', ['zzz/a.ts', 'zzz/b.ts', 'zzz/c.ts']),
      district('aaa', ['aaa/a.ts', 'aaa/b.ts', 'aaa/c.ts']),
    ],
  };

  it('ranks districts by file count and breaks a tie on the name', () => {
    const scene = buildScene(layout(spec));
    const indexByName = new Map(scene.districts.map((d) => [d.name, d.index]));

    expect(indexByName.get('aaa')).toBe(0);
    expect(indexByName.get('zzz')).toBe(1);
    expect(indexByName.get('mid')).toBe(2);
    expect(indexByName.get('solo')).toBe(3);
  });

  it('ignores the order the backend happened to emit districts in', () => {
    const forward = buildScene(layout(spec));
    const reversed = buildScene(layout({ ...spec, districts: [...spec.districts!].reverse() }));

    const names = (scene: ReturnType<typeof buildScene>) =>
      scene.districts.map((d) => `${d.index}:${d.name}`).sort();
    expect(names(reversed)).toEqual(names(forward));
  });

  it('hands the same file the same hue index on two builds of the same layout', () => {
    const first = buildScene(layout(spec));
    const second = buildScene(layout(spec));
    const fingerprint = (scene: ReturnType<typeof buildScene>) =>
      scene.nodes.map((n) => `${n.id}=${n.districtIndex}/${n.districtName}`);

    expect(fingerprint(second)).toEqual(fingerprint(first));
  });

  it('drops a district whose files never made it into the layout', () => {
    const scene = buildScene(
      layout({
        nodes: [node({ id: 'src/a.ts' })],
        districts: [
          district('ghost', ['dropped/one.ts', 'dropped/two.ts', 'dropped/three.ts']),
          district('src', ['src/a.ts']),
        ],
      }),
    );

    expect(scene.districts.map((d) => d.name)).toEqual(['src']);
    for (const plate of scene.districts) {
      for (const edge of [plate.minX, plate.minY, plate.maxX, plate.maxY]) {
        expect(Number.isFinite(edge)).toBe(true);
      }
    }
    // The ghost district still consumed rank 0, so the survivor keeps rank 1.
    // Hue assignment must not renumber, or dropping a stale district would
    // recolour the whole city.
    expect(scene.districts[0].index).toBe(1);
  });

  it('pads the plate out past the buildings standing on it', () => {
    const scene = buildScene(
      layout({
        nodes: [node({ id: 'src/a.ts', x: 100, y: 200 }), node({ id: 'src/b.ts', x: 400, y: 260 })],
        districts: [district('src', ['src/a.ts', 'src/b.ts'])],
      }),
    );
    const plate = scene.districts[0];

    for (const building of scene.nodes) {
      expect(plate.minX).toBeLessThan(building.wx - building.hx);
      expect(plate.maxX).toBeGreaterThan(building.wx + building.hx);
      expect(plate.minY).toBeLessThan(building.wy - building.hy);
      expect(plate.maxY).toBeGreaterThan(building.wy + building.hy);
    }
    expect(plate.fileCount).toBe(2);
    expect(plate.loc).toBe(200);
  });

  it('marks a file that belongs to no district as unclassified', () => {
    // draw.ts branches on this exact string to reach neutralMaterial, so an
    // orphan is painted grey rather than silently wearing district zero's hue.
    const scene = buildScene(
      layout({
        nodes: [node({ id: 'src/a.ts' }), node({ id: 'orphan.ts' })],
        districts: [district('src', ['src/a.ts'])],
      }),
    );
    const orphan = scene.nodeById.get('orphan.ts')!;

    expect(orphan.districtName).toBe(UNCLASSIFIED);
    // It also does not appear on any plate, so it stands on bare ground.
    expect(scene.districts.some((d) => d.nodeIds.includes('orphan.ts'))).toBe(false);
  });
});

describe('landmark signals', () => {
  it('merges several highlights on one file into a single ordered list', () => {
    const scene = buildScene(
      layout({
        nodes: [node({ id: 'src/app.ts' })],
        highlights: [
          highlight({ nodeId: 'src/app.ts', type: 'hotspot' }),
          highlight({ nodeId: 'src/app.ts', type: 'entry' }),
          highlight({ nodeId: 'src/app.ts', type: 'core' }),
          highlight({ nodeId: 'src/app.ts', type: 'core' }),
        ],
      }),
    );

    expect(scene.nodes[0].signals).toEqual(['entry', 'core', 'hotspot']);
  });

  it('orders entry before core before hotspot no matter how they arrived', () => {
    const combinations: string[][] = [
      ['core', 'entry'],
      ['hotspot', 'entry'],
      ['hotspot', 'core'],
      ['core', 'hotspot', 'entry'],
    ];

    for (const kinds of combinations) {
      const scene = buildScene(
        layout({
          nodes: [node({ id: 'a.ts' })],
          highlights: kinds.map((type) => highlight({ nodeId: 'a.ts', type })),
        }),
      );
      const rank = { entry: 0, core: 1, hotspot: 2 };
      const signals = scene.nodes[0].signals;

      expect(signals).toHaveLength(kinds.length);
      for (let i = 1; i < signals.length; i += 1) {
        expect(rank[signals[i]]).toBeGreaterThan(rank[signals[i - 1]]);
      }
    }
  });

  it('keeps the first reason it was given', () => {
    const scene = buildScene(
      layout({
        nodes: [node({ id: 'a.ts' })],
        highlights: [
          highlight({ nodeId: 'a.ts', type: 'entry', reason: 'Entry point' }),
          highlight({ nodeId: 'a.ts', type: 'hotspot', reason: 'Unusually large' }),
        ],
      }),
    );

    expect(scene.nodes[0].reason).toBe('Entry point');
  });

  it('discards a highlight kind the palette has never heard of, rather than crashing', () => {
    const scene = buildScene(
      layout({
        nodes: [node({ id: 'a.ts' })],
        highlights: [
          highlight({ nodeId: 'a.ts', type: 'sparkle' }),
          highlight({ nodeId: 'a.ts', type: 'entry' }),
        ],
      }),
    );

    expect(scene.nodes[0].signals).toEqual(['entry']);
    expect(scene.stats.landmarks).toEqual({ entry: 1, core: 0, hotspot: 0 });
  });

  it('leaves a file with no highlight carrying an empty signal list', () => {
    const scene = buildScene(layout({ nodes: [node({ id: 'a.ts' })] }));

    expect(scene.nodes[0].signals).toEqual([]);
    expect(scene.nodes[0].reason).toBeUndefined();
  });

  /*
   * DEFECT. orderSignals filters with `kind in SIGNAL_RANK`, and `in` walks the
   * prototype chain, so 'constructor', 'toString' and '__proto__' all pass the
   * guard. The bogus kind then reaches `landmarks[signal] += 1` in summarise,
   * where landmarks.constructor is the Object function, and the count comes back
   * as a concatenated string. Highlight types are typed as a union but they
   * arrive as untrusted JSON from /api/analyze and from public/cache.
   * Object.hasOwn or a Set would close it.
   */
  it('discards a highlight kind that collides with an Object prototype key', () => {
    const scene = buildScene(
      layout({
        nodes: [node({ id: 'a.ts' })],
        highlights: [highlight({ nodeId: 'a.ts', type: 'constructor' })],
      }),
    );

    expect(scene.nodes[0].signals).toEqual([]);
    expect(Object.keys(scene.stats.landmarks).sort()).toEqual(['core', 'entry', 'hotspot']);
  });
});

describe('choosing which dependencies to draw', () => {
  const four = [
    node({ id: 'a.ts' }),
    node({ id: 'b.ts' }),
    node({ id: 'c.ts' }),
    node({ id: 'd.ts' }),
  ];

  it('drops an edge from a file to itself', () => {
    const scene = buildScene(
      layout({
        nodes: four,
        edges: [
          { source: 'a.ts', target: 'a.ts', strength: 1 },
          { source: 'a.ts', target: 'b.ts', strength: 1 },
        ],
      }),
    );

    expect(scene.edges).toHaveLength(1);
    expect(scene.edges[0]).toMatchObject({ source: 'a.ts', target: 'b.ts' });
  });

  it('collapses a pair that the backend emitted twice', () => {
    const scene = buildScene(
      layout({
        nodes: four,
        edges: [
          { source: 'a.ts', target: 'b.ts', strength: 1 },
          { source: 'a.ts', target: 'b.ts', strength: 0.5 },
          { source: 'a.ts', target: 'b.ts', strength: 1 },
        ],
      }),
    );

    expect(scene.edges).toHaveLength(1);
    expect(scene.edges[0].strength).toBe(1);
    expect(scene.stats.droppedEdges).toBe(0);
  });

  it('keeps both directions of a mutual import, because an arc is directed', () => {
    const scene = buildScene(
      layout({
        nodes: four,
        edges: [
          { source: 'a.ts', target: 'b.ts', strength: 1 },
          { source: 'b.ts', target: 'a.ts', strength: 1 },
        ],
      }),
    );

    expect(scene.edges).toHaveLength(2);
  });

  it('drops an edge that points at a file which never made the layout', () => {
    const scene = buildScene(
      layout({
        nodes: four,
        edges: [
          { source: 'a.ts', target: 'ghost.ts', strength: 1 },
          { source: 'ghost.ts', target: 'a.ts', strength: 1 },
          { source: 'ghost.ts', target: 'phantom.ts', strength: 1 },
          { source: 'a.ts', target: 'b.ts', strength: 1 },
        ],
      }),
    );

    expect(scene.edges).toHaveLength(1);
    expect(scene.stats.droppedEdges).toBe(0);
    for (const edge of scene.edges) {
      expect(scene.nodeById.has(edge.source)).toBe(true);
      expect(scene.nodeById.has(edge.target)).toBe(true);
    }
  });

  it('stamps each arc with the district of the file it leaves from', () => {
    const scene = buildScene(
      layout({
        nodes: [node({ id: 'aaa/a.ts' }), node({ id: 'zzz/z.ts' })],
        districts: [district('zzz', ['zzz/z.ts']), district('aaa', ['aaa/a.ts'])],
        edges: [{ source: 'zzz/z.ts', target: 'aaa/a.ts', strength: 1 }],
      }),
    );

    expect(scene.edges[0].districtIndex).toBe(scene.nodeById.get('zzz/z.ts')!.districtIndex);
  });

  it('indexes every arc under both of its endpoints', () => {
    const scene = buildScene(
      layout({
        nodes: four,
        edges: [
          { source: 'a.ts', target: 'b.ts', strength: 1 },
          { source: 'b.ts', target: 'c.ts', strength: 1 },
        ],
      }),
    );

    expect(scene.edgesByNode.get('a.ts')).toHaveLength(1);
    expect(scene.edgesByNode.get('b.ts')).toHaveLength(2);
    expect(scene.edgesByNode.get('c.ts')).toHaveLength(1);
    expect(scene.edgesByNode.has('d.ts')).toBe(false);

    let indexed = 0;
    scene.edgesByNode.forEach((list) => {
      indexed += list.length;
    });
    expect(indexed).toBe(scene.edges.length * 2);
  });

  it('counts the in and out degree of every file from the raw edge list', () => {
    const scene = buildScene(
      layout({
        nodes: four,
        edges: [
          { source: 'a.ts', target: 'b.ts', strength: 1 },
          { source: 'c.ts', target: 'b.ts', strength: 1 },
          { source: 'b.ts', target: 'd.ts', strength: 1 },
        ],
      }),
    );
    const b = scene.nodeById.get('b.ts')!;

    expect(b.inDegree).toBe(2);
    expect(b.outDegree).toBe(1);
    expect(scene.nodeById.get('d.ts')!.outDegree).toBe(0);
  });

  describe('when a repo has more dependencies than the canvas can carry', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `src/f${i}.ts`);
    const dense: LayoutEdge[] = [];
    for (let i = 0; i < ids.length && dense.length < 1000; i += 1) {
      for (let j = 0; j < ids.length && dense.length < 1000; j += 1) {
        if (i !== j) dense.push({ source: ids[i], target: ids[j], strength: 0.5 });
      }
    }
    const denseSpec: LayoutSpec = {
      nodes: ids.map((id) => node({ id })),
      edges: dense,
      highlights: [highlight({ nodeId: ids[0], type: 'entry' })],
    };

    it('caps the arcs it draws and reports the true overflow', () => {
      const scene = buildScene(layout(denseSpec));

      expect(dense).toHaveLength(1000);
      // MAX_EDGES in the source is 900.
      expect(scene.edges).toHaveLength(900);
      expect(scene.stats.edgeCount).toBe(900);
      expect(scene.stats.droppedEdges).toBe(100);
      expect(scene.edges.length + scene.stats.droppedEdges).toBe(dense.length);
    });

    it('lets every arc that touches a landmark through the cap first', () => {
      const scene = buildScene(layout(denseSpec));
      const kept = new Set(scene.edges.map((e) => `${e.source} -> ${e.target}`));
      const touching = dense.filter((e) => e.source === ids[0] || e.target === ids[0]);

      expect(touching.length).toBeGreaterThan(0);
      for (const edge of touching) {
        expect(kept.has(`${edge.source} -> ${edge.target}`)).toBe(true);
      }
    });

    it('prefers a strong import over a weak one when both are ordinary', () => {
      const many: LayoutEdge[] = dense.map((edge, i) => ({ ...edge, strength: i < 900 ? 0.2 : 1 }));
      const scene = buildScene(layout({ ...denseSpec, edges: many, highlights: [] }));
      const kept = new Set(scene.edges.map((e) => `${e.source} -> ${e.target}`));

      for (const edge of many.slice(900)) {
        expect(kept.has(`${edge.source} -> ${edge.target}`)).toBe(true);
      }
    });
  });

  /*
   * The dedupe key joins the two ids with a separator that cannot occur inside
   * a file path, so two genuinely different arcs can never collide on it. Worth
   * a test, because a plain space here would silently discard one of the two
   * arcs below and would not even count it in droppedEdges.
   */
  it('does not confuse two different arcs whose paths contain spaces', () => {
    const scene = buildScene(
      layout({
        nodes: [node({ id: 'a b' }), node({ id: 'c' }), node({ id: 'a' }), node({ id: 'b c' })],
        edges: [
          { source: 'a b', target: 'c', strength: 1 },
          { source: 'a', target: 'b c', strength: 1 },
        ],
      }),
    );

    expect(scene.edges).toHaveLength(2);
    expect(scene.stats.droppedEdges).toBe(0);
  });
});

describe('the summary panel numbers', () => {
  it('totals the files, the lines and the districts it actually rendered', () => {
    const scene = buildScene(
      layout({
        nodes: [
          node({ id: 'src/a.ts', loc: 10 }),
          node({ id: 'src/b.ts', loc: 25 }),
          node({ id: 'lib/c.ts', loc: 65 }),
        ],
        districts: [district('src', ['src/a.ts', 'src/b.ts']), district('lib', ['lib/c.ts'])],
        edges: [{ source: 'src/a.ts', target: 'lib/c.ts', strength: 1 }],
      }),
    );

    expect(scene.stats.fileCount).toBe(3);
    expect(scene.stats.totalLoc).toBe(100);
    expect(scene.stats.districtCount).toBe(2);
    expect(scene.stats.edgeCount).toBe(1);
    expect(scene.stats.droppedEdges).toBe(0);
  });

  it('takes the middle file for an odd count', () => {
    const scene = buildScene(
      layout({ nodes: [7, 300, 41].map((loc, i) => node({ id: `f${i}.ts`, loc })) }),
    );
    expect(scene.stats.medianLoc).toBe(41);
  });

  it('averages the two middle files for an even count', () => {
    // A headline stat, so it is the real median rather than whichever of the
    // middle pair the index happened to land on.
    const scene = buildScene(
      layout({ nodes: [10, 20, 30, 40].map((loc, i) => node({ id: `f${i}.ts`, loc })) }),
    );
    expect(scene.stats.medianLoc).toBe(25);
  });

  it('reports zero as the median of an empty repo', () => {
    expect(buildScene(layout()).stats.medianLoc).toBe(0);
  });

  it('folds unknown and missing languages into "other"', () => {
    const scene = buildScene(
      layout({
        nodes: [
          node({ id: 'a.ts', language: 'typescript' }),
          node({ id: 'b.ts', language: 'typescript' }),
          node({ id: 'c.bin', language: 'unknown' }),
          node({ id: 'd.bin', language: '' }),
          node({ id: 'e.css', language: 'css' }),
        ],
      }),
    );
    const byName = new Map(scene.stats.languages.map((l) => [l.name, l.files]));

    expect(byName.get('other')).toBe(2);
    expect(byName.get('typescript')).toBe(2);
    expect(byName.get('css')).toBe(1);
    expect(byName.has('unknown')).toBe(false);
  });

  it('orders languages by file count and lets the shares add up to one', () => {
    const scene = buildScene(
      layout({
        nodes: [
          node({ id: 'a.ts', language: 'typescript' }),
          node({ id: 'b.ts', language: 'typescript' }),
          node({ id: 'c.py', language: 'python' }),
          node({ id: 'd.go', language: 'go' }),
        ],
      }),
    );

    expect(scene.stats.languages.map((l) => l.name)).toEqual(['typescript', 'go', 'python']);
    expect(scene.stats.languages.reduce((sum, l) => sum + l.share, 0)).toBeCloseTo(1, 10);
    expect(scene.stats.languages[0].share).toBeCloseTo(0.5, 10);
  });

  it('counts every landmark kind separately', () => {
    const scene = buildScene(
      layout({
        nodes: ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map((id) => node({ id })),
        highlights: [
          highlight({ nodeId: 'a.ts', type: 'entry' }),
          highlight({ nodeId: 'b.ts', type: 'entry' }),
          highlight({ nodeId: 'b.ts', type: 'core' }),
          highlight({ nodeId: 'c.ts', type: 'hotspot' }),
          highlight({ nodeId: 'd.ts', type: 'hotspot' }),
          highlight({ nodeId: 'd.ts', type: 'core' }),
        ],
      }),
    );

    expect(scene.stats.landmarks).toEqual({ entry: 2, core: 2, hotspot: 2 });
  });

  it('reports the deepest path it rendered', () => {
    const scene = buildScene(
      layout({
        nodes: [node({ id: 'a.ts' }), node({ id: 'src/deep/deeper/file.ts' })],
      }),
    );
    expect(scene.stats.maxDepth).toBe(4);
  });
});

describe('placing the city in front of the camera', () => {
  const city = layout({
    nodes: [
      node({ id: 'src/a.ts', x: 40, y: 900, loc: 500 }),
      node({ id: 'src/b.ts', x: 700, y: 120, loc: 30 }),
      node({ id: 'lib/c.ts', x: 1500, y: 640, loc: 2200 }),
      node({ id: 'lib/d.ts', x: 260, y: 300, loc: 90 }),
    ],
    districts: [district('src', ['src/a.ts', 'src/b.ts']), district('lib', ['lib/c.ts', 'lib/d.ts'])],
  });

  it('returns buildings back to front for every azimuth', () => {
    const scene = buildScene(city);

    for (const azimuth of AZIMUTHS) {
      const placed = placeNodes(scene.nodes, azimuth);

      expect(placed).toHaveLength(scene.nodes.length);
      for (let i = 1; i < placed.length; i += 1) {
        expect(placed[i].depth).toBeGreaterThanOrEqual(placed[i - 1].depth);
      }
      // The camera space extents have to be the rotated ones, not the world ones.
      for (const building of placed) {
        expect(Number.isFinite(building.rx)).toBe(true);
        expect(Number.isFinite(building.ry)).toBe(true);
        expect(building.rhx).toBeGreaterThan(0);
        expect(building.rhy).toBeGreaterThan(0);
      }
    }
  });

  it('returns plates back to front for every azimuth', () => {
    const scene = buildScene(city);

    for (const azimuth of AZIMUTHS) {
      const placed = placeDistricts(scene.districts, azimuth);

      expect(placed).toHaveLength(scene.districts.length);
      for (let i = 1; i < placed.length; i += 1) {
        expect(placed[i].depth).toBeGreaterThanOrEqual(placed[i - 1].depth);
      }
      for (const plate of placed) {
        expect(plate.rhx).toBeGreaterThan(0);
        expect(plate.rhy).toBeGreaterThan(0);
      }
    }
  });

  it('leaves the scene it was handed untouched', () => {
    const scene = buildScene(city);
    const before = scene.nodes.map((n) => n.id);
    placeNodes(scene.nodes, 1);

    expect(scene.nodes.map((n) => n.id)).toEqual(before);
  });

  it('gives a single building a screen box with real width and height', () => {
    const scene = buildScene(layout({ nodes: [node({ id: 'only.ts', x: 12, y: -30, loc: 400 })] }));

    for (const azimuth of AZIMUTHS) {
      const bounds = sceneBounds(scene.nodes, azimuth);

      expect(bounds.maxX - bounds.minX).toBeGreaterThan(0);
      expect(bounds.maxY - bounds.minY).toBeGreaterThan(0);
      for (const value of Object.values(bounds)) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it('reaches from below the plate to the top of the tallest roof', () => {
    const scene = buildScene(city);
    const bounds = sceneBounds(scene.nodes, 0);
    const tallest = Math.max(...scene.nodes.map((n) => n.height));

    expect(bounds.maxY - bounds.minY).toBeGreaterThan(tallest);
  });
});

describe('a repo with nothing in it', () => {
  it('builds an empty city without throwing anywhere', () => {
    const scene = buildScene(layout());

    expect(scene.nodes).toEqual([]);
    expect(scene.districts).toEqual([]);
    expect(scene.edges).toEqual([]);
    expect(scene.nodeById.size).toBe(0);
    expect(scene.edgesByNode.size).toBe(0);
    expect(scene.stats).toMatchObject({
      fileCount: 0,
      totalLoc: 0,
      districtCount: 0,
      edgeCount: 0,
      droppedEdges: 0,
      maxDepth: 0,
      medianLoc: 0,
    });
    expect(scene.stats.languages).toEqual([]);
    expect(scene.stats.landmarks).toEqual({ entry: 0, core: 0, hotspot: 0 });
  });

  it('places and frames an empty city without throwing either', () => {
    const scene = buildScene(layout());

    for (const azimuth of AZIMUTHS) {
      expect(placeNodes(scene.nodes, azimuth)).toEqual([]);
      expect(placeDistricts(scene.districts, azimuth)).toEqual([]);
      // The documented fallback box, not a set of infinities.
      expect(sceneBounds(scene.nodes, azimuth)).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
    }
  });

  it('survives districts and highlights that point at nothing at all', () => {
    expect(() =>
      buildScene(
        layout({
          districts: [district('ghost', ['nope.ts'])],
          highlights: [highlight({ nodeId: 'nope.ts', type: 'entry' })],
          edges: [{ source: 'nope.ts', target: 'also-nope.ts', strength: 1 }],
        }),
      ),
    ).not.toThrow();
  });
});
