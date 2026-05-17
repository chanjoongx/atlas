import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseStructure, LANGUAGE_MAP, ENTRY_POINT_PATTERNS } from '../parser';
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
    it('should extract ES6 imports', async () => {
      const input: ParserInput = {
        tree: [
          { path: 'src/index.ts', type: 'file', size: 1000, sha: 'a1' },
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

      mockOctokit._mockGetBlob.mockResolvedValue({
        data: { content: Buffer.from(content).toString('base64') },
      });

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
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const content = `
const module = await import('./dynamic');
import('./lazy').then(m => m.default);
`;

      mockOctokit._mockGetBlob.mockResolvedValue({
        data: { content: Buffer.from(content).toString('base64') },
      });

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
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const content = `
const utils = require('./utils');
const helper = require('../helpers/helper');
`;

      mockOctokit._mockGetBlob.mockResolvedValue({
        data: { content: Buffer.from(content).toString('base64') },
      });

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
        ],
        owner: 'test',
        repo: 'test-repo',
      };

      const content = `
import { helper } from './utils/helper';
import { Icon } from './components/Icon';
import { config } from '../config';
`;

      mockOctokit._mockGetBlob.mockResolvedValue({
        data: { content: Buffer.from(content).toString('base64') },
      });

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

// Made with Bob