/**
 * Positive controls for the analysis detectors (TASK-101).
 *
 * A detector that returns 0 / `[]` is only trustworthy if it is known to report
 * a defect that is really there. Each group below plants a known defect in a
 * throw-away TypeScript project, runs the real `runAnalysis` → `loadEngine`
 * pipeline (no Claude CLI, no network) and asserts the detector reports it —
 * then removes the defect and asserts it no longer does, so the assertion is
 * not vacuously true.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { runAnalysis } from '@/cli/analyze/run-analysis.js';
import { NoopReporter } from '@/cli/progress/index.js';
import { loadEngine, readManifest } from '@/cli/query/engine-loader.js';
import { registerShapeSmellTools } from '@/cli/mcp/tools/shape-smell-tools.js';
import { registerClusterBoundaryTool } from '@/cli/mcp/tools/arch-health-tools.js';
import type { LiteralDispersionSmell } from '@/analysis/shape-smells/types.js';
import type { ClusterBoundaryReport } from '@/analysis/jl/types.js';
import type { CycleInfo } from '@/types/index.js';

type Files = Record<string, string>;
type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
}>;

/** Run `fn` against a fresh temp workspace; always remove it afterwards. */
async function withWorkspace<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-controls-')));
  try {
    return await fn(root);
  } finally {
    await fs.remove(root);
  }
}

async function writeFiles(dir: string, files: Files): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    await fs.outputFile(path.join(dir, rel), content);
  }
}

/** Real analysis pipeline over `sources`, persisting query scopes under `<root>/.archguard`. */
async function analyze(root: string, sources: string[]): Promise<void> {
  await runAnalysis({
    sessionRoot: root,
    workDir: path.join(root, '.archguard'),
    cliOptions: {
      sources,
      outputDir: path.join(root, '.archguard', 'output'),
      format: 'json',
      cache: false,
    },
    reporter: new NoopReporter(),
  });
}

/** Register a tool on a stub server and return its handler — the real tool code path. */
function captureTool(
  register: (server: never, defaultRoot: string) => void,
  toolName: string,
  root: string
): ToolHandler {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, ...rest: unknown[]): void => {
      handlers.set(name, rest[rest.length - 1] as ToolHandler);
    },
  };
  register(server as never, root);
  const handler = handlers.get(toolName);
  if (!handler) throw new Error(`tool ${toolName} was not registered`);
  return handler;
}

async function callJson<T>(handler: ToolHandler, args: Record<string, unknown>): Promise<T> {
  const res = await handler(args);
  return JSON.parse(res.content[0].text) as T;
}

// ---------------------------------------------------------------------------
// 1. Dependency cycle
// ---------------------------------------------------------------------------

describe('positive control: dependency cycle (detect_cycles)', () => {
  const cyclic: Files = {
    'src/a.ts': `import { B } from './b.js';
export class A {
  b?: B;
  useB(): B | undefined {
    return this.b;
  }
}
`,
    'src/b.ts': `import { A } from './a.js';
export class B {
  a?: A;
  useA(): A | undefined {
    return this.a;
  }
}
`,
  };
  // Same project with the B → A edge removed.
  const acyclic: Files = {
    ...cyclic,
    'src/b.ts': `export class B {
  value = 1;
}
`,
  };

  async function cyclesOf(files: Files): Promise<CycleInfo[]> {
    return withWorkspace(async (root) => {
      await writeFiles(root, files);
      await analyze(root, [path.join(root, 'src')]);
      const { engine } = await loadEngine(path.join(root, '.archguard'));
      return engine.getCycles();
    });
  }

  it('reports the planted A <-> B cycle', async () => {
    const cycles = await cyclesOf(cyclic);
    expect(cycles.length).toBeGreaterThanOrEqual(1);
    const members = cycles.flatMap((c) => c.memberNames);
    expect(members).toEqual(expect.arrayContaining(['A', 'B']));
  }, 90000);

  it('reports no cycle once the back edge is removed (negative control)', async () => {
    expect(await cyclesOf(acyclic)).toEqual([]);
  }, 90000);
});

// ---------------------------------------------------------------------------
// 2. Literal dispersion (single- AND double-quoted)
// ---------------------------------------------------------------------------

describe('positive control: literal dispersion (detect_shape_smells)', () => {
  // `idle` is compared with single quotes, `busy` with double quotes; each is
  // compared in two files besides the type definition => dispersion 3.
  const dispersed: Files = {
    'src/model/status.ts': `export type Status = 'idle' | "busy";\n`,
    'src/ui/panel.ts': `import type { Status } from '../model/status.js';
export function label(s: Status): string {
  if (s === 'idle') return 'Idle';
  if (s === "busy") return 'Busy';
  return '';
}
`,
    'src/svc/worker.ts': `import type { Status } from '../model/status.js';
export function canStart(s: Status): boolean {
  if (s === 'idle') return true;
  return s === "busy";
}
`,
  };
  // Same project with every comparison removed: the literals live in one file only.
  const localised: Files = {
    ...dispersed,
    'src/ui/panel.ts': `export function label(): string {\n  return '';\n}\n`,
    'src/svc/worker.ts': `export function canStart(): boolean {\n  return true;\n}\n`,
  };

  async function smellsOf(files: Files): Promise<LiteralDispersionSmell[]> {
    return withWorkspace(async (root) => {
      await writeFiles(root, files);
      await analyze(root, [path.join(root, 'src')]);
      const detect = captureTool(registerShapeSmellTools, 'archguard_detect_shape_smells', root);
      const out = await callJson<{ results: Array<{ smells: LiteralDispersionSmell[] }> }>(detect, {
        projectRoot: root,
        layers: ['literal-dispersion'],
        dispersionThreshold: 2,
      });
      return out.results.flatMap((r) => r.smells);
    });
  }

  it('reports single-quoted and double-quoted literals dispersed across 3 files', async () => {
    const smells = await smellsOf(dispersed);

    // `idle` is compared with single quotes, `busy` with double quotes.
    for (const value of ['idle', 'busy']) {
      const found = smells.filter((s) => s.value === value);
      expect(found, `${value} must be detected`).toHaveLength(1);
      expect(found[0].typeName).toBe('Status');
      expect(found[0].dispersion).toBe(3);
      expect(found[0].files).toHaveLength(3);
    }
  }, 90000);

  it('reports nothing once the comparisons are removed (negative control)', async () => {
    expect(await smellsOf(localised)).toEqual([]);
  }, 90000);
});

