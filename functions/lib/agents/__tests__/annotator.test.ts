/**
 * Tests for Agent 4: Annotator
 */

import { describe, it, expect } from 'vitest';
import { annotateLayout, allocateHighlightQuotas } from '../annotator';
import type {
  LayoutData,
  CodeStructure,
  LayoutNode,
  LayoutEdge,
  District,
  ParsedFile,
  Dependency,
  AnnotatedLayout
} from '../../types';

describe('Agent 4: Annotator', () => {
  /**
   * Helper to create a basic layout node
   */
  function createNode(
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    loc: number
  ): LayoutNode {
    return {
      id,
      x,
      y,
      width,
      height,
      type: 'source',
      label: id.split('/').pop() || id,
      metadata: {
        path: id,
        loc,
        language: 'typescript'
      }
    };
  }

  /**
   * Helper to create a parsed file
   */
  function createParsedFile(
    path: string,
    loc: number,
    isEntryPoint: boolean = false,
    imports: string[] = []
  ): ParsedFile {
    return {
      path,
      type: 'source',
      language: 'typescript',
      loc,
      imports,
      exports: [],
      isEntryPoint
    };
  }

  describe('Empty Layout', () => {
    it('should handle empty layout gracefully', async () => {
      const layout: LayoutData = {
        nodes: [],
        edges: [],
        districts: [],
        bounds: { width: 1920, height: 1080 }
      };

      const structure: CodeStructure = {
        files: [],
        dependencies: [],
        metrics: {
          totalFiles: 0,
          totalLOC: 0,
          languageBreakdown: {},
          directoryDepth: 0
        }
      };

      const result = await annotateLayout(layout, structure);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.highlights).toEqual([]);
        expect(result.data.labels).toEqual([]);
      }
    });
  });

  describe('Entry Point Highlights', () => {
    it('should always highlight entry points', async () => {
      const layout: LayoutData = {
        nodes: [
          createNode('src/main.ts', 100, 100, 20, 30, 50),
          createNode('src/app.ts', 200, 200, 20, 30, 100),
          createNode('src/utils.ts', 300, 300, 20, 30, 75)
        ],
        edges: [],
        districts: [],
        bounds: { width: 1920, height: 1080 }
      };

      const structure: CodeStructure = {
        files: [
          createParsedFile('src/main.ts', 50, true),
          createParsedFile('src/app.ts', 100, true),
          createParsedFile('src/utils.ts', 75, false)
        ],
        dependencies: [],
        metrics: {
          totalFiles: 3,
          totalLOC: 225,
          languageBreakdown: { typescript: 225 },
          directoryDepth: 1
        }
      };

      const result = await annotateLayout(layout, structure);

      expect(result.success).toBe(true);
      if (result.success) {
        const entryHighlights = result.data.highlights.filter(h => h.type === 'entry');
        expect(entryHighlights).toHaveLength(2);
        expect(entryHighlights.map(h => h.nodeId).sort()).toEqual([
          'src/app.ts',
          'src/main.ts'
        ]);
        expect(entryHighlights.every(h => h.reason === 'Entry point')).toBe(true);
        expect(entryHighlights.every(h => h.intensity === 1.0)).toBe(true);
      }
    });

    it('should highlight entry points regardless of degree or LOC', async () => {
      const layout: LayoutData = {
        nodes: [
          createNode('src/tiny-entry.ts', 100, 100, 10, 10, 5),
          createNode('src/huge-util.ts', 200, 200, 50, 50, 500)
        ],
        edges: [
          { source: 'src/huge-util.ts', target: 'src/tiny-entry.ts', strength: 1 }
        ],
        districts: [],
        bounds: { width: 1920, height: 1080 }
      };

      const structure: CodeStructure = {
        files: [
          createParsedFile('src/tiny-entry.ts', 5, true, ['src/huge-util.ts']),
          createParsedFile('src/huge-util.ts', 500, false)
        ],
        dependencies: [
          { from: 'src/tiny-entry.ts', to: 'src/huge-util.ts', type: 'import' }
        ],
        metrics: {
          totalFiles: 2,
          totalLOC: 505,
          languageBreakdown: { typescript: 505 },
          directoryDepth: 1
        }
      };

      const result = await annotateLayout(layout, structure);

      expect(result.success).toBe(true);
      if (result.success) {
        const entryHighlight = result.data.highlights.find(
          h => h.nodeId === 'src/tiny-entry.ts' && h.type === 'entry'
        );
        expect(entryHighlight).toBeDefined();
      }
    });
  });

  describe('Core Highlights (High In-Degree)', () => {
    it('should highlight top 10% nodes by inDegree', async () => {
      // Create 10 nodes, one with high inDegree
      const nodes: LayoutNode[] = [];
      const files: ParsedFile[] = [];
      const edges: LayoutEdge[] = [];
      const dependencies: Dependency[] = [];

      for (let i = 0; i < 10; i++) {
        const path = `src/file${i}.ts`;
        nodes.push(createNode(path, i * 100, 100, 20, 30, 100));
        files.push(createParsedFile(path, 100, false));
      }

      // Make file0 imported by 5 other files (high inDegree)
      for (let i = 1; i <= 5; i++) {
        edges.push({ source: `src/file${i}.ts`, target: 'src/file0.ts', strength: 1 });
        dependencies.push({ from: `src/file${i}.ts`, to: 'src/file0.ts', type: 'import' });
      }

      const layout: LayoutData = {
        nodes,
        edges,
        districts: [],
        bounds: { width: 1920, height: 1080 }
      };

      const structure: CodeStructure = {
        files,
        dependencies,
        metrics: {
          totalFiles: 10,
          totalLOC: 1000,
          languageBreakdown: { typescript: 1000 },
          directoryDepth: 1
        }
      };

      const result = await annotateLayout(layout, structure);

      expect(result.success).toBe(true);
      if (result.success) {
        const coreHighlight = result.data.highlights.find(
          h => h.nodeId === 'src/file0.ts' && h.type === 'core'
        );
        expect(coreHighlight).toBeDefined();
        expect(coreHighlight?.reason).toContain('Imported by 5 files');
        expect(coreHighlight?.intensity).toBeGreaterThan(0);
        expect(coreHighlight?.intensity).toBeLessThanOrEqual(1);
      }
    });

    it('should not highlight core nodes that are already entry points', async () => {
      const layout: LayoutData = {
        nodes: [
          createNode('src/entry.ts', 100, 100, 20, 30, 100),
          createNode('src/file1.ts', 200, 200, 20, 30, 100),
          createNode('src/file2.ts', 300, 300, 20, 30, 100)
        ],
        edges: [
          { source: 'src/file1.ts', target: 'src/entry.ts', strength: 1 },
          { source: 'src/file2.ts', target: 'src/entry.ts', strength: 1 }
        ],
        districts: [],
        bounds: { width: 1920, height: 1080 }
      };

      const structure: CodeStructure = {
        files: [
          createParsedFile('src/entry.ts', 100, true),
          createParsedFile('src/file1.ts', 100, false, ['src/entry.ts']),
          createParsedFile('src/file2.ts', 100, false, ['src/entry.ts'])
        ],
        dependencies: [
          { from: 'src/file1.ts', to: 'src/entry.ts', type: 'import' },
          { from: 'src/file2.ts', to: 'src/entry.ts', type: 'import' }
        ],
        metrics: {
          totalFiles: 3,
          totalLOC: 300,
          languageBreakdown: { typescript: 300 },
          directoryDepth: 1
        }
      };

      const result = await annotateLayout(layout, structure);

      expect(result.success).toBe(true);
      if (result.success) {
        const entryHighlights = result.data.highlights.filter(
          h => h.nodeId === 'src/entry.ts'
        );
        // Should only have one highlight (entry), not both entry and core
        expect(entryHighlights).toHaveLength(1);
        expect(entryHighlights[0].type).toBe('entry');
      }
    });
  });

  describe('Hotspot Highlights (High LOC)', () => {
    it('should highlight top 5% nodes by LOC', async () => {
      // Create 20 nodes with varying LOC
      const nodes: LayoutNode[] = [];
      const files: ParsedFile[] = [];

      for (let i = 0; i < 20; i++) {
        const path = `src/file${i}.ts`;
        const loc = (i + 1) * 10; // LOC from 10 to 200
        nodes.push(createNode(path, i * 50, 100, 20, 30, loc));
        files.push(createParsedFile(path, loc, false));
      }

      const layout: LayoutData = {
        nodes,
        edges: [],
        districts: [],
        bounds: { width: 1920, height: 1080 }
      };

      const structure: CodeStructure = {
        files,
        dependencies: [],
        metrics: {
          totalFiles: 20,
          totalLOC: 2100,
          languageBreakdown: { typescript: 2100 },
          directoryDepth: 1
        }
      };

      const result = await annotateLayout(layout, structure);

      expect(result.success).toBe(true);
      if (result.success) {
        const hotspotHighlights = result.data.highlights.filter(h => h.type === 'hotspot');
        // Top 5% of 20 = 1 node
        expect(hotspotHighlights.length).toBeGreaterThan(0);
        
        // The largest file should be highlighted
        const largestHighlight = hotspotHighlights.find(h => h.nodeId === 'src/file19.ts');
        expect(largestHighlight).toBeDefined();
        expect(largestHighlight?.reason).toContain('200 LOC');
      }
    });

    it('should not highlight hotspots that are already entries or cores', async () => {
      const layout: LayoutData = {
        nodes: [
          createNode('src/entry.ts', 100, 100, 20, 30, 500), // Large entry
          createNode('src/core.ts', 200, 200, 20, 30, 400),  // Large core
          createNode('src/file1.ts', 300, 300, 20, 30, 50),
          createNode('src/file2.ts', 400, 400, 20, 30, 50)
        ],
        edges: [
          { source: 'src/file1.ts', target: 'src/core.ts', strength: 1 },
          { source: 'src/file2.ts', target: 'src/core.ts', strength: 1 }
        ],
        districts: [],
        bounds: { width: 1920, height: 1080 }
      };

      const structure: CodeStructure = {
        files: [
          createParsedFile('src/entry.ts', 500, true),
          createParsedFile('src/core.ts', 400, false),
          createParsedFile('src/file1.ts', 50, false, ['src/core.ts']),
          createParsedFile('src/file2.ts', 50, false, ['src/core.ts'])
        ],
        dependencies: [
          { from: 'src/file1.ts', to: 'src/core.ts', type: 'import' },
          { from: 'src/file2.ts', to: 'src/core.ts', type: 'import' }
        ],
        metrics: {
          totalFiles: 4,
          totalLOC: 1000,
          languageBreakdown: { typescript: 1000 },
          directoryDepth: 1
        }
      };

      const result = await annotateLayout(layout, structure);

      expect(result.success).toBe(true);
      if (result.success) {
        // entry.ts should only be highlighted as entry, not hotspot
        const entryHighlights = result.data.highlights.filter(
          h => h.nodeId === 'src/entry.ts'
        );
        expect(entryHighlights).toHaveLength(1);
        expect(entryHighlights[0].type).toBe('entry');

        // core.ts should only be highlighted as core, not hotspot
        const coreHighlights = result.data.highlights.filter(
          h => h.nodeId === 'src/core.ts'
        );
        expect(coreHighlights).toHaveLength(1);
        expect(coreHighlights[0].type).toBe('core');
      }
    });
  });

  describe('Intensity Values', () => {
    it('should normalize intensity values to [0, 1]', async () => {
      const nodes: LayoutNode[] = [];
      const files: ParsedFile[] = [];
      const edges: LayoutEdge[] = [];
      const dependencies: Dependency[] = [];

      // Create nodes with varying inDegree and LOC
      for (let i = 0; i < 20; i++) {
        const path = `src/file${i}.ts`;
        nodes.push(createNode(path, i * 50, 100, 20, 30, (i + 1) * 20));
        files.push(createParsedFile(path, (i + 1) * 20, false));
      }

      // Create varying inDegree
      for (let i = 1; i < 10; i++) {
        for (let j = 0; j < i; j++) {
          edges.push({ source: `src/file${j}.ts`, target: `src/file${i}.ts`, strength: 1 });
          dependencies.push({ from: `src/file${j}.ts`, to: `src/file${i}.ts`, type: 'import' });
        }
      }

      const layout: LayoutData = {
        nodes,
        edges,
        districts: [],
        bounds: { width: 1920, height: 1080 }
      };

      const structure: CodeStructure = {
        files,
        dependencies,
        metrics: {
          totalFiles: 20,
          totalLOC: 4200,
          languageBreakdown: { typescript: 4200 },
          directoryDepth: 1
        }
      };

      const result = await annotateLayout(layout, structure);

      expect(result.success).toBe(true);
      if (result.success) {
        // All intensity values should be in [0, 1]
        for (const highlight of result.data.highlights) {
          expect(highlight.intensity).toBeGreaterThanOrEqual(0);
          expect(highlight.intensity).toBeLessThanOrEqual(1);
        }
      }
    });
  });

  describe('District Labels', () => {
    it('should create exactly one label per district', async () => {
      const layout: LayoutData = {
        nodes: [
          createNode('src/components/Button.tsx', 100, 100, 20, 30, 100),
          createNode('src/components/Input.tsx', 150, 100, 20, 30, 100),
          createNode('src/utils/format.ts', 300, 300, 20, 30, 50),
          createNode('src/utils/validate.ts', 350, 300, 20, 30, 50)
        ],
        edges: [],
        districts: [
          {
            name: 'components',
            nodes: ['src/components/Button.tsx', 'src/components/Input.tsx'],
            bounds: { x: 80, y: 80, width: 100, height: 50 },
            color: '#ff0000'
          },
          {
            name: 'utils',
            nodes: ['src/utils/format.ts', 'src/utils/validate.ts'],
            bounds: { x: 280, y: 280, width: 100, height: 50 },
            color: '#00ff00'
          }
        ],
        bounds: { width: 1920, height: 1080 }
      };

      const structure: CodeStructure = {
        files: [
          createParsedFile('src/components/Button.tsx', 100, false),
          createParsedFile('src/components/Input.tsx', 100, false),
          createParsedFile('src/utils/format.ts', 50, false),
          createParsedFile('src/utils/validate.ts', 50, false)
        ],
        dependencies: [],
        metrics: {
          totalFiles: 4,
          totalLOC: 300,
          languageBreakdown: { typescript: 300 },
          directoryDepth: 2
        }
      };

      const result = await annotateLayout(layout, structure);

      expect(result.success).toBe(true);
      if (result.success) {
        const districtLabels = result.data.labels.filter(
          l => l.text === 'components' || l.text === 'utils'
        );
        expect(districtLabels).toHaveLength(2);
        expect(districtLabels.every(l => l.position === 'top')).toBe(true);
      }
    });

    it('should truncate long district names', async () => {
      const layout: LayoutData = {
        nodes: [
          createNode('src/very-long-district-name/file.ts', 100, 100, 20, 30, 100)
        ],
        edges: [],
        districts: [
          {
            name: 'very-long-district-name',
            nodes: ['src/very-long-district-name/file.ts'],
            bounds: { x: 80, y: 80, width: 50, height: 50 },
            color: '#ff0000'
          }
        ],
        bounds: { width: 1920, height: 1080 }
      };

      const structure: CodeStructure = {
        files: [
          createParsedFile('src/very-long-district-name/file.ts', 100, false)
        ],
        dependencies: [],
        metrics: {
          totalFiles: 1,
          totalLOC: 100,
          languageBreakdown: { typescript: 100 },
          directoryDepth: 2
        }
      };

      const result = await annotateLayout(layout, structure);

      expect(result.success).toBe(true);
      if (result.success) {
        const districtLabel = result.data.labels.find(
          l => l.nodeId === 'src/very-long-district-name/file.ts'
        );
        expect(districtLabel).toBeDefined();
        expect(districtLabel!.text.length).toBeLessThanOrEqual(15);
        expect(districtLabel!.text).toContain('…');
      }
    });
  });

  describe('Node Labels', () => {
    it('should label all entry points', async () => {
      const layout: LayoutData = {
        nodes: [
          createNode('src/main.ts', 100, 100, 20, 30, 50),
          createNode('src/index.ts', 200, 200, 20, 30, 50),
          createNode('src/utils.ts', 300, 300, 20, 30, 50)
        ],
        edges: [],
        districts: [],
        bounds: { width: 1920, height: 1080 }
      };

      const structure: CodeStructure = {
        files: [
          createParsedFile('src/main.ts', 50, true),
          createParsedFile('src/index.ts', 50, true),
          createParsedFile('src/utils.ts', 50, false)
        ],
        dependencies: [],
        metrics: {
          totalFiles: 3,
          totalLOC: 150,
          languageBreakdown: { typescript: 150 },
          directoryDepth: 1
        }
      };

      const result = await annotateLayout(layout, structure);

      expect(result.success).toBe(true);
      if (result.success) {
        const entryLabels = result.data.labels.filter(
          l => l.nodeId === 'src/main.ts' || l.nodeId === 'src/index.ts'
        );
        expect(entryLabels).toHaveLength(2);
        expect(entryLabels.map(l => l.text).sort()).toEqual(['index', 'main']);
      }
    });

    it('should label top 10% nodes by visual size', async () => {
      const nodes: LayoutNode[] = [];
      const files: ParsedFile[] = [];

      for (let i = 0; i < 20; i++) {
        const path = `src/file${i}.ts`;
        const width = 10 + i * 2;  // Varying width
        const height = 20 + i * 3; // Varying height
        nodes.push(createNode(path, i * 50, 100, width, height, 100));
        files.push(createParsedFile(path, 100, false));
      }

      const layout: LayoutData = {
        nodes,
        edges: [],
        districts: [],
        bounds: { width: 1920, height: 1080 }
      };

      const structure: CodeStructure = {
        files,
        dependencies: [],
        metrics: {
          totalFiles: 20,
          totalLOC: 2000,
          languageBreakdown: { typescript: 2000 },
          directoryDepth: 1
        }
      };

      const result = await annotateLayout(layout, structure);

      expect(result.success).toBe(true);
      if (result.success) {
        // Should have labels for top 10% by size (2 nodes)
        const nodeLabels = result.data.labels.filter(l => l.text.startsWith('file'));
        expect(nodeLabels.length).toBeGreaterThan(0);
        
        // Largest nodes should be labeled
        const largestLabel = nodeLabels.find(l => l.nodeId === 'src/file19.ts');
        expect(largestLabel).toBeDefined();
      }
    });

    it('should truncate long node labels', async () => {
      const layout: LayoutData = {
        nodes: [
          createNode('src/very-long-filename-that-needs-truncation.ts', 100, 100, 50, 50, 100)
        ],
        edges: [],
        districts: [],
        bounds: { width: 1920, height: 1080 }
      };

      const structure: CodeStructure = {
        files: [
          createParsedFile('src/very-long-filename-that-needs-truncation.ts', 100, true)
        ],
        dependencies: [],
        metrics: {
          totalFiles: 1,
          totalLOC: 100,
          languageBreakdown: { typescript: 100 },
          directoryDepth: 1
        }
      };

      const result = await annotateLayout(layout, structure);

      expect(result.success).toBe(true);
      if (result.success) {
        const nodeLabel = result.data.labels.find(
          l => l.nodeId === 'src/very-long-filename-that-needs-truncation.ts'
        );
        expect(nodeLabel).toBeDefined();
        expect(nodeLabel!.text.length).toBeLessThanOrEqual(12);
        expect(nodeLabel!.text).toContain('…');
      }
    });

    it('should position labels based on node location', async () => {
      const layout: LayoutData = {
        nodes: [
          createNode('src/top.ts', 100, 100, 20, 30, 100),      // y < 20% -> top
          createNode('src/right.ts', 1800, 500, 20, 30, 100),   // x > 80% -> left
          createNode('src/default.ts', 500, 500, 20, 30, 100)   // default -> right
        ],
        edges: [],
        districts: [],
        bounds: { width: 1920, height: 1080 }
      };

      const structure: CodeStructure = {
        files: [
          createParsedFile('src/top.ts', 100, true),
          createParsedFile('src/right.ts', 100, true),
          createParsedFile('src/default.ts', 100, true)
        ],
        dependencies: [],
        metrics: {
          totalFiles: 3,
          totalLOC: 300,
          languageBreakdown: { typescript: 300 },
          directoryDepth: 1
        }
      };

      const result = await annotateLayout(layout, structure);

      expect(result.success).toBe(true);
      if (result.success) {
        const topLabel = result.data.labels.find(l => l.nodeId === 'src/top.ts');
        const rightLabel = result.data.labels.find(l => l.nodeId === 'src/right.ts');
        const defaultLabel = result.data.labels.find(l => l.nodeId === 'src/default.ts');

        expect(topLabel?.position).toBe('top');
        expect(rightLabel?.position).toBe('left');
        expect(defaultLabel?.position).toBe('right');
      }
    });
  });

  describe('Valid Node References', () => {
    it('should only reference valid layout nodes in highlights', async () => {
      const layout: LayoutData = {
        nodes: [
          createNode('src/file1.ts', 100, 100, 20, 30, 100),
          createNode('src/file2.ts', 200, 200, 20, 30, 100)
        ],
        edges: [],
        districts: [],
        bounds: { width: 1920, height: 1080 }
      };

      const structure: CodeStructure = {
        files: [
          createParsedFile('src/file1.ts', 100, true),
          createParsedFile('src/file2.ts', 100, false)
        ],
        dependencies: [],
        metrics: {
          totalFiles: 2,
          totalLOC: 200,
          languageBreakdown: { typescript: 200 },
          directoryDepth: 1
        }
      };

      const result = await annotateLayout(layout, structure);

      expect(result.success).toBe(true);
      if (result.success) {
        const validNodeIds = new Set(layout.nodes.map(n => n.id));
        for (const highlight of result.data.highlights) {
          expect(validNodeIds.has(highlight.nodeId)).toBe(true);
        }
      }
    });

    it('should only reference valid layout nodes in labels', async () => {
      const layout: LayoutData = {
        nodes: [
          createNode('src/file1.ts', 100, 100, 20, 30, 100),
          createNode('src/file2.ts', 200, 200, 20, 30, 100)
        ],
        edges: [],
        districts: [
          {
            name: 'src',
            nodes: ['src/file1.ts', 'src/file2.ts'],
            bounds: { x: 80, y: 80, width: 150, height: 150 },
            color: '#ff0000'
          }
        ],
        bounds: { width: 1920, height: 1080 }
      };

      const structure: CodeStructure = {
        files: [
          createParsedFile('src/file1.ts', 100, true),
          createParsedFile('src/file2.ts', 100, false)
        ],
        dependencies: [],
        metrics: {
          totalFiles: 2,
          totalLOC: 200,
          languageBreakdown: { typescript: 200 },
          directoryDepth: 1
        }
      };

      const result = await annotateLayout(layout, structure);

      expect(result.success).toBe(true);
      if (result.success) {
        const validNodeIds = new Set(layout.nodes.map(n => n.id));
        for (const label of result.data.labels) {
          expect(validNodeIds.has(label.nodeId)).toBe(true);
        }
      }
    });
  });

  describe('Highlight Quotas', () => {
    it('should give each kind its own quota when all kinds are oversubscribed', () => {
      const allocation = allocateHighlightQuotas({ entry: 100, core: 100, hotspot: 100 });

      expect(allocation).toEqual({ entry: 12, core: 22, hotspot: 16 });
      expect(allocation.entry + allocation.core + allocation.hotspot).toBe(50);
    });

    it('should hand unused quota to the kinds that can use it', () => {
      // No cores available, so the 22 core slots go to hotspot then entry
      const allocation = allocateHighlightQuotas({ entry: 40, core: 0, hotspot: 40 });

      expect(allocation.core).toBe(0);
      expect(allocation.entry).toBeGreaterThan(12);
      expect(allocation.hotspot).toBeGreaterThan(16);
      expect(allocation.entry + allocation.core + allocation.hotspot).toBe(50);
    });

    it('should never allocate more candidates than a kind has', () => {
      const allocation = allocateHighlightQuotas({ entry: 3, core: 5, hotspot: 2 });

      expect(allocation).toEqual({ entry: 3, core: 5, hotspot: 2 });
    });

    it('should allocate nothing when there are no candidates', () => {
      expect(allocateHighlightQuotas({ entry: 0, core: 0, hotspot: 0 })).toEqual({
        entry: 0,
        core: 0,
        hotspot: 0
      });
    });

    it('should produce a mix of highlight types on an entry heavy repo', async () => {
      // 60 entry points on a 300 node map: entry points must not swallow every
      // highlight slot the way a single shared cap allowed
      const nodes: LayoutNode[] = [];
      const files: ParsedFile[] = [];
      const edges: LayoutEdge[] = [];
      const dependencies: Dependency[] = [];

      for (let i = 0; i < 60; i++) {
        const path = `packages/pkg${i}/src/index.ts`;
        nodes.push(createNode(path, i * 20, 100, 20, 30, 100));
        files.push(createParsedFile(path, 100, true));
      }

      const moduleCount = 240;
      for (let i = 0; i < moduleCount; i++) {
        const path = `src/module${i}.ts`;
        nodes.push(createNode(path, i * 20, 300, 20, 30, 200 + i));
        files.push(createParsedFile(path, 200 + i, false));
      }

      // Every module imports the next one, so in-degree exists across the map
      for (let i = 0; i < moduleCount; i++) {
        const target = `src/module${(i + 1) % moduleCount}.ts`;
        edges.push({ source: `src/module${i}.ts`, target, strength: 1 });
        dependencies.push({ from: `src/module${i}.ts`, to: target, type: 'import' });
      }

      const layout: LayoutData = {
        nodes,
        edges,
        districts: [],
        bounds: { width: 1920, height: 1080 }
      };

      const structure: CodeStructure = {
        files,
        dependencies,
        metrics: {
          totalFiles: files.length,
          totalLOC: 20000,
          languageBreakdown: { typescript: 20000 },
          directoryDepth: 4
        }
      };

      const result = await annotateLayout(layout, structure);

      expect(result.success).toBe(true);
      if (result.success) {
        const counts = { entry: 0, core: 0, hotspot: 0 };
        for (const highlight of result.data.highlights) {
          counts[highlight.type] += 1;
        }

        expect(counts.entry).toBeGreaterThan(0);
        expect(counts.core).toBeGreaterThanOrEqual(22);
        expect(counts.hotspot).toBeGreaterThan(0);
        expect(result.data.highlights.length).toBeLessThanOrEqual(50);
      }
    });
  });

  describe('Max Highlights Cap', () => {
    it('should cap total highlights at 50', async () => {
      // Create 100 nodes, all as entry points
      const nodes: LayoutNode[] = [];
      const files: ParsedFile[] = [];

      for (let i = 0; i < 100; i++) {
        const path = `src/file${i}.ts`;
        nodes.push(createNode(path, i * 20, 100, 20, 30, 100));
        files.push(createParsedFile(path, 100, true)); // All entry points
      }

      const layout: LayoutData = {
        nodes,
        edges: [],
        districts: [],
        bounds: { width: 1920, height: 1080 }
      };

      const structure: CodeStructure = {
        files,
        dependencies: [],
        metrics: {
          totalFiles: 100,
          totalLOC: 10000,
          languageBreakdown: { typescript: 10000 },
          directoryDepth: 1
        }
      };

      const result = await annotateLayout(layout, structure);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.highlights.length).toBeLessThanOrEqual(50);
      }
    });
  });
});

// Made with Bob