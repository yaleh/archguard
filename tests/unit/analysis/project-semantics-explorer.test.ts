import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

describe('ProjectSemanticsExplorer', () => {
  const cleanupPaths: string[] = [];

  beforeEach(() => {
    execFileMock.mockReset();
  });

  afterEach(async () => {
    await Promise.all(
      cleanupPaths.splice(0).map(async (target) => {
        await fs.rm(target, { recursive: true, force: true });
      })
    );
  });

  async function makeProject(): Promise<string> {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'archguard-project-semantics-explorer-')
    );
    cleanupPaths.push(projectRoot);
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'README.md'), '# Demo\nline 2\nline 3\n');
    await fs.writeFile(path.join(projectRoot, 'package.json'), '{}');
    return projectRoot;
  }

  function mockExecFileWithStdout(stdout: string): void {
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: Record<string, unknown>,
        callback: (error: Error | null, output: { stdout: string; stderr: string }) => void
      ) => {
        const child = {
          stdin: {
            end: vi.fn(),
          },
        };
        callback(null, { stdout, stderr: '' });
        return child;
      }
    );
  }

  it('returns parsed ProjectSemantics for valid CLI JSON', async () => {
    const projectRoot = await makeProject();
    mockExecFileWithStdout(
      JSON.stringify({
        version: '1.0',
        nonProductionPatterns: ['playground'],
        barrelFiles: [],
        additionalTestPatterns: ['**/*.integration.ts'],
        customAssertionPatterns: ['\\\\bverify\\\\s*\\\\('],
        confidence: 0.9,
      })
    );

    const { ProjectSemanticsExplorer } = await import('@/analysis/project-semantics-explorer.js');
    const explorer = new ProjectSemanticsExplorer('claude', ['--print']);

    await expect(explorer.explore(projectRoot)).resolves.toEqual(
      expect.objectContaining({
        nonProductionPatterns: ['playground'],
        confidence: 0.9,
      })
    );
  });

  it('returns null for invalid JSON', async () => {
    const projectRoot = await makeProject();
    mockExecFileWithStdout('not json');

    const { ProjectSemanticsExplorer } = await import('@/analysis/project-semantics-explorer.js');
    const explorer = new ProjectSemanticsExplorer('claude', []);

    await expect(explorer.explore(projectRoot)).resolves.toBeNull();
  });

  it('returns null on CLI timeout', async () => {
    const projectRoot = await makeProject();
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: Record<string, unknown>,
        callback: (error: Error | null, output?: { stdout: string; stderr: string }) => void
      ) => {
        const child = {
          stdin: {
            end: vi.fn(),
          },
        };
        const error = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
        callback(error);
        return child;
      }
    );

    const { ProjectSemanticsExplorer } = await import('@/analysis/project-semantics-explorer.js');
    const explorer = new ProjectSemanticsExplorer('claude', []);

    await expect(explorer.explore(projectRoot)).resolves.toBeNull();
  });

  it('returns null when CLI command is not found', async () => {
    const projectRoot = await makeProject();
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: Record<string, unknown>,
        callback: (error: Error | null, output?: { stdout: string; stderr: string }) => void
      ) => {
        const child = {
          stdin: {
            end: vi.fn(),
          },
        };
        const error = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
        callback(error);
        return child;
      }
    );

    const { ProjectSemanticsExplorer } = await import('@/analysis/project-semantics-explorer.js');
    const explorer = new ProjectSemanticsExplorer('missing-cli', []);

    await expect(explorer.explore(projectRoot)).resolves.toBeNull();
  });

  it('returns null when confidence is below 0.5', async () => {
    const projectRoot = await makeProject();
    mockExecFileWithStdout(
      JSON.stringify({
        version: '1.0',
        nonProductionPatterns: ['playground'],
        barrelFiles: [],
        additionalTestPatterns: [],
        customAssertionPatterns: [],
        confidence: 0.4,
      })
    );

    const { ProjectSemanticsExplorer } = await import('@/analysis/project-semantics-explorer.js');
    const explorer = new ProjectSemanticsExplorer('claude', []);

    await expect(explorer.explore(projectRoot)).resolves.toBeNull();
  });

  it('sanitizes path traversal entries from the response', async () => {
    const projectRoot = await makeProject();
    mockExecFileWithStdout(
      JSON.stringify({
        version: '1.0',
        nonProductionPatterns: ['playground', '../etc'],
        barrelFiles: [],
        additionalTestPatterns: [],
        customAssertionPatterns: [],
        confidence: 0.9,
      })
    );

    const { ProjectSemanticsExplorer } = await import('@/analysis/project-semantics-explorer.js');
    const explorer = new ProjectSemanticsExplorer('claude', []);

    await expect(explorer.explore(projectRoot)).resolves.toEqual(
      expect.objectContaining({
        nonProductionPatterns: ['playground'],
      })
    );
  });

  it('builds prompts that include the directory tree', async () => {
    const projectRoot = await makeProject();
    let prompt = '';
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: Record<string, unknown>,
        callback: (error: Error | null, output: { stdout: string; stderr: string }) => void
      ) => {
        const child = {
          stdin: {
            end: (input: string) => {
              prompt = input;
            },
          },
        };
        callback(null, {
          stdout: JSON.stringify({
            version: '1.0',
            nonProductionPatterns: [],
            barrelFiles: [],
            additionalTestPatterns: [],
            customAssertionPatterns: [],
            confidence: 0.9,
          }),
          stderr: '',
        });
        return child;
      }
    );

    const { ProjectSemanticsExplorer } = await import('@/analysis/project-semantics-explorer.js');
    const explorer = new ProjectSemanticsExplorer('claude', []);
    await explorer.explore(projectRoot);

    expect(prompt).toContain('Project tree');
    expect(prompt).toContain('src');
  });

  it('builds prompts that include the config file list', async () => {
    const projectRoot = await makeProject();
    let prompt = '';
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: Record<string, unknown>,
        callback: (error: Error | null, output: { stdout: string; stderr: string }) => void
      ) => {
        const child = {
          stdin: {
            end: (input: string) => {
              prompt = input;
            },
          },
        };
        callback(null, {
          stdout: JSON.stringify({
            version: '1.0',
            nonProductionPatterns: [],
            barrelFiles: [],
            additionalTestPatterns: [],
            customAssertionPatterns: [],
            confidence: 0.9,
          }),
          stderr: '',
        });
        return child;
      }
    );

    const { ProjectSemanticsExplorer } = await import('@/analysis/project-semantics-explorer.js');
    const explorer = new ProjectSemanticsExplorer('claude', []);
    await explorer.explore(projectRoot);

    expect(prompt).toContain('Config files found');
    expect(prompt).toContain('package.json');
  });

  it('builds prompts that include a one-shot JSON example', async () => {
    const projectRoot = await makeProject();
    let prompt = '';
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: Record<string, unknown>,
        callback: (error: Error | null, output: { stdout: string; stderr: string }) => void
      ) => {
        const child = {
          stdin: {
            end: (input: string) => {
              prompt = input;
            },
          },
        };
        callback(null, {
          stdout: JSON.stringify({
            version: '1.0',
            nonProductionPatterns: [],
            barrelFiles: [],
            additionalTestPatterns: [],
            customAssertionPatterns: [],
            confidence: 0.9,
          }),
          stderr: '',
        });
        return child;
      }
    );

    const { ProjectSemanticsExplorer } = await import('@/analysis/project-semantics-explorer.js');
    const explorer = new ProjectSemanticsExplorer('claude', []);
    await explorer.explore(projectRoot);

    expect(prompt).toContain('Example output');
    expect(prompt).toContain('"version": "1.0"');
  });
});
