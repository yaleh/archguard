/**
 * AC (gap-diagram-manifest-partial-run-stale): a routed diagram's `outputs`
 * must enumerate the .mmd files it actually wrote — including class diagrams
 * split into one file per layer/namespace.
 *
 * This test deliberately uses the REAL MermaidDiagramGenerator, the REAL
 * output router, and the REAL filesystem (only the SVG renderer is stubbed),
 * so `outputs` is compared against the files that are genuinely on disk rather
 * than against mock call records.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { glob } from 'glob';
import { DiagramOutputRouter } from '@/cli/processors/diagram-output-router.js';
import type { OutputPaths } from '@/cli/processors/diagram-output-router.js';
import type { GlobalConfig, DiagramConfig } from '@/types/config.js';
import type { ArchJSON } from '@/types/index.js';
import type { ProgressReporterLike } from '@/cli/progress/index.js';
import type { MermaidRenderWorkerPool } from '@/mermaid/render-worker-pool.js';

// The renderer would pull in the full Mermaid engine; the pool is stubbed to
// return a pre-rendered SVG, so only PNG conversion (best effort) must exist.
vi.mock('@/mermaid/renderer.js', () => ({
  IsomorphicMermaidRenderer: class {
    convertSVGToPNG = vi.fn().mockResolvedValue(undefined);
    renderSVGRaw = vi.fn().mockResolvedValue('<svg/>');
  },
}));

function makeProgress(): ProgressReporterLike {
  return {
    start: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  };
}

function makePool(): MermaidRenderWorkerPool {
  return {
    render: vi.fn().mockResolvedValue({ success: true, svg: '<svg viewBox="0 0 10 10"/>' }),
    start: vi.fn(),
    terminate: vi.fn().mockResolvedValue(undefined),
  } as unknown as MermaidRenderWorkerPool;
}

function makeEntity(name: string, file: string): ArchJSON['entities'][number] {
  return {
    id: `${file}.${name}`,
    name,
    type: 'class',
    visibility: 'public',
    members: [],
    sourceLocation: { file, startLine: 1, endLine: 10 },
  };
}

describe('DiagramOutputRouter — split class diagram outputs', () => {
  let tmpDir: string;
  let outputDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'router-split-outputs-'));
    outputDir = path.join(tmpDir, 'output');
    await fs.ensureDir(path.join(outputDir, 'class'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('returns exactly the split .mmd files present under outputDir', async () => {
    const archJSON: ArchJSON = {
      version: '1.1',
      language: 'typescript',
      timestamp: '2026-10-21T00:00:00.000Z',
      sourceFiles: ['src/alpha/A.ts', 'src/beta/B.ts'],
      entities: [
        makeEntity('AlphaOne', path.join(tmpDir, 'src/alpha/A.ts')),
        makeEntity('AlphaTwo', path.join(tmpDir, 'src/alpha/A.ts')),
        makeEntity('AlphaThree', path.join(tmpDir, 'src/alpha/A.ts')),
        makeEntity('BetaOne', path.join(tmpDir, 'src/beta/B.ts')),
        makeEntity('BetaTwo', path.join(tmpDir, 'src/beta/B.ts')),
        makeEntity('BetaThree', path.join(tmpDir, 'src/beta/B.ts')),
      ],
      relations: [],
    };

    // 6 entities in two 3-entity groups; limit 4 forces the split path (the
    // grouper merges groups of <= 2 entities, so each group needs 3).
    const globalConfig = {
      formats: ['mermaid'],
      outputDir,
      exclude: [],
      maxNodesPerDiagram: 4,
    } as GlobalConfig;

    const paths: OutputPaths = {
      paths: {
        json: path.join(outputDir, 'class', 'all-classes.json'),
        mmd: path.join(outputDir, 'class', 'all-classes.mmd'),
        svg: path.join(outputDir, 'class', 'all-classes.svg'),
        png: path.join(outputDir, 'class', 'all-classes.png'),
        puml: path.join(outputDir, 'class', 'all-classes.puml'),
      },
    };
    const diagram = {
      name: 'class/all-classes',
      sources: [path.join(tmpDir, 'src')],
      level: 'class',
    } as DiagramConfig;

    const router = new DiagramOutputRouter(globalConfig, makeProgress());
    const outputs = await router.route(archJSON, paths, diagram, makePool());

    const onDisk = (await glob('**/*.mmd', { cwd: outputDir, absolute: true })).sort();
    expect(outputs).toHaveLength(2);
    expect([...outputs].sort()).toEqual(onDisk);
    expect(outputs.map((file) => path.basename(file)).sort()).toEqual([
      'Alpha_Layer.mmd',
      'Beta_Layer.mmd',
    ]);
    // The non-split primary path is NOT claimed as an output — it was never written.
    expect(outputs).not.toContain(paths.paths.mmd);
  });
});
