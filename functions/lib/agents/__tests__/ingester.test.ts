import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ingestRepo } from '../ingester';
import type { Octokit } from '@octokit/rest';
import type { IngesterInput } from '../../types';

// Mock Octokit responses
const createMockOctokit = (overrides?: Partial<MockOctokitResponses>): Octokit => {
  const defaults: MockOctokitResponses = {
    repoData: {
      default_branch: 'main',
      description: 'A test repository',
      stargazers_count: 1234,
    },
    branchData: {
      commit: {
        commit: {
          tree: { sha: 'tree-sha-123' },
          committer: { date: '2026-05-17T00:00:00Z' },
        },
      },
    },
    treeData: {
      truncated: false,
      tree: [
        { path: 'README.md', type: 'blob', size: 1024, sha: 'sha1' },
        { path: 'src/index.ts', type: 'blob', size: 2048, sha: 'sha2' },
        { path: 'src/utils.ts', type: 'blob', size: 512, sha: 'sha3' },
        { path: 'src', type: 'tree', size: 0, sha: 'sha4' },
      ],
    },
    ...overrides,
  };

  return {
    rest: {
      repos: {
        get: vi.fn().mockResolvedValue({ data: defaults.repoData }),
        getBranch: vi.fn().mockResolvedValue({ data: defaults.branchData }),
      },
      git: {
        getTree: vi.fn().mockResolvedValue({ data: defaults.treeData }),
      },
    },
  } as unknown as Octokit;
};

interface MockOctokitResponses {
  repoData: {
    default_branch: string;
    description: string;
    stargazers_count: number;
  };
  branchData: {
    commit: {
      commit: {
        tree: { sha: string };
        committer: { date: string };
      };
    };
  };
  treeData: {
    truncated: boolean;
    tree: Array<{ path: string; type: string; size: number; sha: string }>;
  };
}

