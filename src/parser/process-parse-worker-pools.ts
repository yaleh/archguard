import path from 'node:path';
import type { ParserRuntimeKind } from '@/plugins/shared/syntax-tree.js';
import type { ParseWorkerLanguage } from './parse-worker-pool.js';
import { ParseWorkerPool } from './parse-worker-pool.js';

export interface ParseWorkerPoolRequest {
  language: ParseWorkerLanguage;
  runtime: ParserRuntimeKind;
  workspaceRoot?: string;
  concurrency?: number;
}

/** Process-owned registry: one bounded pool per language/runtime/workspace. */
export class ProcessParseWorkerPools {
  private readonly pools = new Map<string, ParseWorkerPool>();

  get(request: ParseWorkerPoolRequest): ParseWorkerPool {
    const root = path.resolve(request.workspaceRoot ?? process.cwd());
    const size = Math.max(1, Math.min(request.concurrency ?? 4, 4));
    const key = `${request.language}:${request.runtime}:${root}:${size}`;
    let pool = this.pools.get(key);
    if (!pool) {
      pool = new ParseWorkerPool(size, { ...request, workspaceRoot: root });
      this.pools.set(key, pool);
    }
    return pool;
  }

  get size(): number {
    return this.pools.size;
  }

  async terminate(): Promise<void> {
    const pools = [...this.pools.values()];
    this.pools.clear();
    await Promise.all(pools.map((pool) => pool.terminate()));
  }
}
