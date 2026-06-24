import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { parse } from 'smol-toml';
import { createCLI } from '@/cli/index';

interface OperationResult {
  provider: string;
  mcp?: { changed: boolean; path: string };
  instructions?: { changed: boolean; path: string };
  show?: {
    provider: string;
    scope: string;
    configPath: string;
    instructionsPath?: string;
    archguardEntry?: { command: string; args: string[] };
    instructionsExcerpt?: string;
    sourceMetadataHash?: string;
    exists: boolean;
    warnings: string[];
  };
  warnings: string[];
}

interface ClaudeConfigFixture {
  mcpServers?: Record<string, { command?: string; args?: string[] }>;
  archguardInstructions?: {
    sourceMetadataHash?: string;
  };
}

describe('agent onboarding CLI', () => {
  let tmpDir: string;
  let stdout = '';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-onboarding-cli-'));
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

  it('runs Codex install dry-run without writing files', async () => {
    const output = await runCli(['install', 'codex', '--home', tmpDir, '--dry-run', '--json']);

    const results = parseResults(output);
    expect(results[0]?.provider).toBe('codex');
    expect(results[0]?.mcp?.changed).toBe(true);
    expect(await fs.pathExists(path.join(tmpDir, '.codex', 'config.toml'))).toBe(false);
  });

  it('installs Claude and Codex config in temp HOME', async () => {
    await runCli(['install', 'all', '--home', tmpDir, '--json']);

    const claude = (await fs.readJson(
      path.join(tmpDir, '.claude', 'mcp.json')
    )) as ClaudeConfigFixture;
    expect(claude.mcpServers?.archguard?.command).toBe('archguard');
    expect(claude.archguardInstructions?.sourceMetadataHash).toBeTruthy();

    const codex = parse(await fs.readFile(path.join(tmpDir, '.codex', 'config.toml'), 'utf-8')) as {
      mcp_servers?: Record<string, { command?: string; args?: string[] }>;
      archguard_instructions?: { source_metadata_hash?: string };
    };
    expect(codex.mcp_servers?.archguard?.command).toBe('archguard');
    expect(codex.archguard_instructions?.source_metadata_hash).toBeTruthy();
  });

  it('returns stable config show JSON', async () => {
    await runCli(['install', 'codex', '--home', tmpDir, '--json']);

    const output = await runCli(['config', 'show', 'codex', '--home', tmpDir, '--json']);

    const result = parseResults(output)[0];
    expect(result?.show).toMatchObject({
      provider: 'codex',
      scope: 'user',
      exists: true,
      archguardEntry: { command: 'archguard', args: ['mcp'] },
    });
    expect(result?.show?.configPath).toBe(path.join(tmpDir, '.codex', 'config.toml'));
    expect(result?.show?.instructionsPath).toBe(path.join(tmpDir, '.codex', 'config.toml'));
    expect(result?.show?.sourceMetadataHash).toBeTruthy();
    expect(result?.show?.warnings).toEqual([]);
  });

  it('routes mcp-only and instructions-only to the expected writes', async () => {
    await runCli(['install', 'claude', '--home', tmpDir, '--mcp-only', '--json']);
    let claude = (await fs.readJson(
      path.join(tmpDir, '.claude', 'mcp.json')
    )) as ClaudeConfigFixture;
    expect(claude.mcpServers?.archguard).toBeDefined();
    expect(claude.archguardInstructions).toBeUndefined();

    await runCli(['update', 'claude', '--home', tmpDir, '--instructions-only', '--json']);
    claude = (await fs.readJson(path.join(tmpDir, '.claude', 'mcp.json'))) as ClaudeConfigFixture;
    expect(claude.mcpServers?.archguard?.command).toBe('archguard');
    expect(claude.archguardInstructions?.sourceMetadataHash).toBeTruthy();
  });

  it('requires force for non-dry-run remove and allows dry-run remove', async () => {
    await runCli(['install', 'codex', '--home', tmpDir, '--json']);

    await expect(runCli(['config', 'remove', 'codex', '--home', tmpDir])).rejects.toThrow(
      'config remove requires --force unless --dry-run is used.'
    );

    await runCli(['config', 'remove', 'codex', '--home', tmpDir, '--dry-run', '--json']);
    expect(await fs.pathExists(path.join(tmpDir, '.codex', 'config.toml'))).toBe(true);

    await runCli(['config', 'remove', 'codex', '--home', tmpDir, '--force', '--json']);
    const codex = parse(await fs.readFile(path.join(tmpDir, '.codex', 'config.toml'), 'utf-8')) as {
      mcp_servers?: Record<string, unknown>;
    };
    expect(codex.mcp_servers?.archguard).toBeUndefined();
  });

  async function runCli(args: string[]): Promise<string> {
    stdout = '';
    const command = createCLI();
    command.exitOverride();
    await command.parseAsync(['node', 'archguard', ...args]);
    return stdout;
  }
});

function parseResults(value: string): OperationResult[] {
  return JSON.parse(value) as OperationResult[];
}
