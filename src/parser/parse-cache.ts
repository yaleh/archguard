/**
 * ParseCache - parse-time deduplication for TypeScriptParser
 *
 * Phase D: eliminates redundant per-file TypeScriptParser instantiation
 * for files appearing in multiple overlapping source sets.
 */

import crypto from 'node:crypto';
import type { ArchJSON } from '@/types/index.js';

export class ParseCache {
  private cache = new Map<string, ArchJSON>();

  /**
   * Return a cached parse result if one exists for the given (filePath, content) pair,
   * otherwise invoke `parse`, cache and return its result.
   *
   * @param filePath - Absolute path to the source file (included in key)
   * @param content  - Raw file content (included in key)
   * @param parse    - Factory that produces the ArchJSON when no cache entry exists
   */
  getOrParse(filePath: string, content: string, parse: () => ArchJSON): ArchJSON {
    const key = crypto
      .createHash('sha256')
      .update(filePath)
      .update('\0')
      .update(content)
      .digest('hex');

    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const result = parse();
    this.cache.set(key, result);
    return result;
  }

  /** Number of entries currently held in the cache */
  get size(): number {
    return this.cache.size;
  }

  /** Remove all cached entries */
  clear(): void {
    this.cache.clear();
  }
}