// ---------------------------------------------------------------------------
// 3. Symlinked source root
// ---------------------------------------------------------------------------

describe('positive control: symlinked source root', () => {
  const project: Files = {
    'real/a.ts': `export class Alpha {\n  run(): number {\n    return 1;\n  }\n}\n`,
  };

  it('collapses a symlink and its target into a single manifest scope', async () => {
    await withWorkspace(async (root) => {
      await writeFiles(root, project);
      await fs.symlink(path.join(root, 'real'), path.join(root, 'link'), 'dir');
      await analyze(root, [path.join(root, 'real'), path.join(root, 'link')]);
      const manifest = await readManifest(path.join(root, '.archguard'));
      expect(manifest.scopes).toHaveLength(1);
    });
  }, 90000);

  it('keeps two distinct directories as two scopes (negative control)', async () => {
    await withWorkspace(async (root) => {
      await writeFiles(root, project);
      await writeFiles(root, {
        'other/b.ts': `export class Beta {\n  run(): number {\n    return 2;\n  }\n}\n`,
      });
      await analyze(root, [path.join(root, 'real'), path.join(root, 'other')]);
      const manifest = await readManifest(path.join(root, '.archguard'));
      expect(manifest.scopes.length).toBeGreaterThanOrEqual(2);
    });
  }, 90000);
});

// ---------------------------------------------------------------------------
// 4. Multiple sources
// ---------------------------------------------------------------------------

describe('positive control: multiple sources', () => {
  const twoDirs: Files = {
    'pkg-a/a.ts': `export class Alpha {\n  run(): number {\n    return 1;\n  }\n}\n`,
    'pkg-b/b.ts': `export class Beta {\n  run(): number {\n    return 2;\n  }\n}\n`,
  };

  it('persists one manifest scope per --sources entry', async () => {
    await withWorkspace(async (root) => {
      await writeFiles(root, twoDirs);
      await analyze(root, [path.join(root, 'pkg-a'), path.join(root, 'pkg-b')]);
      const manifest = await readManifest(path.join(root, '.archguard'));
      expect(manifest.scopes.filter((s) => s.kind === 'parsed')).toHaveLength(2);
      const sources = manifest.scopes.flatMap((s) => s.sources);
      expect(sources).toEqual(
        expect.arrayContaining([path.join(root, 'pkg-a'), path.join(root, 'pkg-b')])
      );
    });
  }, 90000);

  it('persists a single scope when only one source is given (negative control)', async () => {
    await withWorkspace(async (root) => {
      await writeFiles(root, twoDirs);
      await analyze(root, [path.join(root, 'pkg-a')]);
      const manifest = await readManifest(path.join(root, '.archguard'));
      expect(manifest.scopes).toHaveLength(1);
    });
  }, 90000);
});

// ---------------------------------------------------------------------------
// 5. TypeScript package boundaries (cluster boundary)
// ---------------------------------------------------------------------------

describe('positive control: TS package boundaries (get_cluster_boundary)', () => {
  // Three directories, three classes each; entity names carry no dots, so the
  // package can only come from the source directory (TASK-96).
  function pkg(dir: string, prefix: string): Files {
    return {
      [`src/${dir}/${prefix}1.ts`]: `import { ${prefix}2 } from './${prefix}2.js';
export class ${prefix}1 {
  next: ${prefix}2 = new ${prefix}2();
}
`,
      [`src/${dir}/${prefix}2.ts`]: `import { ${prefix}3 } from './${prefix}3.js';
export class ${prefix}2 {
  next: ${prefix}3 = new ${prefix}3();
}
`,
      [`src/${dir}/${prefix}3.ts`]: `export class ${prefix}3 {
  value = 1;
}
`,
    };
  }
  const threeDirs: Files = { ...pkg('alpha', 'Al'), ...pkg('beta', 'Be'), ...pkg('gamma', 'Ga') };
  const oneDir: Files = Object.fromEntries(
    Object.entries(threeDirs).map(([rel, content]) => [
      rel.replace(/src\/(alpha|beta|gamma)\//, 'src/all/'),
      content,
    ])
  );

  async function reportOf(files: Files): Promise<ClusterBoundaryReport> {
    return withWorkspace(async (root) => {
      await writeFiles(root, files);
      await analyze(root, [path.join(root, 'src')]);
      const tool = captureTool(registerClusterBoundaryTool, 'archguard_get_cluster_boundary', root);
      return callJson<ClusterBoundaryReport>(tool, { projectRoot: root, minPackageSize: 1 });
    });
  }

  it('reports packageCount 3 for a 3-directory project with dot-free entity names', async () => {
    const report = await reportOf(threeDirs);
    expect(report.packageCount).toBe(3);
  }, 90000);

  it('reports a different package count once the directories are merged (negative control)', async () => {
    const report = await reportOf(oneDir);
    expect(report.packageCount).toBe(1);
  }, 90000);
});
