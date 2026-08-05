/**
 * Tests for Agent 3: Layout Engine
 */

import { describe, it, expect } from 'vitest';
import { MAX_RENDERED_EDGES, generateLayout, selectRenderableEdges } from '../layout';
import type { CodeStructure, ParsedFile, Dependency } from '../../types';

/**
 * Helper to create a test file
 */
function createTestFile(
  path: string,
  overrides: Partial<ParsedFile> = {}
): ParsedFile {
  return {
    path,
    type: 'source',
    language: 'typescript',
    loc: 100,
    imports: [],
    exports: [],
    isEntryPoint: false,
    ...overrides
  };
}

/**
 * Helper to create a test structure
 */
function createTestStructure(
  files: ParsedFile[],
  dependencies: Dependency[] = []
): CodeStructure {
  const languageBreakdown: Record<string, number> = {};
  let totalLOC = 0;
  let maxDepth = 0;

  for (const file of files) {
    languageBreakdown[file.language] = (languageBreakdown[file.language] || 0) + file.loc;
    totalLOC += file.loc;
    const depth = file.path.split('/').length;
    maxDepth = Math.max(maxDepth, depth);
  }

  return {
    files,
    dependencies,
    metrics: {
      totalFiles: files.length,
      totalLOC,
      languageBreakdown,
      directoryDepth: maxDepth
    }
  };
}

