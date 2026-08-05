import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseStructure,
  collectPackageRoots,
  decodeBase64Content,
  isEntryPoint,
  normalizePath,
  resolveImportPath,
  selectEntryPoints,
  LANGUAGE_MAP,
  ENTRY_POINT_PATTERNS,
  MAX_ENTRY_POINTS,
} from '../parser';
import type { ParserInput } from '../parser';
import type { FileNode } from '../../types';
import type { Octokit } from '@octokit/rest';

// Mock Octokit
const createMockOctokit = () => {
  const mockGetBlob = vi.fn();
  return {
    rest: {
      git: {
        getBlob: mockGetBlob,
      },
    },
    _mockGetBlob: mockGetBlob,
  } as unknown as Octokit & { _mockGetBlob: ReturnType<typeof vi.fn> };
};

/**
 * Serve blob content per file sha, so only the intended files carry imports
 */
function mockBlobContent(
  octokit: Octokit & { _mockGetBlob: ReturnType<typeof vi.fn> },
  contentBySha: Record<string, string>
): void {
  octokit._mockGetBlob.mockImplementation(async ({ file_sha }: { file_sha: string }) => ({
    data: {
      content: Buffer.from(contentBySha[file_sha] ?? '').toString('base64'),
      encoding: 'base64',
    },
  }));
}

