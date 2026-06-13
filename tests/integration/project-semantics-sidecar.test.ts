import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { runAnalysis } from '@/cli/analyze/run-analysis.js';
import { NoopReporter } from '@/cli/progress/index.js';

vi.mock('@/mermaid/render-worker-pool.js', () => ({
  MermaidRenderWorkerPool: class {
    async start(): Promise<void> {}
    async terminate(): Promise<void> {}
    async render(): Promise<{ success: true; svg: string }> {
      return { success: true, svg: '<svg viewBox="0 0 10 10"></svg>' };
    }
  },
}));

vi.mock('@/mermaid/renderer.js', () => ({
  IsomorphicMermaidRenderer: class {
    async renderSVGRaw(): Promise<string> {
      return '<svg viewBox="0 0 10 10"></svg>';
    }
    async convertSVGToPNG(): Promise<void> {}
  },
  inlineEdgeStyles: (svg: string) => svg,
}));

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'archguard-project-semantics-sidecar-')
  );

  await fs.ensureDir(path.join(workspaceRoot, 'src', 'analysis'));
  await fs.ensureDir(path.join(workspaceRoot, 'src', 'cli'));
  await fs.ensureDir(path.join(workspaceRoot, '.archguard'));

  await fs.writeFile(
    path.join(workspaceRoot, 'src', 'analysis', 'engine.ts'),
    `export class AnalysisEngine {
  run(): string {
    return 'ok';
  }
}
`
  );

  await fs.writeFile(
    path.join(workspaceRoot, 'src', 'cli', 'command.ts'),
    `import { AnalysisEngine } from '../analysis/engine.js';

export class CommandRunner {
  execute(): string {
    return new AnalysisEngine().run();
  }
}
`
  );

  await fs.writeJson(path.join(workspaceRoot, 'archguard.config.json'), {
    workDir: './.archguard',
    outputDir: './.archguard/output',
    format: 'mermaid',
    mermaid: {
      renderer: 'isomorphic',
      theme: 'default',
      transparentBackground: false,
    },
    diagrams: [
      {
        name: 'overview/package',
        sources: ['./src'],
        level: 'package',
      },
    ],
  });

  await fs.writeJson(path.join(workspaceRoot, '.archguard', 'project-semantics.json'), {
    architecturalLayers: {
      'src/analysis': 'analysis',
      'src/cli': 'cli',
    },
  });

  return workspaceRoot;
}

describe('project semantics sidecar integration', () => {
  const workspaces: string[] = [];

  afterEach(async () => {
    await Promise.all(
      workspaces.map(async (workspaceRoot) => {
        await fs.remove(workspaceRoot);
      })
    );
    workspaces.length = 0;
  });

  it('applies sidecar architecturalLayers to package-level Mermaid output', async () => {
    const workspaceRoot = await createWorkspace();
    workspaces.push(workspaceRoot);

    await runAnalysis({
      sessionRoot: workspaceRoot,
      workDir: path.join(workspaceRoot, '.archguard'),
      cliOptions: {
        outputDir: path.join(workspaceRoot, '.archguard', 'output'),
      },
      reporter: new NoopReporter(),
    });

    const mermaidPath = path.join(workspaceRoot, '.archguard', 'output', 'overview', 'package.mmd');
    const mermaid = await fs.readFile(mermaidPath, 'utf-8');

    expect(mermaid).toContain('flowchart');
    expect(mermaid).toContain('subgraph layer_analysis["analysis"]');
    expect(mermaid).toContain('subgraph layer_cli["cli"]');
    expect(mermaid).toContain('analysis["analysis"]:::internal');
    expect(mermaid).toContain('cli["cli"]:::internal');
    expect(mermaid).toContain('cli --> analysis');
  }, 90000);
});
