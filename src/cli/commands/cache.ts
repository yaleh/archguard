/**
 * Cache Commands - Manage cache operations
 */

import { Command } from 'commander';
import { CacheManager } from '../cache-manager.js';
import chalk from 'chalk';

/**
 * Create the cache command with subcommands
 */
export function createCacheCommand(): Command {
  const cacheCmd = new Command('cache')
    .description('Manage cache operations');

  // cache clear
  cacheCmd
    .command('clear')
    .description('Clear all cached data')
    .action(async () => {
      try {
        const cache = new CacheManager();
        await cache.clear();
        console.log(chalk.green('✓ Cache cleared successfully'));
      } catch (error) {
        console.error(chalk.red('✗ Failed to clear cache:'), error);
        process.exit(1);
      }
    });

  // cache stats
  cacheCmd
    .command('stats')
    .description('Show cache statistics')
    .action(async () => {
      try {
        const cache = new CacheManager();
        const stats = cache.getStats();
        const size = await cache.getCacheSize();

        console.log(chalk.bold('\nCache Statistics:'));
        console.log(chalk.gray('  Directory:'), cache.cacheDir);
        console.log(chalk.gray('  Hits:'), chalk.green(stats.hits.toString()));
        console.log(chalk.gray('  Misses:'), chalk.yellow(stats.misses.toString()));
        console.log(chalk.gray('  Hit Rate:'), chalk.cyan(`${(stats.hitRate * 100).toFixed(2)}%`));
        console.log(chalk.gray('  Total Size:'), formatBytes(size));
        console.log();
      } catch (error) {
        console.error(chalk.red('✗ Failed to get cache stats:'), error);
        process.exit(1);
      }
    });

  return cacheCmd;
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