describe('Agent 2: Structure Parser', () => {
  let mockOctokit: Octokit & { _mockGetBlob: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockOctokit = createMockOctokit();
  });

  describe('Language Detection', () => {
    it('should detect TypeScript files', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'src/app.ts', type: 'file', size: 1000, sha: 'abc123' },
          { path: 'src/component.tsx', type: 'file', size: 2000, sha: 'def456' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.files[0].language).toBe('typescript');
        expect(result.data.files[1].language).toBe('typescript');
      }
    });

    it('should detect JavaScript files', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'src/app.js', type: 'file', size: 1000, sha: 'abc123' },
          { path: 'src/component.jsx', type: 'file', size: 2000, sha: 'def456' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.files[0].language).toBe('javascript');
        expect(result.data.files[1].language).toBe('javascript');
      }
    });

    it('should detect Python files', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'main.py', type: 'file', size: 1000, sha: 'abc123' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.files[0].language).toBe('python');
      }
    });

    it('should detect multiple languages', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'app.rs', type: 'file', size: 1000, sha: 'a1' },
          { path: 'main.go', type: 'file', size: 1000, sha: 'a2' },
          { path: 'App.java', type: 'file', size: 1000, sha: 'a3' },
          { path: 'main.cpp', type: 'file', size: 1000, sha: 'a4' },
          { path: 'app.rb', type: 'file', size: 1000, sha: 'a5' },
          { path: 'index.php', type: 'file', size: 1000, sha: 'a6' },
          { path: 'App.swift', type: 'file', size: 1000, sha: 'a7' },
          { path: 'Main.kt', type: 'file', size: 1000, sha: 'a8' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.files[0].language).toBe('rust');
        expect(result.data.files[1].language).toBe('go');
        expect(result.data.files[2].language).toBe('java');
        expect(result.data.files[3].language).toBe('cpp');
        expect(result.data.files[4].language).toBe('ruby');
        expect(result.data.files[5].language).toBe('php');
        expect(result.data.files[6].language).toBe('swift');
        expect(result.data.files[7].language).toBe('kotlin');
      }
    });

    it('should handle unknown extensions', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'file.xyz', type: 'file', size: 1000, sha: 'abc123' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.files[0].language).toBe('unknown');
      }
    });
  });

  describe('File Type Classification', () => {
    it('should classify test files', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'src/__tests__/app.test.ts', type: 'file', size: 1000, sha: 'a1' },
          { path: 'src/component.spec.ts', type: 'file', size: 1000, sha: 'a2' },
          { path: 'test/utils.ts', type: 'file', size: 1000, sha: 'a3' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.files[0].type).toBe('test');
        expect(result.data.files[1].type).toBe('test');
        expect(result.data.files[2].type).toBe('test');
      }
    });

    it('should classify config files', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'package.json', type: 'file', size: 500, sha: 'a1' },
          { path: 'tsconfig.json', type: 'file', size: 300, sha: 'a2' },
          { path: 'vite.config.ts', type: 'file', size: 400, sha: 'a3' },
          { path: '.eslintrc.js', type: 'file', size: 200, sha: 'a4' },
          { path: '.env', type: 'file', size: 100, sha: 'a5' },
          { path: 'Dockerfile', type: 'file', size: 600, sha: 'a6' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        result.data.files.forEach(file => {
          expect(file.type).toBe('config');
        });
      }
    });

    it('should classify documentation files', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'README.md', type: 'file', size: 2000, sha: 'a1' },
          { path: 'LICENSE', type: 'file', size: 1000, sha: 'a2' },
          { path: 'CHANGELOG.md', type: 'file', size: 3000, sha: 'a3' },
          { path: 'docs/guide.md', type: 'file', size: 5000, sha: 'a4' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        result.data.files.forEach(file => {
          expect(file.type).toBe('docs');
        });
      }
    });

    it('should classify asset files', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'public/logo.svg', type: 'file', size: 1000, sha: 'a1' },
          { path: 'assets/icon.png', type: 'file', size: 2000, sha: 'a2' },
          { path: 'static/style.css', type: 'file', size: 500, sha: 'a3' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        result.data.files.forEach(file => {
          expect(file.type).toBe('asset');
        });
      }
    });

    it('should classify source files by default', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'src/app.ts', type: 'file', size: 1000, sha: 'a1' },
          { path: 'src/utils/helper.ts', type: 'file', size: 500, sha: 'a2' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        result.data.files.forEach(file => {
          expect(file.type).toBe('source');
        });
      }
    });
  });

  describe('Entry Point Detection', () => {
    it('should detect common entry points', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'src/index.ts', type: 'file', size: 1000, sha: 'a1' },
          { path: 'src/main.tsx', type: 'file', size: 1000, sha: 'a2' },
          { path: 'src/App.tsx', type: 'file', size: 1000, sha: 'a3' },
          { path: 'app/page.tsx', type: 'file', size: 1000, sha: 'a4' },
          { path: 'pages/index.jsx', type: 'file', size: 1000, sha: 'a5' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      mockOctokit._mockGetBlob.mockResolvedValue({
        data: { content: Buffer.from('// entry point').toString('base64') },
      });

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        result.data.files.forEach(file => {
          expect(file.isEntryPoint).toBe(true);
        });
      }
    });

    it('should not mark non-entry files as entry points', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'src/utils/helper.ts', type: 'file', size: 1000, sha: 'a1' },
          { path: 'src/components/Button.tsx', type: 'file', size: 1000, sha: 'a2' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        result.data.files.forEach(file => {
          expect(file.isEntryPoint).toBe(false);
        });
      }
    });
  });

  describe('LOC Estimation', () => {
    it('should estimate LOC from file size', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'src/app.ts', type: 'file', size: 350, sha: 'a1' }, // ~10 lines
          { path: 'src/large.ts', type: 'file', size: 3500, sha: 'a2' }, // ~100 lines
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.files[0].loc).toBe(10);
        expect(result.data.files[1].loc).toBe(100);
      }
    });

    it('should use actual line count when content is fetched', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'src/index.ts', type: 'file', size: 1000, sha: 'a1' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const content = 'line1\nline2\nline3\nline4\nline5';
      mockOctokit._mockGetBlob.mockResolvedValue({
        data: { content: Buffer.from(content).toString('base64') },
      });

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.files[0].loc).toBe(5);
      }
    });

    it('should have minimum LOC of 1', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'empty.ts', type: 'file', size: 0, sha: 'a1' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.files[0].loc).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('Import Extraction', () => {
    it('does not backtrack catastrophically on hostile file content', async () => {
      // File contents come from any public repository on GitHub, so the import
      // matcher is attacker controlled input. An earlier pattern combined three
      // whitespace matching constructs over the same run, and `import` followed
      // by a long whitespace run with no quote made it re-partition that run:
      // 68ms at 800 characters, 502ms at 1600, 4.5 seconds at 3200. The fetch
      // budget allows 400 KB per file, so one crafted file could pin a
      // production CPU core.
      //
      // The gap between linear and exponential here is several orders of
      // magnitude, so this budget is generous enough never to flake and still
      // catches any reintroduction.
      const input: ParserInput = {
        tree: [
          { path: 'src/index.ts', type: 'file', size: 1000, sha: 'a1' },
          { path: 'src/utils.ts', type: 'file', size: 500, sha: 'a2' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const hostile = `\nimport${' '.repeat(60_000)}x\nimport { a } from './utils';\n`;
      mockBlobContent(mockOctokit, { a1: hostile });

      const started = Date.now();
      const result = await parseStructure(input, mockOctokit);
      const elapsed = Date.now() - started;

      expect(result.success).toBe(true);
      expect(elapsed).toBeLessThan(2000);

      // And the real import in the same file is still found.
      if (result.success) {
        expect(result.data.dependencies.some(d => d.to === 'src/utils.ts')).toBe(true);
      }
    });

    it('leaves a dynamic import to the dynamic matcher', async () => {
      // The static matcher excludes `(` so `import('./x')` keeps its own edge
      // type. Without that exclusion the static pass claims it first and the
      // dependency is recorded as a static import.
      const input: ParserInput = {
        tree: [
          { path: 'src/index.ts', type: 'file', size: 1000, sha: 'a1' },
          { path: 'src/lazy.ts', type: 'file', size: 500, sha: 'a2' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      mockBlobContent(mockOctokit, { a1: "const m = await import('./lazy');\n" });

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        const edge = result.data.dependencies.find(d => d.to === 'src/lazy.ts');
        expect(edge?.type).toBe('dynamic');
      }
    });

    it('does not treat a string assigned by an export as an import', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'src/index.ts', type: 'file', size: 1000, sha: 'a1' },
          { path: 'src/utils.ts', type: 'file', size: 500, sha: 'a2' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      mockBlobContent(mockOctokit, { a1: "export const path = './utils';\n" });

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dependencies).toHaveLength(0);
      }
    });

    it('should extract ES6 imports', async () => {
      // Import targets must exist in the tree: resolution is evidence based
      const input: ParserInput = {
        tree: [
          { path: 'src/index.ts', type: 'file', size: 1000, sha: 'a1' },
          { path: 'src/utils.ts', type: 'file', size: 500, sha: 'a2' },
          { path: 'src/helpers.ts', type: 'file', size: 500, sha: 'a3' },
          { path: 'components/Button.tsx', type: 'file', size: 500, sha: 'a4' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const content = `
import { foo } from './utils';
import * as bar from './helpers';
import baz from '../components/Button';
import React from 'react';
`;

      mockBlobContent(mockOctokit, { a1: content });

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dependencies.length).toBeGreaterThan(0);
        // Should have relative imports, not external packages
        const relativeDeps = result.data.dependencies.filter(d => 
          d.to.includes('utils') || d.to.includes('helpers') || d.to.includes('Button')
        );
        expect(relativeDeps.length).toBeGreaterThan(0);
      }
    });

    it('should extract dynamic imports', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'src/index.ts', type: 'file', size: 1000, sha: 'a1' },
          { path: 'src/dynamic.ts', type: 'file', size: 500, sha: 'a2' },
          { path: 'src/lazy.ts', type: 'file', size: 500, sha: 'a3' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const content = `
const module = await import('./dynamic');
import('./lazy').then(m => m.default);
`;

      mockBlobContent(mockOctokit, { a1: content });

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        const dynamicDeps = result.data.dependencies.filter(d => d.type === 'dynamic');
        expect(dynamicDeps.length).toBeGreaterThan(0);
      }
    });

    it('should extract CommonJS requires', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'src/index.js', type: 'file', size: 1000, sha: 'a1' },
          { path: 'src/utils.js', type: 'file', size: 500, sha: 'a2' },
          { path: 'helpers/helper.js', type: 'file', size: 500, sha: 'a3' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const content = `
const utils = require('./utils');
const helper = require('../helpers/helper');
`;

      mockBlobContent(mockOctokit, { a1: content });

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dependencies.length).toBeGreaterThan(0);
      }
    });

    it('should filter out external packages', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'src/index.ts', type: 'file', size: 1000, sha: 'a1' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const content = `
import React from 'react';
import { useState } from 'react';
import lodash from 'lodash';
import './local';
`;

      mockOctokit._mockGetBlob.mockResolvedValue({
        data: { content: Buffer.from(content).toString('base64') },
      });

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        // Should only have the local import
        const externalDeps = result.data.dependencies.filter(d => 
          d.to.includes('react') || d.to.includes('lodash')
        );
        expect(externalDeps.length).toBe(0);
      }
    });

    it('should resolve relative paths correctly', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'src/index.tsx', type: 'file', size: 1000, sha: 'a1' },
          { path: 'src/utils/helper.ts', type: 'file', size: 500, sha: 'a2' },
          { path: 'src/components/Icon.tsx', type: 'file', size: 500, sha: 'a3' },
          { path: 'config.ts', type: 'file', size: 500, sha: 'a4' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const content = `
import { helper } from './utils/helper';
import { Icon } from './components/Icon';
import { config } from '../config';
`;

      mockBlobContent(mockOctokit, { a1: content });

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dependencies.length).toBeGreaterThan(0);
        // Check that paths are resolved
        result.data.dependencies.forEach(dep => {
          expect(dep.to).not.toContain('..');
          expect(dep.from).toBe('src/index.tsx');
        });
      }
    });

    it('should build edges across a multi file tree', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'src/index.ts', type: 'file', size: 1000, sha: 'a1' },
          { path: 'src/app.ts', type: 'file', size: 1000, sha: 'a2' },
          { path: 'src/lib/util.ts', type: 'file', size: 1000, sha: 'a3' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      mockBlobContent(mockOctokit, {
        a1: "import { App } from './app';\nimport { util } from './lib/util';\n",
        a2: "import { util } from './lib/util';\n",
        a3: 'export const util = 1;\n',
      });

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        const edges = result.data.dependencies.map(dep => `${dep.from} -> ${dep.to}`).sort();
        expect(edges).toEqual([
          'src/app.ts -> src/lib/util.ts',
          'src/index.ts -> src/app.ts',
          'src/index.ts -> src/lib/util.ts',
        ]);
      }
    });

    it('should record resolved imports on the parsed file', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'src/index.ts', type: 'file', size: 1000, sha: 'a1' },
          { path: 'src/app.ts', type: 'file', size: 1000, sha: 'a2' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      mockBlobContent(mockOctokit, {
        a1: "import { App } from './app';\nimport { App as Again } from './app';\n",
      });

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        const index = result.data.files.find(file => file.path === 'src/index.ts');
        // Duplicate imports of the same target collapse into one edge
        expect(index?.imports).toEqual(['src/app.ts']);
      }
    });

    it('should resolve tsconfig path aliases', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'tsconfig.json', type: 'file', size: 200, sha: 'tc' },
          { path: 'src/app.ts', type: 'file', size: 1000, sha: 'a1' },
          { path: 'src/lib/format.ts', type: 'file', size: 500, sha: 'a2' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      mockBlobContent(mockOctokit, {
        // Comments and a trailing comma, as real tsconfig files have
        tc: `{
  // path aliases
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
    },
  },
}`,
        a1: "import { format } from '@/lib/format';\nimport React from 'react';\n",
      });

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dependencies).toContainEqual({
          from: 'src/app.ts',
          to: 'src/lib/format.ts',
          type: 'import',
        });
        // The npm package must not resolve to anything
        expect(result.data.dependencies).toHaveLength(1);
      }
    });

    it('should scope path aliases to the package that declares them', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'package.json', type: 'file', size: 100, sha: 'root' },
          { path: 'apps/www/package.json', type: 'file', size: 100, sha: 'wm' },
          { path: 'apps/www/tsconfig.json', type: 'file', size: 200, sha: 'wt' },
          { path: 'apps/www/app/page.tsx', type: 'file', size: 1000, sha: 'wp' },
          { path: 'apps/www/lib/utils.ts', type: 'file', size: 500, sha: 'wu' },
          { path: 'packages/cli/src/index.ts', type: 'file', size: 500, sha: 'ci' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      mockBlobContent(mockOctokit, {
        wt: '{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }',
        wp: "import { cn } from '@/lib/utils';\n",
        // Outside apps/www the same specifier must not resolve
        ci: "import { cn } from '@/lib/utils';\n",
      });

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dependencies).toEqual([
          { from: 'apps/www/app/page.tsx', to: 'apps/www/lib/utils.ts', type: 'import' },
        ]);
      }
    });

    it('should extract Python relative imports', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'pkg/main.py', type: 'file', size: 1000, sha: 'p1' },
          { path: 'pkg/helpers.py', type: 'file', size: 500, sha: 'p2' },
          { path: 'pkg/sub/__init__.py', type: 'file', size: 100, sha: 'p3' },
          { path: 'shared/util.py', type: 'file', size: 500, sha: 'p4' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      mockBlobContent(mockOctokit, {
        p1: 'from .helpers import x\nfrom .sub import y\nfrom ..shared.util import z\nimport os\n',
      });

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        const targets = result.data.dependencies.map(dep => dep.to).sort();
        expect(targets).toEqual(['pkg/helpers.py', 'pkg/sub/__init__.py', 'shared/util.py']);
      }
    });
  });

  describe('Metrics Calculation', () => {
    it('should calculate total files and LOC', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'src/app.ts', type: 'file', size: 350, sha: 'a1' },
          { path: 'src/utils.ts', type: 'file', size: 700, sha: 'a2' },
          { path: 'src/helper.ts', type: 'file', size: 1050, sha: 'a3' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metrics.totalFiles).toBe(3);
        expect(result.data.metrics.totalLOC).toBeGreaterThan(0);
      }
    });

    it('should calculate language breakdown', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'src/app.ts', type: 'file', size: 1000, sha: 'a1' },
          { path: 'src/utils.ts', type: 'file', size: 500, sha: 'a2' },
          { path: 'main.py', type: 'file', size: 800, sha: 'a3' },
          { path: 'app.js', type: 'file', size: 600, sha: 'a4' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metrics.languageBreakdown).toHaveProperty('typescript');
        expect(result.data.metrics.languageBreakdown).toHaveProperty('python');
        expect(result.data.metrics.languageBreakdown).toHaveProperty('javascript');
      }
    });

    it('should calculate directory depth', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'src/app.ts', type: 'file', size: 1000, sha: 'a1' },
          { path: 'src/components/Button.tsx', type: 'file', size: 1000, sha: 'a2' },
          { path: 'src/utils/helpers/format.ts', type: 'file', size: 1000, sha: 'a3' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metrics.directoryDepth).toBe(4); // src/utils/helpers/format.ts
      }
    });

    it('should exclude asset files from metrics', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'src/app.ts', type: 'file', size: 1000, sha: 'a1' },
          { path: 'public/logo.svg', type: 'file', size: 5000, sha: 'a2' },
          { path: 'assets/icon.png', type: 'file', size: 10000, sha: 'a3' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        // Should only count the source file
        expect(result.data.metrics.totalFiles).toBe(1);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty tree', async () => {
      const input: ParserInput = {
        tree: [],
        owner: 'test',
        repo: 'test-repo',
      };

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_INPUT');
      }
    });

    it('should handle single file', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'index.ts', type: 'file', size: 100, sha: 'a1' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.files.length).toBe(1);
        expect(result.data.metrics.totalFiles).toBe(1);
      }
    });

    it('should handle deeply nested files', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'a/b/c/d/e/f/g/h/file.ts', type: 'file', size: 1000, sha: 'a1' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.files[0].path).toBe('a/b/c/d/e/f/g/h/file.ts');
        expect(result.data.metrics.directoryDepth).toBe(9);
      }
    });

    it('should filter out directories from file list', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'src', type: 'dir', size: 0, sha: 'a1' },
          { path: 'src/app.ts', type: 'file', size: 1000, sha: 'a2' },
          { path: 'src/components', type: 'dir', size: 0, sha: 'a3' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      mockOctokit._mockGetBlob.mockResolvedValue({
        data: { content: Buffer.from('// content').toString('base64') },
      });

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.files.length).toBe(1);
        expect(result.data.files[0].type).toBe('source');
      }
    });

    it('should continue on blob fetch failure', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'src/index.ts', type: 'file', size: 1000, sha: 'a1' },
          { path: 'src/app.ts', type: 'file', size: 1000, sha: 'a2' },
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      // Mock first call to fail, second to succeed
      mockOctokit._mockGetBlob
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          data: { content: Buffer.from('content').toString('base64') },
        });

      const result = await parseStructure(input, mockOctokit);
      expect(result.success).toBe(true);
      if (result.success) {
        // Should still have both files, even if one fetch failed
        expect(result.data.files.length).toBe(2);
      }
    });
  });
});

