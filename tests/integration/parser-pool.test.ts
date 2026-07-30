import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ParallelParser, PARSE_WORKER_THRESHOLD } from '@/parser/parallel-parser.js';
import { ProcessParseWorkerPools } from '@/parser/process-parse-worker-pools.js';
import { runAnalysis } from '@/cli/analyze/run-analysis.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtures(count: number): Promise<string[]> {
  const root = await mkdtemp(path.join(tmpdir(), 'archguard-parser-pool-'));
  roots.push(root);
  return Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const file = path.join(root, `file-${index}.ts`);
      await writeFile(file, `export class Class${index} { value = ${index}; }\n`);
      return file;
    })
  );
}

describe('parse worker pool integration', () => {
  it('is deterministic across serial and worker concurrency', async () => {
    const files = await fixtures(PARSE_WORKER_THRESHOLD);
    const serial = await new ParallelParser({
      concurrency: 1,
      workerThreshold: Infinity,
    }).parseFiles(files);
    const parallel = await new ParallelParser({ concurrency: 2, workerThreshold: 1 }).parseFiles(
      files
    );
    expect(parallel.entities).toEqual(serial.entities);
    expect(parallel.relations).toEqual(serial.relations);
    expect(parallel.sourceFiles).toEqual(serial.sourceFiles);
  });

  it('dispatches complete TypeScript package analysis with module semantics', async () => {
    const files = await fixtures(PARSE_WORKER_THRESHOLD);
    const root = path.dirname(files[0]);
    const pools = new ProcessParseWorkerPools();
    const pool = pools.get({
      language: 'typescript',
      runtime: 'native',
      workspaceRoot: root,
      concurrency: 2,
    });
    const result = await pool.parseProject({
      kind: 'project',
      workspaceRoot: root,
      config: { workspaceRoot: root, excludePatterns: [] },
    });
    expect(result.success).toBe(true);
    expect(result.archJson?.entities).toHaveLength(PARSE_WORKER_THRESHOLD);
    expect(result.archJson?.extensions?.tsAnalysis).toBeDefined();
    expect(pool.dispatchCount).toBe(1);
    await pools.terminate();
  }, 120_000);

  it('dispatches real non-TypeScript projects and releases all worker threads', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'archguard-python-pool-'));
    roots.push(root);
    for (let index = 0; index < PARSE_WORKER_THRESHOLD; index++) {
      await writeFile(path.join(root, `file-${index}.py`), `class Class${index}:\n    pass\n`);
    }
    const pools = new ProcessParseWorkerPools();
    const pool = pools.get({
      language: 'python',
      runtime: 'wasm',
      workspaceRoot: root,
      concurrency: 2,
    });
    const result = await pool.parseProject({
      kind: 'project',
      workspaceRoot: root,
      config: { workspaceRoot: root, excludePatterns: [] },
    });
    expect(result.success).toBe(true);
    expect(result.archJson?.entities).toHaveLength(PARSE_WORKER_THRESHOLD);
    expect(pool.dispatchCount).toBe(1);
    expect(pool.workerIds).toHaveLength(2);
    await pools.terminate();
    expect(pool.size).toBe(0);
    expect(pools.workerCount).toBe(0);
  }, 120_000);

  it('reuses one process pool across warm analyses and releases it on shutdown', async () => {
    const files = await fixtures(PARSE_WORKER_THRESHOLD);
    const root = path.dirname(files[0]);
    const pools = new ProcessParseWorkerPools();
    const reporter = { start() {}, succeed() {}, fail() {}, warn() {}, info() {}, update() {} };
    const options = {
      sessionRoot: root,
      workDir: path.join(root, '.archguard'),
      cliOptions: {
        sources: [root],
        lang: 'typescript' as const,
        format: 'json' as const,
        cache: false,
      },
      reporter,
      parseWorkerPools: pools,
    };
    await runAnalysis(options);
    const poolCount = pools.size;
    await runAnalysis(options);
    expect(poolCount).toBe(1);
    expect(pools.size).toBe(1);
    await pools.terminate();
    expect(pools.size).toBe(0);
  }, 120_000);

  it('terminates owned workers when one file errors', async () => {
    const files = await fixtures(PARSE_WORKER_THRESHOLD);
    files[0] = path.join(path.dirname(files[0]), 'missing.ts');
    const result = await new ParallelParser({ concurrency: 2, workerThreshold: 1 }).parseFiles(
      files
    );
    expect(result.sourceFiles).toContain(files[0]);
  });
});
