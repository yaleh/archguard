import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { createCLI } from '@/cli/index';

interface DoctorResult {
  ok: boolean;
  provider?: 'claude' | 'codex';
  checks: Array<{
    id: string;
    status: 'pass' | 'warn' | 'fail' | 'skipped';
    message: string;
    path?: string;
    recovery?: string;
  }>;
  recovery: string[];
}

describe('config doctor command', () => {
  let tmpDir: string;
  let stdout = '';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-doctor-'));
    stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdout += String(chunk);
      return true;
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.remove(tmpDir);
  });

  it('fails with recovery before provider config exists', async () => {
    const result = await runDoctor([
      'config',
      'doctor',
      'codex',
      '--home',
      tmpDir,
      '--json',
      '--no-probe',
    ]);

    expect(result.ok).toBe(false);
    expect(result.provider).toBe('codex');
    expect(check(result, 'codex.config.exists')?.status).toBe('fail');
    expect(result.recovery.join('\n')).toContain('archguard install codex');
  });

  it('passes provider config checks after install with probe skipped', async () => {
    await runCli(['install', 'claude', '--home', tmpDir, '--json']);
    const result = await runDoctor([
      'config',
      'doctor',
      'claude',
      '--home',
      tmpDir,
      '--json',
      '--no-probe',
    ]);

    expect(result.ok).toBe(true);
    expect(check(result, 'claude.config.exists')?.status).toBe('pass');
    expect(check(result, 'claude.config.archguard-entry')?.status).toBe('pass');
  });

  it('returns multi-provider checks when provider is omitted', async () => {
    await runCli(['install', 'codex', '--home', tmpDir, '--json']);
    const result = await runDoctor(['config', 'doctor', '--home', tmpDir, '--json', '--no-probe']);

    expect(result.provider).toBeUndefined();
    expect(check(result, 'codex.config.exists')?.status).toBe('pass');
    expect(check(result, 'claude.config.exists')?.status).toBe('fail');
  });

  it('reports broken config fixtures with recovery', async () => {
    const codexPath = path.join(tmpDir, '.codex', 'config.toml');
    await fs.ensureDir(path.dirname(codexPath));
    await fs.writeFile(codexPath, '[other]\nvalue = true\n');
    const codex = await runDoctor([
      'config',
      'doctor',
      'codex',
      '--home',
      tmpDir,
      '--json',
      '--no-probe',
    ]);
    expect(check(codex, 'codex.config.archguard-entry')?.status).toBe('fail');

    const claudePath = path.join(tmpDir, '.claude', 'mcp.json');
    await fs.ensureDir(path.dirname(claudePath));
    await fs.writeJson(claudePath, {});
    const claude = await runDoctor([
      'config',
      'doctor',
      'claude',
      '--home',
      tmpDir,
      '--json',
      '--no-probe',
    ]);
    expect(check(claude, 'claude.config.archguard-entry')?.status).toBe('fail');

    await fs.writeFile(
      codexPath,
      ['[mcp_servers.archguard]', 'command = "/missing/archguard"', 'args = ["mcp"]', ''].join('\n')
    );
    const missingCommand = await runDoctor([
      'config',
      'doctor',
      'codex',
      '--home',
      tmpDir,
      '--json',
      '--no-probe',
    ]);
    expect(check(missingCommand, 'codex.command.exists')?.status).toBe('fail');
    expect(check(missingCommand, 'codex.command.exists')?.recovery).toContain('real executable');
  });

  async function runDoctor(args: string[]): Promise<DoctorResult> {
    return JSON.parse(await runCli(args)) as DoctorResult;
  }

  async function runCli(args: string[]): Promise<string> {
    stdout = '';
    const command = createCLI();
    command.exitOverride();
    await command.parseAsync(['node', 'archguard', ...args]);
    return stdout;
  }
});

function check(result: DoctorResult, id: string): DoctorResult['checks'][number] | undefined {
  return result.checks.find((item) => item.id === id);
}