describe('Blob Content Decoding', () => {
  it('should decode ASCII content', () => {
    expect(decodeBase64Content(Buffer.from('const a = 1;').toString('base64'))).toBe('const a = 1;');
  });

  it('should decode multi-byte UTF-8 content', () => {
    const source = '// 도시 지도 렌더러 ✨\nconst café = "naïve";\n';
    const encoded = Buffer.from(source, 'utf-8').toString('base64');
    expect(decodeBase64Content(encoded)).toBe(source);
  });

  it('should ignore the line breaks GitHub embeds in blob content', () => {
    const source = 'import { a } from "./a";\nimport { b } from "./b";\n';
    const encoded = Buffer.from(source, 'utf-8').toString('base64');
    // GitHub wraps blob payloads at 60 characters
    const wrapped = (encoded.match(/.{1,60}/g) ?? []).join('\n') + '\n';
    expect(decodeBase64Content(wrapped)).toBe(source);
  });

  it('should return an empty string for empty payloads', () => {
    expect(decodeBase64Content('')).toBe('');
    expect(decodeBase64Content('\n')).toBe('');
  });
});

describe('Import Path Resolution', () => {
  const fileTree = new Set([
    'src/index.ts',
    'src/app.tsx',
    'src/lib/index.ts',
    'src/lib/util.ts',
    'src/lib/nested/index.ts',
    'src/styles.css',
    'src/types.d.ts',
    'config.ts',
    'scripts/build.mjs',
  ]);

  it('should resolve an exact path', () => {
    expect(resolveImportPath('src/index.ts', './styles.css', fileTree)).toBe('src/styles.css');
  });

  it('should resolve an extensionless relative import', () => {
    expect(resolveImportPath('src/index.ts', './lib/util', fileTree)).toBe('src/lib/util.ts');
    expect(resolveImportPath('src/index.ts', './app', fileTree)).toBe('src/app.tsx');
  });

  it('should resolve a parent directory import', () => {
    expect(resolveImportPath('src/lib/util.ts', '../app', fileTree)).toBe('src/app.tsx');
    expect(resolveImportPath('src/lib/util.ts', '../../config', fileTree)).toBe('config.ts');
  });

  it('should resolve a directory import to its index file', () => {
    expect(resolveImportPath('src/index.ts', './lib/nested', fileTree)).toBe('src/lib/nested/index.ts');
    // A bare '.' means the directory the importing file lives in
    expect(resolveImportPath('src/lib/util.ts', '.', fileTree)).toBe('src/lib/index.ts');
    expect(resolveImportPath('src/lib/nested/index.ts', '..', fileTree)).toBe('src/lib/index.ts');
  });

  it('should resolve a declaration file when nothing else matches', () => {
    expect(resolveImportPath('src/index.ts', './types', fileTree)).toBe('src/types.d.ts');
  });

  it('should resolve a repo root absolute import', () => {
    expect(resolveImportPath('src/index.ts', '/scripts/build.mjs', fileTree)).toBe('scripts/build.mjs');
  });

  it('should reject bare specifiers', () => {
    expect(resolveImportPath('src/index.ts', 'react', fileTree)).toBeNull();
    expect(resolveImportPath('src/index.ts', '@radix-ui/react-slot', fileTree)).toBeNull();
    expect(resolveImportPath('src/index.ts', 'node:fs', fileTree)).toBeNull();
  });

  it('should reject targets that are not in the tree', () => {
    expect(resolveImportPath('src/index.ts', './missing', fileTree)).toBeNull();
    expect(resolveImportPath('src/index.ts', './lib/missing/deep', fileTree)).toBeNull();
  });

  it('should reject paths that escape the repo root', () => {
    expect(resolveImportPath('src/index.ts', '../../../etc/passwd', fileTree)).toBeNull();
    expect(normalizePath('../outside')).toBeNull();
    expect(normalizePath('src/./lib/../lib/util.ts')).toBe('src/lib/util.ts');
  });

  it('should reject self imports', () => {
    expect(resolveImportPath('src/lib/nested/index.ts', '.', fileTree)).toBeNull();
    expect(resolveImportPath('src/index.ts', './index.ts', fileTree)).toBeNull();
  });
});

