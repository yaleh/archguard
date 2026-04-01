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

  function mockExecFileWithOutput(stdout: string, stderr: string): void {
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
        callback(null, { stdout, stderr });
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

  it('extracts JSON from mixed CLI transcript output', async () => {
    const projectRoot = await makeProject();
    mockExecFileWithStdout(
      [
        'OpenAI Codex v0.117.0',
        'user',
        'analyze this project',
        'codex',
        '{"version":"1.0","nonProductionPatterns":["playground"],"barrelFiles":[],"additionalTestPatterns":[],"customAssertionPatterns":[],"architecturalLayers":{"src/cli":"CLI","src/analysis":"Analysis"},"confidence":0.9}',
        'tokens used',
      ].join('\n')
    );

    const { ProjectSemanticsExplorer } = await import('@/analysis/project-semantics-explorer.js');
    const explorer = new ProjectSemanticsExplorer('codex', ['exec', '-']);

    await expect(explorer.explore(projectRoot)).resolves.toEqual(
      expect.objectContaining({
        architecturalLayers: {
          'src/cli': 'CLI',
          'src/analysis': 'Analysis',
        },
      })
    );
  });

  it('extracts JSON from stderr when stdout is empty', async () => {
    const projectRoot = await makeProject();
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
        callback(null, {
          stdout: '',
          stderr: [
            'OpenAI Codex v0.117.0',
            'codex',
            '{"version":"1.0","nonProductionPatterns":[],"barrelFiles":[],"additionalTestPatterns":[],"customAssertionPatterns":[],"architecturalLayers":{"src/plugins":"Plugins"},"confidence":0.9}',
          ].join('\n'),
        });
        return child;
      }
    );

    const { ProjectSemanticsExplorer } = await import('@/analysis/project-semantics-explorer.js');
    const explorer = new ProjectSemanticsExplorer('codex', ['exec', '-']);

    await expect(explorer.explore(projectRoot)).resolves.toEqual(
      expect.objectContaining({
        architecturalLayers: {
          'src/plugins': 'Plugins',
        },
      })
    );
  });

  it('does not mistake prompt examples echoed in stderr for the assistant result', async () => {
    const projectRoot = await makeProject();
    mockExecFileWithOutput(
      '',
      [
        'OpenAI Codex v0.117.0',
        'user',
        'Respond with JSON only using this shape:',
        '{"version":"1.0","nonProductionPatterns":["playground"],"barrelFiles":["src/index.ts"],"additionalTestPatterns":["**/*.integration.ts"],"customAssertionPatterns":["\\\\bverify\\\\s*\\\\("],"architecturalLayers":{"src/domain":"domain"},"suggestedDepth":1,"confidence":0.85}',
      ].join('\n')
    );

    const { ProjectSemanticsExplorer } = await import('@/analysis/project-semantics-explorer.js');
    const explorer = new ProjectSemanticsExplorer('codex', ['exec', '-']);

    await expect(explorer.explore(projectRoot)).resolves.toBeNull();
  });

  it('reads the final assistant message from codex output-last-message file when available', async () => {
    const projectRoot = await makeProject();
    let receivedArgs: string[] = [];
    execFileMock.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: Record<string, unknown>,
        callback: (error: Error | null, output: { stdout: string; stderr: string }) => void
      ) => {
        receivedArgs = [...args];
        const outputIndex = args.findIndex((arg) => arg === '--output-last-message' || arg === '-o');
        const outputFile = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
        const child = {
          stdin: {
            end: async () => {
              if (outputFile) {
                await fs.writeFile(
                  outputFile,
                  JSON.stringify({
                    version: '1.0',
                    nonProductionPatterns: [],
                    barrelFiles: [],
                    additionalTestPatterns: [],
                    customAssertionPatterns: [],
                    architecturalLayers: {
                      'src/cli': 'CLI',
                    },
                    confidence: 0.9,
                  })
                );
              }
              callback(null, {
                stdout: '',
                stderr: 'OpenAI Codex v0.117.0\nuser\nprompt echoed only',
              });
            },
          },
        };
        return child;
      }
    );

    const { ProjectSemanticsExplorer } = await import('@/analysis/project-semantics-explorer.js');
    const explorer = new ProjectSemanticsExplorer('codex', ['exec', '--skip-git-repo-check', '-']);

    await expect(explorer.explore(projectRoot)).resolves.toEqual(
      expect.objectContaining({
        architecturalLayers: {
          'src/cli': 'CLI',
        },
      })
    );
    expect(receivedArgs.indexOf('--output-last-message')).toBeGreaterThan(-1);
    expect(receivedArgs.indexOf('--output-last-message')).toBeLessThan(receivedArgs.indexOf('-'));
    expect(receivedArgs.indexOf('--output-schema')).toBeGreaterThan(-1);
    expect(receivedArgs.indexOf('--output-schema')).toBeLessThan(receivedArgs.indexOf('-'));
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

  it('normalizes null optional fields from schema-constrained JSON output', async () => {
    const projectRoot = await makeProject();
    mockExecFileWithStdout(
      JSON.stringify({
        version: '1.0',
        nonProductionPatterns: ['playground'],
        barrelFiles: [],
        additionalTestPatterns: [],
        customAssertionPatterns: [],
        architecturalLayers: null,
        suggestedDepth: null,
        confidence: 0.9,
      })
    );

    const { ProjectSemanticsExplorer } = await import('@/analysis/project-semantics-explorer.js');
    const explorer = new ProjectSemanticsExplorer('codex', ['exec', '-']);

    await expect(explorer.explore(projectRoot)).resolves.toEqual(
      expect.objectContaining({
        nonProductionPatterns: ['playground'],
      })
    );
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

  it('builds prompts that explicitly forbid tool use and extra file inspection', async () => {
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
    const explorer = new ProjectSemanticsExplorer('codex', ['exec', '-']);
    await explorer.explore(projectRoot);

    expect(prompt).toContain('Do not use tools');
    expect(prompt).toContain('do not inspect files beyond the provided inputs');
  });

  it('builds prompts that exclude noisy generated directories from the project tree', async () => {
    const projectRoot = await makeProject();
    await fs.mkdir(path.join(projectRoot, 'node_modules', 'left-pad'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'dist', 'cli'), { recursive: true });
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

    expect(prompt).toContain('src');
    expect(prompt).not.toContain('node_modules');
    expect(prompt).not.toContain('dist');
  });
});
