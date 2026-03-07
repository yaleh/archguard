import fs from 'fs-extra';
import path from 'path';
import { createHash } from 'crypto';
import type { ArchJSON } from '@/types/index.js';
import { canonicalizeArchJson } from '@/cli/utils/canonicalize-arch-json.js';

export const CACHE_VERSION = '1.0.0';

interface CacheEntry {
  version: string;
  createdAt: string;
  archJson: ArchJSON;
}

export class ArchJsonDiskCache {
  constructor(private readonly cacheDir: string) {}

  private keyPath(key: string): string {
    const sub = key.slice(0, 2);
    return path.join(this.cacheDir, sub, `${key}.json`);
  }

  async get(key: string): Promise<ArchJSON | null> {
    const filePath = this.keyPath(key);
    try {
      if (!(await fs.pathExists(filePath))) return null;
      const entry = (await fs.readJson(filePath)) as CacheEntry;
      if (entry.version !== CACHE_VERSION) return null;
      return entry.archJson;
    } catch {
      return null;
    }
  }

  async set(key: string, archJson: ArchJSON): Promise<void> {
    const filePath = this.keyPath(key);
    await fs.ensureDir(path.dirname(filePath));
    const entry: CacheEntry = {
      version: CACHE_VERSION,
      createdAt: new Date().toISOString(),
      archJson: canonicalizeArchJson(archJson),
    };
    await fs.writeJson(filePath, entry);
  }

  async computeKey(files: string[]): Promise<string> {
    const sorted = [...files].sort();
    const hashes = await Promise.all(
      sorted.map(async (f) => {
        const content = await fs.readFile(f);
        return createHash('sha256').update(content).digest('hex');
      })
    );
    const combined = sorted.map((f, i) => `${f}:${hashes[i]}`).join('\n');
    return createHash('sha256').update(combined).digest('hex');
  }

  async clear(): Promise<void> {
    await fs.emptyDir(this.cacheDir);
  }
}
