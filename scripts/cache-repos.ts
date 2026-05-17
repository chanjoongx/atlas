/**
 * Pre-cache demo repositories for faster loading
 * Run with: pnpm tsx scripts/cache-repos.ts
 * Requires GITHUB_TOKEN in .dev.vars
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const DEMO_REPOS = [
  { owner: 'shadcn-ui', repo: 'ui', branch: 'main' },
  { owner: 'honojs', repo: 'hono', branch: 'main' },
  { owner: 'drizzle-team', repo: 'drizzle-orm', branch: 'main' },
];

const API_BASE = process.env.API_BASE || 'http://localhost:8788';
const CACHE_DIR = join(process.cwd(), 'public', 'cache');

async function cacheRepo(owner: string, repo: string, branch: string) {
  console.log(`\n📦 Caching ${owner}/${repo}...`);

  try {
    const response = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ owner, repo, branch }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API request failed: ${response.status} ${error}`);
    }

    const data = await response.json();
    const filename = `${owner}-${repo}.json`;
    const filepath = join(CACHE_DIR, filename);

    // Ensure cache directory exists
    mkdirSync(CACHE_DIR, { recursive: true });

    // Write to cache file
    writeFileSync(filepath, JSON.stringify(data.layout, null, 2));

    console.log(`✓ Cached to ${filename}`);
    console.log(`  - ${data.layout.nodes.length} nodes`);
    console.log(`  - ${data.layout.districts.length} districts`);
    console.log(`  - ${data.layout.highlights.length} highlights`);
  } catch (error) {
    console.error(`✗ Failed to cache ${owner}/${repo}:`, error);
    throw error;
  }
}

async function main() {
  console.log('🚀 Starting repository cache generation...');
  console.log(`API Base: ${API_BASE}`);
  console.log(`Cache Directory: ${CACHE_DIR}`);

  // Check if API is running
  try {
    const healthCheck = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'test', repo: 'test' }),
    });
    
    if (healthCheck.status === 404) {
      throw new Error('API endpoint not found. Make sure the dev server is running.');
    }
  } catch (error) {
    console.error('\n❌ Cannot connect to API. Please ensure:');
    console.error('   1. Dev server is running: pnpm dev');
    console.error('   2. GITHUB_TOKEN is set in .dev.vars');
    console.error('   3. API_BASE is correct (default: http://localhost:8788)\n');
    process.exit(1);
  }

  let successCount = 0;
  let failCount = 0;

  for (const { owner, repo, branch } of DEMO_REPOS) {
    try {
      await cacheRepo(owner, repo, branch);
      successCount++;
    } catch (error) {
      failCount++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`✓ Successfully cached: ${successCount}`);
  console.log(`✗ Failed: ${failCount}`);
  console.log('='.repeat(50));

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// Made with Bob
