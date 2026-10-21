import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cleanupPaths: string[] = [];

async function makeWorkDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-project-semantics-loader-'));
  cleanupPaths.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((target) => fs.rm(target, { recursive: true, force: true }))
  );
});

describe('project-semantics-loader', () => {
  it('returns undefined when the sidecar file is missing', async () => {
    const workDir = await makeWorkDir();
    const { loadProjectSemanticsSidecar } = await import('@/analysis/project-semantics-loader.js');

    await expect(loadProjectSemanticsSidecar(workDir)).resolves.toBeUndefined();
  });

  it('loads valid sidecar semantics', async () => {
    const workDir = await makeWorkDir();
    await fs.writeFile(
      path.join(workDir, 'project-semantics.json'),
      JSON.stringify({
        additionalTestPatterns: ['**/*.integration.ts'],
        architecturalLayers: {
          'src/analysis': 'analysis',
        },
      })
    );

    const { loadProjectSemanticsSidecar } = await import('@/analysis/project-semantics-loader.js');

    await expect(loadProjectSemanticsSidecar(workDir)).resolves.toEqual({
      additionalTestPatterns: ['**/*.integration.ts'],
      architecturalLayers: {
        'src/analysis': 'analysis',
      },
    });
  });

  it('throws when the sidecar file is malformed', async () => {
    const workDir = await makeWorkDir();
    await fs.writeFile(
      path.join(workDir, 'project-semantics.json'),
      JSON.stringify({
        suggestedDepth: '2',
      })
    );

    const { loadProjectSemanticsSidecar } = await import('@/analysis/project-semantics-loader.js');

    await expect(loadProjectSemanticsSidecar(workDir)).rejects.toThrow(/project-semantics\.json/);
  });

  describe('preflightProjectSemantics', () => {
    it('returns projectSemantics: "missing" when the sidecar is absent', async () => {
      const workDir = await makeWorkDir();
      const { preflightProjectSemantics } = await import('@/analysis/project-semantics-loader.js');

      await expect(preflightProjectSemantics(workDir)).resolves.toEqual({
        projectSemantics: 'missing',
      });
    });

    it('returns projectSemantics: "loaded" with the parsed semantics', async () => {
      const workDir = await makeWorkDir();
      await fs.writeFile(
        path.join(workDir, 'project-semantics.json'),
        JSON.stringify({ additionalTestPatterns: ['**/*.integration.ts'] })
      );

      const { preflightProjectSemantics } = await import('@/analysis/project-semantics-loader.js');

      await expect(preflightProjectSemantics(workDir)).resolves.toEqual({
        projectSemantics: 'loaded',
        semantics: { additionalTestPatterns: ['**/*.integration.ts'] },
      });
    });

    it('returns projectSemantics: "invalid" with an error for a malformed sidecar', async () => {
      const workDir = await makeWorkDir();
      await fs.writeFile(
        path.join(workDir, 'project-semantics.json'),
        JSON.stringify({ suggestedDepth: '2' })
      );

      const { preflightProjectSemantics } = await import('@/analysis/project-semantics-loader.js');

      const result = await preflightProjectSemantics(workDir);
      expect(result.projectSemantics).toBe('invalid');
      expect(result.error).toMatch(/project-semantics\.json/);
    });
  });
});