describe('Agent 3: Layout Engine', () => {
  describe('generateLayout', () => {
    it('should handle empty structure gracefully', async () => {
      const structure = createTestStructure([]);
      const result = await generateLayout(structure);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.nodes).toHaveLength(0);
        expect(result.data.edges).toHaveLength(0);
        expect(result.data.districts).toHaveLength(0);
        expect(result.data.bounds).toEqual({ width: 0, height: 0 });
      }
    });

    it('should handle single file (degenerate case)', async () => {
      const files = [createTestFile('index.ts', { isEntryPoint: true, loc: 50 })];
      const structure = createTestStructure(files);
      const result = await generateLayout(structure);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.nodes).toHaveLength(1);
        const node = result.data.nodes[0];
        
        // Should be centered
        expect(node.x).toBe(1920 / 2);
        expect(node.y).toBe(1080 / 2);
        
        // Should have valid dimensions
        expect(node.width).toBeGreaterThan(0);
        expect(node.height).toBeGreaterThan(0);
        expect(Number.isFinite(node.width)).toBe(true);
        expect(Number.isFinite(node.height)).toBe(true);
        
        // Should have correct metadata
        expect(node.id).toBe('index.ts');
        expect(node.label).toBe('index.ts');
        expect(node.metadata.path).toBe('index.ts');
        expect(node.metadata.loc).toBe(50);
      }
    });

    it('should layout small repo (50 nodes) with all files visible', async () => {
      const files: ParsedFile[] = [];
      
      // Create 50 files across different directories
      for (let i = 0; i < 10; i++) {
        files.push(createTestFile(`src/components/Component${i}.tsx`, { loc: 100 + i * 10 }));
        files.push(createTestFile(`src/utils/util${i}.ts`, { loc: 50 + i * 5 }));
        files.push(createTestFile(`lib/helpers/helper${i}.ts`, { loc: 75 + i * 7 }));
        files.push(createTestFile(`tests/unit/test${i}.test.ts`, { type: 'test', loc: 30 + i * 3 }));
        files.push(createTestFile(`docs/guide${i}.md`, { type: 'docs', language: 'markdown', loc: 20 }));
      }

      const structure = createTestStructure(files);
      const result = await generateLayout(structure);

      expect(result.success).toBe(true);
      if (result.success) {
        // All files should be included
        expect(result.data.nodes).toHaveLength(50);
        
        // Check for NaN positions
        for (const node of result.data.nodes) {
          expect(Number.isFinite(node.x)).toBe(true);
          expect(Number.isFinite(node.y)).toBe(true);
          expect(Number.isFinite(node.width)).toBe(true);
          expect(Number.isFinite(node.height)).toBe(true);
        }
        
        // Should have multiple districts
        expect(result.data.districts.length).toBeGreaterThan(1);
        
        // Each district should have a color
        for (const district of result.data.districts) {
          expect(district.color).toBeTruthy();
          expect(district.nodes.length).toBeGreaterThan(0);
        }
        
        // Bounds should be reasonable
        expect(result.data.bounds.width).toBeGreaterThan(0);
        expect(result.data.bounds.height).toBeGreaterThan(0);
      }
    });

    it('should cap large repo at 500 nodes with prioritization', async () => {
      const files: ParsedFile[] = [];
      
      // Create 1000 files
      // 5 entry points
      for (let i = 0; i < 5; i++) {
        files.push(createTestFile(`index${i}.ts`, { isEntryPoint: true, loc: 200 }));
      }
      
      // 500 source files with varying LOC
      for (let i = 0; i < 500; i++) {
        files.push(createTestFile(`src/file${i}.ts`, { loc: 100 + Math.random() * 500 }));
      }
      
      // 300 test files
      for (let i = 0; i < 300; i++) {
        files.push(createTestFile(`tests/test${i}.test.ts`, { type: 'test', loc: 50 }));
      }
      
      // 195 other files (config, docs)
      for (let i = 0; i < 100; i++) {
        files.push(createTestFile(`docs/doc${i}.md`, { type: 'docs', language: 'markdown', loc: 30 }));
      }
      for (let i = 0; i < 95; i++) {
        files.push(createTestFile(`config${i}.json`, { type: 'config', language: 'json', loc: 20 }));
      }

      const structure = createTestStructure(files);
      const result = await generateLayout(structure, { maxNodes: 500 });

      expect(result.success).toBe(true);
      if (result.success) {
        // Should be capped at 500
        expect(result.data.nodes.length).toBeLessThanOrEqual(500);
        
        // All entry points should be included
        const entryPointNodes = result.data.nodes.filter(n => 
          n.id.startsWith('index') && !n.id.includes('/')
        );
        expect(entryPointNodes.length).toBe(5);
        
        // Should prioritize high LOC files
        const nodeIds = new Set(result.data.nodes.map(n => n.id));
        
        // Check that entry points are included
        for (let i = 0; i < 5; i++) {
          expect(nodeIds.has(`index${i}.ts`)).toBe(true);
        }
      }
    });

    it('should create valid edges only for selected nodes', async () => {
      const files = [
        createTestFile('src/index.ts', { isEntryPoint: true }),
        createTestFile('src/utils.ts'),
        createTestFile('src/helpers.ts'),
        createTestFile('src/excluded.ts'), // Will be excluded in dependencies
      ];

      const dependencies: Dependency[] = [
        { from: 'src/index.ts', to: 'src/utils.ts', type: 'import' },
        { from: 'src/index.ts', to: 'src/helpers.ts', type: 'import' },
        { from: 'src/utils.ts', to: 'src/helpers.ts', type: 'import' },
        { from: 'src/index.ts', to: 'src/excluded.ts', type: 'dynamic' }, // Should be filtered
      ];

      // Only include first 3 files
      const structure = createTestStructure(files.slice(0, 3), dependencies);
      const result = await generateLayout(structure);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.nodes).toHaveLength(3);
        
        // Should only have edges between selected nodes
        expect(result.data.edges.length).toBeLessThanOrEqual(3);
        
        // All edges should reference valid nodes
        const nodeIds = new Set(result.data.nodes.map(n => n.id));
        for (const edge of result.data.edges) {
          expect(nodeIds.has(edge.source)).toBe(true);
          expect(nodeIds.has(edge.target)).toBe(true);
          expect(edge.strength).toBeGreaterThan(0);
          expect(edge.strength).toBeLessThanOrEqual(1);
        }
      }
    });

    it('should handle many dependencies (50+ edges)', async () => {
      const files: ParsedFile[] = [];
      const dependencies: Dependency[] = [];
      
      // Create a hub-and-spoke pattern
      files.push(createTestFile('src/index.ts', { isEntryPoint: true, loc: 500 }));
      
      for (let i = 0; i < 60; i++) {
        const path = `src/module${i}.ts`;
        files.push(createTestFile(path, { loc: 100 }));
        dependencies.push({ from: 'src/index.ts', to: path, type: 'import' });
      }

      const structure = createTestStructure(files, dependencies);
      const result = await generateLayout(structure);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.nodes.length).toBeGreaterThan(50);
        expect(result.data.edges.length).toBeGreaterThan(50);
        
        // All edges should be valid
        const nodeIds = new Set(result.data.nodes.map(n => n.id));
        for (const edge of result.data.edges) {
          expect(nodeIds.has(edge.source)).toBe(true);
          expect(nodeIds.has(edge.target)).toBe(true);
        }
      }
    });

    it('should separate multiple districts clearly', async () => {
      const files: ParsedFile[] = [];
      
      // Create files in 5 different top-level directories
      const dirs = ['src', 'lib', 'components', 'utils', 'services'];
      for (const dir of dirs) {
        for (let i = 0; i < 10; i++) {
          files.push(createTestFile(`${dir}/file${i}.ts`, { loc: 100 }));
        }
      }

      const structure = createTestStructure(files);
      const result = await generateLayout(structure);

      expect(result.success).toBe(true);
      if (result.success) {
        // Should have 5 districts
        expect(result.data.districts).toHaveLength(5);
        
        // Each district should have 10 nodes
        for (const district of result.data.districts) {
          expect(district.nodes).toHaveLength(10);
          expect(district.bounds.width).toBeGreaterThan(0);
          expect(district.bounds.height).toBeGreaterThan(0);
          expect(district.color).toBeTruthy();
        }
        
        // District names should match directories
        const districtNames = result.data.districts.map(d => d.name).sort();
        expect(districtNames).toEqual(dirs.sort());
      }
    });

    it('should handle root-level files in "root" district', async () => {
      const files = [
        createTestFile('index.ts', { isEntryPoint: true }),
        createTestFile('config.ts', { type: 'config' }),
        createTestFile('src/app.ts'),
        createTestFile('src/utils.ts'),
      ];

      const structure = createTestStructure(files);
      const result = await generateLayout(structure);

      expect(result.success).toBe(true);
      if (result.success) {
        // Should have 2 districts: "root" and "src"
        expect(result.data.districts).toHaveLength(2);
        
        const rootDistrict = result.data.districts.find(d => d.name === 'root');
        const srcDistrict = result.data.districts.find(d => d.name === 'src');
        
        expect(rootDistrict).toBeDefined();
        expect(srcDistrict).toBeDefined();
        
        if (rootDistrict && srcDistrict) {
          expect(rootDistrict.nodes).toHaveLength(2);
          expect(srcDistrict.nodes).toHaveLength(2);
        }
      }
    });

    it('should scale node sizes based on LOC', async () => {
      const files = [
        createTestFile('small.ts', { loc: 10 }),
        createTestFile('medium.ts', { loc: 100 }),
        createTestFile('large.ts', { loc: 1000 }),
      ];

      const structure = createTestStructure(files);
      const result = await generateLayout(structure);

      expect(result.success).toBe(true);
      if (result.success) {
        const small = result.data.nodes.find(n => n.id === 'small.ts')!;
        const medium = result.data.nodes.find(n => n.id === 'medium.ts')!;
        const large = result.data.nodes.find(n => n.id === 'large.ts')!;

        // Larger LOC should result in larger nodes
        expect(large.width).toBeGreaterThan(medium.width);
        expect(large.height).toBeGreaterThan(medium.height);
        expect(medium.width).toBeGreaterThan(small.width);
        expect(medium.height).toBeGreaterThan(small.height);
        
        // All should have minimum size
        expect(small.width).toBeGreaterThanOrEqual(20);
        expect(small.height).toBeGreaterThanOrEqual(20);
      }
    });

    it('should scale entry points larger than regular files', async () => {
      const files = [
        createTestFile('index.ts', { isEntryPoint: true, loc: 100 }),
        createTestFile('regular.ts', { loc: 100 }),
      ];

      const structure = createTestStructure(files);
      const result = await generateLayout(structure);

      expect(result.success).toBe(true);
      if (result.success) {
        const entryPoint = result.data.nodes.find(n => n.id === 'index.ts')!;
        const regular = result.data.nodes.find(n => n.id === 'regular.ts')!;

        // Entry point should be larger (1.5x scale)
        expect(entryPoint.width).toBeGreaterThan(regular.width);
        expect(entryPoint.height).toBeGreaterThan(regular.height);
      }
    });

    it('should scale test files smaller than source files', async () => {
      const files = [
        createTestFile('source.ts', { type: 'source', loc: 100 }),
        createTestFile('test.test.ts', { type: 'test', loc: 100 }),
      ];

      const structure = createTestStructure(files);
      const result = await generateLayout(structure);

      expect(result.success).toBe(true);
      if (result.success) {
        const source = result.data.nodes.find(n => n.id === 'source.ts')!;
        const test = result.data.nodes.find(n => n.id === 'test.test.ts')!;

        // Test should be smaller (0.7x scale)
        expect(test.width).toBeLessThan(source.width);
        expect(test.height).toBeLessThan(source.height);
      }
    });

    it('should not have overlapping nodes', async () => {
      const files: ParsedFile[] = [];
      for (let i = 0; i < 50; i++) {
        files.push(createTestFile(`src/file${i}.ts`, { loc: 100 }));
      }

      const structure = createTestStructure(files);
      const result = await generateLayout(structure);

      expect(result.success).toBe(true);
      if (result.success) {
        const nodes = result.data.nodes;
        
        // Check for overlaps (with small tolerance for collision padding)
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const n1 = nodes[i];
            const n2 = nodes[j];
            
            const dx = Math.abs(n1.x - n2.x);
            const dy = Math.abs(n1.y - n2.y);
            const minDist = (Math.max(n1.width, n1.height) + Math.max(n2.width, n2.height)) / 2;
            
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // Should not significantly overlap (allow small tolerance)
            expect(distance).toBeGreaterThan(minDist * 0.8);
          }
        }
      }
    });

    it('should respect custom canvas dimensions', async () => {
      const files: ParsedFile[] = [];
      for (let i = 0; i < 20; i++) {
        files.push(createTestFile(`src/file${i}.ts`, { loc: 100 }));
      }

      const structure = createTestStructure(files);
      const result = await generateLayout(structure, {
        canvasWidth: 800,
        canvasHeight: 600
      });

      expect(result.success).toBe(true);
      if (result.success) {
        // Bounds should not exceed custom dimensions
        expect(result.data.bounds.width).toBeLessThanOrEqual(800);
        expect(result.data.bounds.height).toBeLessThanOrEqual(600);
      }
    });

    it('should have no duplicate node IDs', async () => {
      const files: ParsedFile[] = [];
      for (let i = 0; i < 100; i++) {
        files.push(createTestFile(`src/file${i}.ts`, { loc: 100 }));
      }

      const structure = createTestStructure(files);
      const result = await generateLayout(structure);

      expect(result.success).toBe(true);
      if (result.success) {
        const ids = result.data.nodes.map(n => n.id);
        const uniqueIds = new Set(ids);
        expect(ids.length).toBe(uniqueIds.size);
      }
    });

    it('should set correct edge strengths', async () => {
      const files = [
        createTestFile('a.ts'),
        createTestFile('b.ts'),
        createTestFile('c.ts'),
      ];

      const dependencies: Dependency[] = [
        { from: 'a.ts', to: 'b.ts', type: 'import' },
        { from: 'a.ts', to: 'c.ts', type: 'dynamic' },
      ];

      const structure = createTestStructure(files, dependencies);
      const result = await generateLayout(structure);

      expect(result.success).toBe(true);
      if (result.success) {
        const staticEdge = result.data.edges.find(e => e.target === 'b.ts');
        const dynamicEdge = result.data.edges.find(e => e.target === 'c.ts');

        expect(staticEdge?.strength).toBe(1.0);
        expect(dynamicEdge?.strength).toBe(0.5);
      }
    });

    it('should include correct node labels', async () => {
      const files = [
        createTestFile('src/components/Button.tsx'),
        createTestFile('lib/utils/helpers.ts'),
        createTestFile('index.ts'),
      ];

      const structure = createTestStructure(files);
      const result = await generateLayout(structure);

      expect(result.success).toBe(true);
      if (result.success) {
        const button = result.data.nodes.find(n => n.id === 'src/components/Button.tsx')!;
        const helpers = result.data.nodes.find(n => n.id === 'lib/utils/helpers.ts')!;
        const index = result.data.nodes.find(n => n.id === 'index.ts')!;

        expect(button.label).toBe('Button.tsx');
        expect(helpers.label).toBe('helpers.ts');
        expect(index.label).toBe('index.ts');
      }
    });

    it('should preserve metadata in nodes', async () => {
      const files = [
        createTestFile('src/app.ts', { loc: 250, language: 'typescript' }),
      ];

      const structure = createTestStructure(files);
      const result = await generateLayout(structure);

      expect(result.success).toBe(true);
      if (result.success) {
        const node = result.data.nodes[0];
        expect(node.metadata.path).toBe('src/app.ts');
        expect(node.metadata.loc).toBe(250);
        expect(node.metadata.language).toBe('typescript');
      }
    });
  });
});


