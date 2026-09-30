/**
 * Cache Commands - Manage cache operations
 */

import { Command } from 'commander';
import path from 'path';
import { CacheManager } from '../cache/cache-manager.js';
import { ErrorHandler } from '../errors/index.js';
import { ConfigLoader } from '../config-loader.js';
import { clearRenderHashes } from '../cache/diagram-manifest.js';
import { pruneQueryScopes } from '../query/query-artifacts.js';
import chalk from 'chalk';

/**
 * Create the cache command with subcommands
 */
export function createCacheCommand(): Command {
  const cacheCmd = new Command('cache').description('Manage cache operations');

  // cache clear
  cacheCmd
    .command('clear')
    .description('Clear all cached data')
    .action(async () => {
      try {
        const config = await new ConfigLoader(process.cwd()).load();
        const cache = new CacheManager(config.cache.dir);
        await cache.clear();

        // Also clear render hash sidecars from the output directory
        const outputDir = config.outputDir || path.join(config.workDir || '.archguard', 'output');
        const hashCount = await clearRenderHashes(outputDir);
        if (hashCount > 0) {
          console.log(chalk.green(`✓ Cleared ${hashCount} render hash file(s)`));
        }
        console.log(chalk.green('✓ Cache cleared successfully'));
      } catch (error) {
        const errorHandler = new ErrorHandler();
        console.error(chalk.red('✗ Failed to clear cache:'));
        console.error(errorHandler.format(error));
        process.exit(1);
      }
    });

  // cache stats
  cacheCmd
    .command('stats')
    .description('Show cache statistics')
    .action(async () => {
      try {
        const config = await new ConfigLoader(process.cwd()).load();
        const cache = new CacheManager(config.cache.dir);
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
        const errorHandler = new ErrorHandler();
        console.error(chalk.red('✗ Failed to get cache stats:'));
        console.error(errorHandler.format(error));
        process.exit(1);
      }
    });

  // cache prune-scopes
  cacheCmd
    .command('prune-scopes')
    .description('Remove query scopes from .archguard/query/manifest.json')
    .option('--key <keys...>', 'Scope key(s) to remove')
    .option('--older-than-days <n>', 'Remove scopes whose generatedAt is older than N days')
    .option('--dry-run', 'Only list scopes that would be removed')
    .option('--work-dir <dir>', 'Work directory containing query/ (default: .archguard)')
    .action(
      async (opts: {
        key?: string[];
        olderThanDays?: string;
        dryRun?: boolean;
        workDir?: string;
      }) => {
        try {
          const days = opts.olderThanDays !== undefined ? Number(opts.olderThanDays) : undefined;
          if (days !== undefined && (!Number.isFinite(days) || days < 0)) {
            throw new Error('--older-than-days must be a non-negative number');
          }
          const workDir = path.resolve(opts.workDir ?? '.archguard');
          const result = await pruneQueryScopes(workDir, {
            keys: opts.key,
            olderThanDays: days,
            dryRun: opts.dryRun,
          });
          for (const k of result.missingKeys) {
            console.log(chalk.yellow(`! Scope not found: ${k}`));
          }
          const verb = opts.dryRun ? 'Would remove' : 'Removed';
          for (const s of result.removed) {
            console.log(`${verb} ${s.key} (${s.label}, generatedAt ${s.generatedAt ?? 'unknown'})`);
          }
          console.log(
            chalk.green(
              `✓ ${verb} ${result.removed.length} scope(s); ${result.remaining.length} remaining`
            )
          );
        } catch (error) {
          const errorHandler = new ErrorHandler();
          console.error(chalk.red('✗ Failed to prune scopes:'));
          console.error(errorHandler.format(error));
          process.exit(1);
        }
      }
    );

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
