import { describe, expect, it } from 'vitest';
import { execa } from 'execa';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { parse } from 'smol-toml';

describe('agent onboarding CLI E2E', () => {
  it('runs Codex and Claude onboarding commands against a temp HOME', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-onboarding-e2e-'));
    try {
      const codexDryRun = await execa('node', [
        'dist/cli/index.js',
        'install',
        'codex',
        '--home',
        home,
        '--dry-run',
        '--json',
      ]);
      expect(codexDryRun.exitCode).toBe(0);
      expect(await fs.pathExists(path.join(home, '.codex', 'config.toml'))).toBe(false);

      const claudeDryRun = await execa('node', [
        'dist/cli/index.js',
        'install',
        'claude',
        '--home',
        home,
        '--dry-run',
        '--json',
      ]);
      expect(claudeDryRun.exitCode).toBe(0);
      expect(await fs.pathExists(path.join(home, '.claude', 'mcp.json'))).toBe(false);

      await execa('node', ['dist/cli/index.js', 'install', 'codex', '--home', home, '--json']);
      await execa('node', ['dist/cli/index.js', 'install', 'claude', '--home', home, '--json']);

      const show = await execa('node', [
        'dist/cli/index.js',
        'config',
        'show',
        'codex',
        '--home',
        home,
        '--json',
      ]);
      const showResult = JSON.parse(show.stdout) as Array<{
        show?: {
          provider: string;
          exists: boolean;
          archguardEntry?: { command: string; args: string[] };
          sourceMetadataHash?: string;
        };
      }>;
      expect(showResult[0]?.show).toMatchObject({
        provider: 'codex',
        exists: true,
        archguardEntry: { command: 'archguard', args: ['mcp'] },
      });
      expect(showResult[0]?.show?.sourceMetadataHash).toBeTruthy();

      await execa('node', [
        'dist/cli/index.js',
        'config',
        'remove',
        'codex',
        '--home',
        home,
        '--dry-run',
        '--json',
      ]);
      const codex = parse(await fs.readFile(path.join(home, '.codex', 'config.toml'), 'utf-8')) as {
        mcp_servers?: Record<string, unknown>;
      };
      expect(codex.mcp_servers?.archguard).toBeDefined();
    } finally {
      await fs.remove(home);
    }
  });
});
