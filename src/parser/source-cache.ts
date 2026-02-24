/**
 * SourceCache - Caches ArchJSON parsing results for source directories
 *
 * Key Features:
 * - Caches ArchJSON by source directory hash (SHA-256)
 * - Configurable TTL for cache invalidation
 * - Automatic cache key normalization (path separators, sorting)
 * - Cache statistics and debugging support
 *
 * @module parser/source-cache
 * @version 2.1.0
 */

import { createHash } from 'crypto';
import type { ArchJSON } from '@/types/index.js';
import type { TypeScriptParser } from './index.js';

/**
 * Cache entry containing parsed ArchJSON and metadata
 */
interface CacheEntry {
  /** Parsed ArchJSON structure */
  archJson: ArchJSON;
  /** Timestamp when entry was created */
  timestamp: number;
  /** Hash of source directories */
  sourceHash: string;
}

/**
 * Options for SourceCache
 */
interface SourceCacheOptions {
  /** Time-to-live for cache entries in milliseconds (default: 60000 = 1 minute) */
  ttl?: number;
}

/**
 * SourceCache - Caches ArchJSON parsing results
 *
 * Usage:
 * ```typescript
 * const cache = new SourceCache(60000); // 1 minute TTL
 * const parser = new TypeScriptParser();
 *
 * // First call parses and caches
 * const result1 = await cache.getOrParse(['./src'], parser);
 *
 * // Second call returns cached result
 * const result2 = await cache.getOrParse(['./src'], parser);
 * expect(result1).toBe(result2);
 * ```
 */
export class SourceCache {
  private cache = new Map<string, CacheEntry>();
  private ttl: number;

  constructor(options?: SourceCacheOptions | number) {
    // Support both legacy (number) and new (options object) signatures
    if (typeof options === 'number') {
      this.ttl = options;
    } else {
      this.ttl = options?.ttl || 60000;
    }
  }

  /**
   * Generate hash key from source files
   * Normalizes path separators and sorts sources for consistent hashing
   *
   * @param sources - Array of source directory paths
   * @returns SHA-256 hash string
   */
  private hashSources(sources: string[]): string {
    const normalized = sources
      .map((s) => s.replace(/\\/g, '/')) // Normalize Windows paths
      .sort() // Sort for consistent ordering
      .join('|');

    return createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Check if cache entry is still valid (not expired)
   *
   * @param entry - Cache entry to validate
   * @returns True if entry is still valid
   */
  private isValid(entry: CacheEntry): boolean {
    const age = Date.now() - entry.timestamp;
    return age < this.ttl;
  }

  /**
   * Get cached ArchJSON or parse and cache it
   *
   * @param sources - Array of source directory paths
   * @param parser - TypeScriptParser instance
   * @returns Cached or freshly parsed ArchJSON
   */
  async getOrParse(sources: string[], parser: TypeScriptParser): Promise<ArchJSON> {
    const key = this.hashSources(sources);
    const cached = this.cache.get(key);

    // Cache hit and valid
    if (cached && this.isValid(cached)) {
      if (process.env.ArchGuardDebug === 'true') {
        console.debug(`📦 Cache hit for ${key.slice(0, 8)}: ${sources.join(', ')}`);
      }
      return cached.archJson;
    }

    // Cache miss or expired - parse and cache
    if (process.env.ArchGuardDebug === 'true') {
      console.debug(`🔍 Cache miss for ${key.slice(0, 8)}: ${sources.join(', ')}`);
    }

    // Parse first source (multi-source aggregation handled by caller)
    const archJson = await parser.parseProject(sources[0] || '.');

    // Store in cache
    this.cache.set(key, {
      archJson,
      timestamp: Date.now(),
      sourceHash: key,
    });

    return archJson;
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   *
   * @returns Cache statistics including size and entry details
   */
  getStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.entries()).map(([key, entry]) => ({
        key: key.slice(0, 8),
        age: Date.now() - entry.timestamp,
        valid: this.isValid(entry),
      })),
    };
  }
}
