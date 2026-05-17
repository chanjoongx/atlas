/**
 * Tests for Agent 3: Layout Engine
 */

import { describe, it, expect } from 'vitest';
import { generateLayout } from '../layout';
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

// Made with Bob