describe('Agent 1: Repo Ingester', () => {
  describe('Success Cases', () => {
    it('should successfully ingest a small repository', async () => {
      const input: IngesterInput = {
        owner: 'testuser',
        repo: 'testrepo',
      };

      const octokit = createMockOctokit();
      const result = await ingestRepo(input, octokit);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata.owner).toBe('testuser');
        expect(result.data.metadata.repo).toBe('testrepo');
        expect(result.data.metadata.branch).toBe('main');
        expect(result.data.metadata.defaultBranch).toBe('main');
        expect(result.data.metadata.description).toBe('A test repository');
        expect(result.data.metadata.stars).toBe(1234);
        expect(result.data.tree).toHaveLength(4);
      }
    });

    it('should use specified branch instead of default', async () => {
      const input: IngesterInput = {
        owner: 'testuser',
        repo: 'testrepo',
        branch: 'develop',
      };

      const octokit = createMockOctokit();
      const result = await ingestRepo(input, octokit);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata.branch).toBe('develop');
        expect(result.data.metadata.defaultBranch).toBe('main');
      }

      expect(octokit.rest.repos.getBranch).toHaveBeenCalledWith({
        owner: 'testuser',
        repo: 'testrepo',
        branch: 'develop',
      });
    });

    it('should filter out excluded directories', async () => {
      const input: IngesterInput = {
        owner: 'testuser',
        repo: 'testrepo',
      };

      const octokit = createMockOctokit({
        treeData: {
          truncated: false,
          tree: [
            { path: 'src/index.ts', type: 'blob', size: 1024, sha: 'sha1' },
            { path: 'node_modules/package/index.js', type: 'blob', size: 512, sha: 'sha2' },
            { path: '.git/config', type: 'blob', size: 256, sha: 'sha3' },
            { path: 'dist/bundle.js', type: 'blob', size: 10240, sha: 'sha4' },
            { path: 'build/output.js', type: 'blob', size: 8192, sha: 'sha5' },
          ],
        },
      });

      const result = await ingestRepo(input, octokit);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tree).toHaveLength(1);
        expect(result.data.tree[0].path).toBe('src/index.ts');
      }
    });

    it('should filter out binary files', async () => {
      const input: IngesterInput = {
        owner: 'testuser',
        repo: 'testrepo',
      };

      const octokit = createMockOctokit({
        treeData: {
          truncated: false,
          tree: [
            { path: 'src/index.ts', type: 'blob', size: 1024, sha: 'sha1' },
            { path: 'assets/logo.png', type: 'blob', size: 5120, sha: 'sha2' },
            { path: 'docs/guide.pdf', type: 'blob', size: 102400, sha: 'sha3' },
            { path: 'fonts/font.woff2', type: 'blob', size: 2048, sha: 'sha4' },
            { path: 'video.mp4', type: 'blob', size: 1048576, sha: 'sha5' },
          ],
        },
      });

      const result = await ingestRepo(input, octokit);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tree).toHaveLength(1);
        expect(result.data.tree[0].path).toBe('src/index.ts');
      }
    });

    it('should handle large repository with 500 files', async () => {
      const input: IngesterInput = {
        owner: 'testuser',
        repo: 'largerepo',
      };

      // Generate 500 mock files
      const largeTree = Array.from({ length: 500 }, (_, i) => ({
        path: `src/file${i}.ts`,
        type: 'blob',
        size: 1024,
        sha: `sha${i}`,
      }));

      const octokit = createMockOctokit({
        treeData: {
          truncated: false,
          tree: largeTree,
        },
      });

      const result = await ingestRepo(input, octokit);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tree).toHaveLength(500);
      }
    });
  });

  describe('Error Cases', () => {
    it('should return error for missing owner', async () => {
      const input: IngesterInput = {
        owner: '',
        repo: 'testrepo',
      };

      const octokit = createMockOctokit();
      const result = await ingestRepo(input, octokit);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_INPUT');
        expect(result.error.message).toContain('Owner and repo are required');
      }
    });

    it('should return error for missing repo', async () => {
      const input: IngesterInput = {
        owner: 'testuser',
        repo: '',
      };

      const octokit = createMockOctokit();
      const result = await ingestRepo(input, octokit);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_INPUT');
      }
    });

    it('should handle 404 repository not found', async () => {
      const input: IngesterInput = {
        owner: 'testuser',
        repo: 'nonexistent',
      };

      const octokit = {
        rest: {
          repos: {
            get: vi.fn().mockRejectedValue({
              status: 404,
              message: 'Not Found',
            }),
          },
        },
      } as unknown as Octokit;

      const result = await ingestRepo(input, octokit);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toContain('not found');
      }
    });

    it('should handle 403 rate limit error', async () => {
      const input: IngesterInput = {
        owner: 'testuser',
        repo: 'testrepo',
      };

      const octokit = {
        rest: {
          repos: {
            get: vi.fn().mockRejectedValue({
              status: 403,
              message: 'API rate limit exceeded',
            }),
          },
        },
      } as unknown as Octokit;

      const result = await ingestRepo(input, octokit);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('RATE_LIMIT');
        expect(result.error.message).toContain('rate limit');
      }
    });

    it('should handle 500 server error', async () => {
      const input: IngesterInput = {
        owner: 'testuser',
        repo: 'testrepo',
      };

      const octokit = {
        rest: {
          repos: {
            get: vi.fn().mockRejectedValue({
              status: 500,
              message: 'Internal Server Error',
            }),
          },
        },
      } as unknown as Octokit;

      const result = await ingestRepo(input, octokit);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('SERVER_ERROR');
        expect(result.error.message).toContain('server error');
      }
    });

    it('should handle truncated tree (>100k files)', async () => {
      const input: IngesterInput = {
        owner: 'testuser',
        repo: 'hugerepo',
      };

      const octokit = createMockOctokit({
        treeData: {
          truncated: true,
          tree: [],
        },
      });

      const result = await ingestRepo(input, octokit);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('REPO_TOO_LARGE');
        expect(result.error.message).toContain('100,000 files');
      }
    });

    it('should handle malformed API response', async () => {
      const input: IngesterInput = {
        owner: 'testuser',
        repo: 'testrepo',
      };

      const octokit = {
        rest: {
          repos: {
            get: vi.fn().mockRejectedValue(new Error('Network error')),
          },
        },
      } as unknown as Octokit;

      const result = await ingestRepo(input, octokit);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toContain('Network error');
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle repository with no description', async () => {
      const input: IngesterInput = {
        owner: 'testuser',
        repo: 'testrepo',
      };

      const octokit = createMockOctokit({
        repoData: {
          default_branch: 'main',
          description: null as any,
          stargazers_count: 0,
        },
      });

      const result = await ingestRepo(input, octokit);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata.description).toBe('');
      }
    });

    it('should handle empty tree', async () => {
      const input: IngesterInput = {
        owner: 'testuser',
        repo: 'emptyrepo',
      };

      const octokit = createMockOctokit({
        treeData: {
          truncated: false,
          tree: [],
        },
      });

      const result = await ingestRepo(input, octokit);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tree).toHaveLength(0);
      }
    });

    it('should correctly map tree type to file/dir', async () => {
      const input: IngesterInput = {
        owner: 'testuser',
        repo: 'testrepo',
      };

      const octokit = createMockOctokit({
        treeData: {
          truncated: false,
          tree: [
            { path: 'file.txt', type: 'blob', size: 100, sha: 'sha1' },
            { path: 'directory', type: 'tree', size: 0, sha: 'sha2' },
          ],
        },
      });

      const result = await ingestRepo(input, octokit);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tree[0].type).toBe('file');
        expect(result.data.tree[1].type).toBe('dir');
      }
    });
  });
});

// Made with Bob
