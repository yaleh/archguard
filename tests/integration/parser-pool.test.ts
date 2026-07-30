import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ParallelParser, PARSE_WORKER_THRESHOLD } from '@/parser/parallel-parser.js';

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

  it('terminates owned workers when one file errors', async () => {
    const files = await fixtures(PARSE_WORKER_THRESHOLD);
    files[0] = path.join(path.dirname(files[0]), 'missing.ts');
    const result = await new ParallelParser({ concurrency: 2, workerThreshold: 1 }).parseFiles(
      files
    );
    expect(result.sourceFiles).toContain(files[0]);
  });
});