describe('Entry Point Selection', () => {
  it('should not treat nested index files as entry points', () => {
    const paths = new Set([
      'package.json',
      'src/index.ts',
      'src/middleware/basic-auth/index.ts',
      'src/helper/cookie/index.ts',
    ]);
    const roots = collectPackageRoots(paths);

    expect(isEntryPoint('src/index.ts', roots)).toBe(true);
    expect(isEntryPoint('src/middleware/basic-auth/index.ts', roots)).toBe(false);
    expect(isEntryPoint('src/helper/cookie/index.ts', roots)).toBe(false);
  });

  it('should treat package roots as entry point owners', () => {
    const paths = new Set([
      'package.json',
      'packages/core/package.json',
      'packages/core/src/index.ts',
      'packages/ui/src/index.ts',
    ]);
    const roots = collectPackageRoots(paths);

    expect(roots.has('')).toBe(true);
    expect(roots.has('packages/core')).toBe(true);
    expect(isEntryPoint('packages/core/src/index.ts', roots)).toBe(true);
    // No package.json in packages/ui, so its index is just another module
    expect(isEntryPoint('packages/ui/src/index.ts', roots)).toBe(false);
  });

  it('should cap the number of entry points a repo can claim', () => {
    const files: FileNode[] = [];
    for (let i = 0; i < MAX_ENTRY_POINTS + 15; i += 1) {
      files.push({ path: `packages/pkg${i}/package.json`, type: 'file', size: 100, sha: `m${i}` });
      files.push({ path: `packages/pkg${i}/src/index.ts`, type: 'file', size: 100, sha: `s${i}` });
    }
    files.push({ path: 'package.json', type: 'file', size: 100, sha: 'root-manifest' });
    files.push({ path: 'src/index.ts', type: 'file', size: 100, sha: 'root-index' });

    const roots = collectPackageRoots(new Set(files.map(file => file.path)));
    const entryPoints = selectEntryPoints(files, roots);

    expect(entryPoints.size).toBe(MAX_ENTRY_POINTS);
    // Shallowest paths win, so the repo root entry always survives the cap
    expect(entryPoints.has('src/index.ts')).toBe(true);
  });
});

// Made with Bob