/* -------------------------------------------------------------------------- */

describe('choosing which dependency arcs to draw', () => {
  /**
   * `targets` gives, for each target file, how many other files import it.
   * Importers are unique per edge so nothing is accidentally deduplicated.
   */
  function graph(targets: readonly number[]): {
    dependencies: Dependency[];
    nodeIds: Set<string>;
  } {
    const dependencies: Dependency[] = [];
    const nodeIds = new Set<string>();
    let importer = 0;

    targets.forEach((count, index) => {
      const to = `src/target-${index}.ts`;
      nodeIds.add(to);
      for (let i = 0; i < count; i += 1) {
        const from = `src/importer-${importer}.ts`;
        importer += 1;
        nodeIds.add(from);
        dependencies.push({ from, to, type: 'import' });
      }
    });

    return { dependencies, nodeIds };
  }

  function countByTarget(edges: readonly { target: string }[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const edge of edges) {
      counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
    }
    return counts;
  }

  it('keeps everything when the cap does not bite', () => {
    const { dependencies, nodeIds } = graph([5, 3, 1]);
    const result = selectRenderableEdges(dependencies, nodeIds);

    expect(result.edges).toHaveLength(9);
    expect(result.dropped).toBe(0);
  });

  it('drops only edges whose endpoints are not both on the map', () => {
    const dependencies: Dependency[] = [
      { from: 'src/a.ts', to: 'src/b.ts', type: 'import' },
      { from: 'src/a.ts', to: 'vendor/gone.ts', type: 'import' },
    ];
    const result = selectRenderableEdges(dependencies, new Set(['src/a.ts', 'src/b.ts']));

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].target).toBe('src/b.ts');
    expect(result.dropped).toBe(0);
  });

  it('spends exactly the budget when the cap bites', () => {
    const { dependencies, nodeIds } = graph(Array.from({ length: 300 }, (_, i) => 300 - i));
    const result = selectRenderableEdges(dependencies, nodeIds);

    expect(dependencies.length).toBeGreaterThan(MAX_RENDERED_EDGES);
    expect(result.edges).toHaveLength(MAX_RENDERED_EDGES);
    expect(result.dropped).toBe(dependencies.length - MAX_RENDERED_EDGES);
  });

  it('leaves every target with at least one arc rather than emptying most of them', () => {
    // 300 targets and 45,150 dependencies: seventeen times the budget, and the
    // shape that used to collapse onto a couple of dozen hubs.
    const { dependencies, nodeIds } = graph(Array.from({ length: 300 }, (_, i) => 300 - i));
    const counts = countByTarget(selectRenderableEdges(dependencies, nodeIds).edges);

    expect(counts.size).toBe(300);
    for (const kept of counts.values()) {
      expect(kept).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps the busiest target busiest, in proportion', () => {
    const { dependencies, nodeIds } = graph(Array.from({ length: 300 }, (_, i) => 300 - i));
    const counts = countByTarget(selectRenderableEdges(dependencies, nodeIds).edges);

    const busiest = counts.get('src/target-0.ts') ?? 0;
    const middle = counts.get('src/target-150.ts') ?? 0;
    const quietest = counts.get('src/target-299.ts') ?? 0;

    expect(busiest).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThanOrEqual(quietest);
    // Ranked selection gave the busiest target every one of its 300 edges and
    // left 278 targets with none. Proportional gives it its share of the cap.
    expect(busiest).toBeLessThan(300);
  });

  it('falls back to one arc each for the biggest targets when even that will not fit', () => {
    const { dependencies, nodeIds } = graph(Array.from({ length: 2000 }, () => 2));
    const result = selectRenderableEdges(dependencies, nodeIds);
    const counts = countByTarget(result.edges);

    expect(result.edges).toHaveLength(MAX_RENDERED_EDGES);
    expect(counts.size).toBe(MAX_RENDERED_EDGES);
    for (const kept of counts.values()) {
      expect(kept).toBe(1);
    }
  });

  it('returns the same arcs for the same repository every time', () => {
    const { dependencies, nodeIds } = graph(Array.from({ length: 300 }, (_, i) => 300 - i));
    const first = selectRenderableEdges(dependencies, nodeIds).edges;
    const second = selectRenderableEdges(dependencies, nodeIds).edges;

    expect(second).toEqual(first);
  });

  it('prefers a static import over a dynamic one inside the same target', () => {
    const dependencies: Dependency[] = [];
    const nodeIds = new Set<string>(['src/hub.ts']);
    for (let i = 0; i < 4000; i += 1) {
      const from = `src/importer-${i}.ts`;
      nodeIds.add(from);
      dependencies.push({ from, to: 'src/hub.ts', type: i % 2 === 0 ? 'import' : 'dynamic-import' });
    }

    const result = selectRenderableEdges(dependencies, nodeIds);
    expect(result.edges).toHaveLength(MAX_RENDERED_EDGES);
    expect(result.edges.every(edge => edge.strength === 1)).toBe(true);
  });
});

// Made with Bob