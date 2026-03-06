import { describe, it, expect } from 'vitest';
import { DiagramIndexGenerator } from '@/cli/utils/diagram-index-generator.js';
import type { DiagramResult } from '@/cli/processors/diagram-processor.js';
import type { ArchJSONMetrics, FileStats, CycleInfo } from '@/types/index.js';
import type { GlobalConfig } from '@/types/config.js';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';

// ── Helpers ─────────────────────────────────────────────────────────────────

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-idx-'));

const baseConfig = (outputDir: string): GlobalConfig => ({ outputDir }) as GlobalConfig;

const makeResult = (
  name: string,
  level: ArchJSONMetrics['level'],
  fileStats?: FileStats[],
  cycles?: CycleInfo[]
): DiagramResult => ({
  name,
  success: true,
  stats: { entities: 10, relations: 5, parseTime: 1000 },
  metrics: {
    level,
    entityCount: 10,
    relationCount: 5,
    relationTypeBreakdown: {},
    stronglyConnectedComponents: 10,
    inferredRelationRatio: 0,
    fileStats,
    cycles,
  },
});

const makeFileStats = (file: string, overrides: Partial<FileStats> = {}): FileStats => ({
  file,
  loc: 100,
  entityCount: 2,
  methodCount: 5,
  fieldCount: 3,
  inDegree: 4,
  outDegree: 2,
  cycleCount: 0,
  ...overrides,
});

const makeCycle = (size: number, files: string[], members: string[]): CycleInfo => ({
  size,
  members,
  memberNames: members,
  files,
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('DiagramIndexGenerator — stats tables', () => {
  it('no metrics in any result: no stats sections in index.md', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    await gen.generate([
      { name: 'pkg', success: true, stats: { entities: 1, relations: 0, parseTime: 0 } },
    ]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    expect(content).not.toContain('## File Statistics');
    expect(content).not.toContain('## Circular Dependencies');
    await fs.remove(dir);
  });

  it('only package-level metrics: no stats sections', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    const result = makeResult('pkg', 'package', undefined, undefined);
    await gen.generate([result]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    expect(content).not.toContain('## File Statistics');
    expect(content).not.toContain('## Circular Dependencies');
    await fs.remove(dir);
  });

  it('class-level metrics: File Statistics section appears', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    await gen.generate([makeResult('cls', 'class', [makeFileStats('src/a.ts')], [])]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    expect(content).toContain('## File Statistics');
    expect(content).toContain('src/a.ts');
    await fs.remove(dir);
  });

  it('class-level metrics: Circular Dependencies section appears', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    await gen.generate([
      makeResult(
        'cls',
        'class',
        [makeFileStats('src/a.ts')],
        [makeCycle(2, ['src/a.ts', 'src/b.ts'], ['A', 'B'])]
      ),
    ]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    expect(content).toContain('## Circular Dependencies');
    expect(content).toContain('1 cycle');
    expect(content).toContain('A, B');
    await fs.remove(dir);
  });

  it('empty cycles: "No circular dependencies detected." message', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    await gen.generate([makeResult('cls', 'class', [makeFileStats('src/a.ts')], [])]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    expect(content).toContain('No circular dependencies detected');
    expect(content).not.toMatch(/\| # \| Size/); // no table
    await fs.remove(dir);
  });

  it('fileStats undefined (Go Atlas): both stats sections omitted', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    await gen.generate([makeResult('atlas', 'class', undefined, undefined)]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    expect(content).not.toContain('## File Statistics');
    expect(content).not.toContain('## Circular Dependencies');
    await fs.remove(dir);
  });

  it('fileStats empty array: File Statistics omitted, Circular Dependencies still rendered', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    await gen.generate([makeResult('cls', 'class', [], [])]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    expect(content).not.toContain('## File Statistics');
    expect(content).toContain('## Circular Dependencies');
    expect(content).toContain('No circular dependencies detected');
    await fs.remove(dir);
  });

  it('prefers class over method when both present', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    await gen.generate([
      makeResult('method-diag', 'method', [makeFileStats('src/x.ts')], []),
      makeResult('class-diag', 'class', [makeFileStats('src/y.ts')], []),
    ]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    expect(content).toContain('src/y.ts');
    expect(content).not.toContain('src/x.ts');
    await fs.remove(dir);
  });

  it('uses method-level when no class-level present', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    await gen.generate([makeResult('method-diag', 'method', [makeFileStats('src/m.ts')], [])]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    expect(content).toContain('src/m.ts');
    await fs.remove(dir);
  });

  it('stats tables appear after the Diagrams section', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    await gen.generate([makeResult('cls', 'class', [makeFileStats('src/a.ts')], [])]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    const diagramsIdx = content.indexOf('## Diagrams');
    const fileStatsIdx = content.indexOf('## File Statistics');
    const circularIdx = content.indexOf('## Circular Dependencies');
    expect(diagramsIdx).toBeGreaterThan(-1);
    expect(fileStatsIdx).toBeGreaterThan(diagramsIdx);
    expect(circularIdx).toBeGreaterThan(fileStatsIdx);
    await fs.remove(dir);
  });

  it('file stats table header contains expected columns', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    await gen.generate([makeResult('cls', 'class', [makeFileStats('src/a.ts')], [])]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    expect(content).toContain('| File |');
    expect(content).toContain('LOC');
    expect(content).toContain('Entities');
    expect(content).toContain('Methods');
    expect(content).toContain('Fields');
    expect(content).toContain('InDegree');
    expect(content).toContain('OutDegree');
    expect(content).toContain('Cycles');
    await fs.remove(dir);
  });

  it('top-30 truncation: only first 30 files shown when fileStats has 35 entries', async () => {
    const dir = tmpDir();
    const gen = new DiagramIndexGenerator(baseConfig(dir));
    const manyFiles = Array.from({ length: 35 }, (_, i) =>
      makeFileStats(`src/file${String(i).padStart(2, '0')}.ts`, { inDegree: 35 - i })
    );
    await gen.generate([makeResult('cls', 'class', manyFiles, [])]);
    const content = await fs.readFile(path.join(dir, 'index.md'), 'utf-8');
    expect(content).toContain('src/file00.ts');
    expect(content).not.toContain('src/file34.ts');
    await fs.remove(dir);
  });
});
