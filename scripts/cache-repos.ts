import { Octokit } from '@octokit/rest';
import fs from 'fs/promises';
import path from 'path';

const REPOS = [
  { owner: 'shadcn', repo: 'ui' },
  { owner: 'honojs', repo: 'hono' },
  { owner: 'drizzle-team', repo: 'drizzle-orm' },
];

interface RepoManifest {
  metadata: {
    owner: string;
    repo: string;
    branch: string;
    defaultBranch: string;
    description: string;
    stars: number;
    lastCommitDate: string;
  };
  tree: Array<{
    path: string;
    type: 'file' | 'dir';
    size: number;
    sha: string;
  }>;
}

async function cacheRepo(owner: string, repo: string): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is required');
  }

  const octokit = new Octokit({ auth: token });
  
  console.log(`📦 Fetching ${owner}/${repo}...`);

  try {
    // Fetch repo metadata
    const { data: repoData } = await octokit.repos.get({ owner, repo });
    
    console.log(`  ✓ Metadata fetched (${repoData.stargazers_count} stars)`);

    // Fetch file tree
    const { data: treeData } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: repoData.default_branch,
      recursive: 'true',
    });
    
    console.log(`  ✓ Tree fetched (${treeData.tree.length} items)`);

    // Filter to only include files (blobs) and exclude common patterns
    const filteredTree = treeData.tree
      .filter(node => {
        if (node.type !== 'blob') return false;
        if (!node.path) return false;
        
        // Exclude common non-source files
        const excludePatterns = [
          /^\.git\//,
          /node_modules\//,
          /\.png$/i,
          /\.jpg$/i,
          /\.jpeg$/i,
          /\.gif$/i,
          /\.svg$/i,
          /\.ico$/i,
          /\.woff$/i,
          /\.woff2$/i,
          /\.ttf$/i,
          /\.eot$/i,
          /\.mp4$/i,
          /\.webm$/i,
          /\.pdf$/i,
          /\.zip$/i,
          /\.tar$/i,
          /\.gz$/i,
        ];
        
        return !excludePatterns.some(pattern => pattern.test(node.path!));
      })
      .map(node => ({
        path: node.path!,
        type: 'file' as const,
        size: node.size || 0,
        sha: node.sha!,
      }));

    console.log(`  ✓ Filtered to ${filteredTree.length} source files`);

    // Create manifest
    const manifest: RepoManifest = {
      metadata: {
        owner,
        repo,
        branch: repoData.default_branch,
        defaultBranch: repoData.default_branch,
        description: repoData.description || '',
        stars: repoData.stargazers_count,
        lastCommitDate: repoData.pushed_at || new Date().toISOString(),
      },
      tree: filteredTree,
    };

    // Ensure cache directory exists
    const cacheDir = path.join(process.cwd(), 'public', 'cache');
    await fs.mkdir(cacheDir, { recursive: true });

    // Save to public/cache/
    const filename = `${owner}-${repo}.json`;
    const filepath = path.join(cacheDir, filename);
    
    await fs.writeFile(
      filepath,
      JSON.stringify(manifest, null, 2)
    );

    console.log(`  ✓ Cached to ${filename}`);
    console.log(`  ✓ ${owner}/${repo} complete!\n`);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`  ✗ Error caching ${owner}/${repo}: ${error.message}\n`);
      throw error;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  console.log('🚀 Starting repository caching...\n');
  
  const startTime = Date.now();
  let successCount = 0;
  let failCount = 0;

  for (const { owner, repo } of REPOS) {
    try {
      await cacheRepo(owner, repo);
      successCount++;
    } catch (error) {
      failCount++;
      console.error(`Failed to cache ${owner}/${repo}`);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  console.log('─'.repeat(50));
  console.log(`✨ Caching complete in ${duration}s`);
  console.log(`   Success: ${successCount}/${REPOS.length}`);
  if (failCount > 0) {
    console.log(`   Failed: ${failCount}/${REPOS.length}`);
  }
  console.log('─'.repeat(50));

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// Made with Bob
