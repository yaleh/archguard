import { describe, expect, it } from 'vitest';
import { execa } from 'execa';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

interface DoctorResult {
  ok: boolean;
  provider?: 'claude' | 'codex';
  checks: Array<{ id: string; status: string; message: string }>;
}

describe('config doctor E2E', () => {
  it('uses installed Codex and Claude config plus independent stdio MCP listTools', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-doctor-e2e-'));
    try {
      const beforeInstall = await execa(
        'node',
        ['dist/cli/index.js', 'config', 'doctor', 'codex', '--home', home, '--json', '--no-probe'],
        { reject: false }
      );
      expect(beforeInstall.exitCode).toBe(1);
      const before = JSON.parse(beforeInstall.stdout) as DoctorResult;
      expect(before.ok).toBe(false);
      expect(before.checks.find((check) => check.id === 'codex.config.exists')?.status).toBe(
        'fail'
      );

      await execa('node', ['dist/cli/index.js', 'install', 'codex', '--home', home]);
      await execa('node', ['dist/cli/index.js', 'install', 'claude', '--home', home]);

      const codexDoctor = await execa('node', [
        'dist/cli/index.js',
        'config',
        'doctor',
        'codex',
        '--home',
        home,
        '--json',
      ]);
      const codex = JSON.parse(codexDoctor.stdout) as DoctorResult;
      expect(codex.ok).toBe(true);
      expect(codex.checks.find((check) => check.id === 'mcp.stdio.list-tools')?.status).toBe(
        'pass'
      );
      expect(
        codex.checks.find((check) => check.id === 'codex.config.archguard-entry')?.status
      ).toBe('pass');

      const claudeDoctor = await execa('node', [
        'dist/cli/index.js',
        'config',
        'doctor',
        'claude',
        '--home',
        home,
        '--json',
      ]);
      const claude = JSON.parse(claudeDoctor.stdout) as DoctorResult;
      expect(claude.ok).toBe(true);
      expect(claude.checks.find((check) => check.id === 'mcp.stdio.list-tools')?.message).toContain(
        'listed'
      );
      expect(
        claude.checks.find((check) => check.id === 'claude.config.archguard-entry')?.status
      ).toBe('pass');
    } finally {
      await fs.remove(home);
    }
  });
});
