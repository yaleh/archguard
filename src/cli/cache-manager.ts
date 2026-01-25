/**
 * Cache Manager - File-based caching for performance optimization
 */

import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalSize: number;
}

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

/**
 * CacheManager provides file-based caching with TTL support
 * Features:
 * - SHA-256 file content hashing
 * - Cache storage in ~/.archguard/cache (or custom directory)
 * - Cache validation and invalidation
 * - Hit/miss statistics tracking
 * - TTL (time to live) support with default 24 hours
 */
export class CacheManager {
  public readonly cacheDir: string;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    hitRate: 0,
    totalSize: 0
  };
  private defaultTTL: number = 86400; // 24 hours in seconds

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir ?? path.join(os.homedir(), '.archguard', 'cache');
  }

  /**
   * Compute SHA-256 hash of file content
   */
  async computeFileHash(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Get cached data for a file
   * Returns null if cache miss or entry expired
   */
  async get<T = unknown>(filePath: string, hash: string): Promise<T | null> {
    const cacheKey = this.getCacheKey(filePath, hash);
    const cachePath = this.getCachePath(cacheKey);

    try {
      if (await fs.pathExists(cachePath)) {
        const entry: CacheEntry<T> = await fs.readJson(cachePath);

        // Check if entry is expired
        const now = Date.now();
        const age = (now - entry.timestamp) / 1000; // age in seconds

        if (age > entry.ttl) {
          // Entry expired, delete it
          await fs.remove(cachePath);
          this.stats.misses++;
          this.updateHitRate();
          return null;
        }

        this.stats.hits++;
        this.updateHitRate();
        return entry.data;
      }
    } catch (error) {
      // Cache read error, treat as miss
    }

    this.stats.misses++;
    this.updateHitRate();
    return null;
  }

  /**
   * Set cached data for a file
   */
  async set<T = unknown>(
    filePath: string,
    hash: string,
    data: T,
    options: CacheOptions = {}
  ): Promise<void> {
    const cacheKey = this.getCacheKey(filePath, hash);
    const cachePath = this.getCachePath(cacheKey);

    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: options.ttl ?? this.defaultTTL
    };

    await fs.ensureDir(path.dirname(cachePath));
    await fs.writeJson(cachePath, entry, { spaces: 2 });
  }

  /**
   * Clear all cached data
   */
  async clear(): Promise<void> {
    if (await fs.pathExists(this.cacheDir)) {
      await fs.remove(this.cacheDir);
    }

    // Reset statistics
    this.stats = {
      hits: 0,
      misses: 0,
      hitRate: 0,
      totalSize: 0
    };
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get cache directory size in bytes
   */
  async getCacheSize(): Promise<number> {
    if (!(await fs.pathExists(this.cacheDir))) {
      return 0;
    }

    let totalSize = 0;
    const files = await this.getAllCacheFiles();

    for (const file of files) {
      try {
        const stat = await fs.stat(file);
        totalSize += stat.size;
      } catch (error) {
        // Ignore errors for individual files
      }
    }

    this.stats.totalSize = totalSize;
    return totalSize;
  }

  /**
   * Get all cache file paths
   */
  private async getAllCacheFiles(): Promise<string[]> {
    if (!(await fs.pathExists(this.cacheDir))) {
      return [];
    }

    const files: string[] = [];
    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else {
          files.push(fullPath);
        }
      }
    };

    await walk(this.cacheDir);
    return files;
  }

  /**
   * Generate cache key from file path and hash
   */
  private getCacheKey(filePath: string, hash: string): string {
    return crypto
      .createHash('md5')
      .update(`${filePath}:${hash}`)
      .digest('hex');
  }

  /**
   * Get cache file path from cache key
   * Uses subdirectories to avoid too many files in one directory
   */
  private getCachePath(cacheKey: string): string {
    // Split into subdirectories: first 2 chars as subdir
    const subDir = cacheKey.slice(0, 2);
    return path.join(this.cacheDir, subDir, `${cacheKey}.json`);
  }

  /**
   * Update hit rate statistic
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  /**
   * Set default TTL
   */
  setDefaultTTL(ttl: number): void {
    this.defaultTTL = ttl;
  }

  /**
   * Get default TTL
   */
  getDefaultTTL(): number {
    return this.defaultTTL;
  }
}
