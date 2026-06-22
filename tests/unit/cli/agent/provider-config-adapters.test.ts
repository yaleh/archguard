import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { parse } from 'smol-toml';
import { ClaudeCodeAdapter, CodexAdapter } from '@/cli/agent/providers';
import type { McpServerConfig, ProviderContext, WriteOptions } from '@/cli/agent/types';
import type { InstructionRenderResult } from '@/cli/metadata';

interface ClaudeFixture {
  keep?: boolean;
  mcpServers?: Record<string, { command?: string; args?: string[] }>;
  archguardInstructions?: {
    sourceMetadataHash: string;
    content: string;
  };
}

interface CodexFixture {
  model?: string;
  mcp_servers?: Record<
    string,
    {
      command?: string;
      args?: string[];
      startup_timeout_sec?: number;
      tool_timeout_sec?: number;
    }
  >;
  archguard_instructions?: {
    source_metadata_hash: string;
    content: string;
  };
}

const mcpConfig: McpServerConfig = {
  name: 'archguard',
  command: 'archguard',
  args: ['mcp'],
  startupTimeoutSec: 30,
  toolTimeoutSec: 60,
};

const writeOptions: WriteOptions = {
  scope: 'user',
  dryRun: false,
  force: true,
  backup: true,
};

describe('provider config adapters', () => {
  let tmpDir: string;
  let projectRoot: string;
  let context: ProviderContext;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-agent-adapters-'));
    projectRoot = path.join(tmpDir, 'project');
    await fs.ensureDir(projectRoot);
    context = { scope: 'user', homeDir: tmpDir, projectRoot };
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('detects documented user and project paths', async () => {
    const claude = new ClaudeCodeAdapter();
    const codex = new CodexAdapter();

    await expect(claude.detect(context)).resolves.toMatchObject({
      configPath: path.join(tmpDir, '.claude', 'mcp.json'),
    });
    await expect(codex.detect(context)).resolves.toMatchObject({
      configPath: path.join(tmpDir, '.codex', 'config.toml'),
    });
    await expect(claude.detect({ ...context, scope: 'project' })).resolves.toMatchObject({
      configPath: path.join(projectRoot, '.mcp.json'),
    });
    await expect(codex.detect({ ...context, scope: 'project' })).resolves.toMatchObject({
      configPath: path.join(projectRoot, '.codex', 'config.toml'),
    });
  });

  it('writes and removes Claude MCP config while preserving unrelated servers', async () => {
    const adapter = new ClaudeCodeAdapter();
    const configPath = path.join(tmpDir, '.claude', 'mcp.json');
    await fs.ensureDir(path.dirname(configPath));
    await fs.writeJson(configPath, {
      mcpServers: {
        other: { command: 'other', args: ['mcp'] },
      },
      keep: true,
    });

    const result = await adapter.writeMcpServer(context, mcpConfig, writeOptions);
    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeDefined();
    if (!result.backupPath) throw new Error('Expected Claude adapter to create a backup');
    expect(await fs.pathExists(result.backupPath)).toBe(true);

    const written = (await fs.readJson(configPath)) as ClaudeFixture;
    expect(written.keep).toBe(true);
    expect(written.mcpServers?.other).toEqual({ command: 'other', args: ['mcp'] });
    expect(written.mcpServers?.archguard).toEqual({ command: 'archguard', args: ['mcp'] });

    await adapter.removeMcpServer(context, writeOptions);
    const removed = (await fs.readJson(configPath)) as ClaudeFixture;
    expect(removed.mcpServers?.other).toBeDefined();
    expect(removed.mcpServers?.archguard).toBeUndefined();
  });

  it('writes and removes Codex TOML config while preserving unrelated config', async () => {
    const adapter = new CodexAdapter();
    const configPath = path.join(tmpDir, '.codex', 'config.toml');
    await fs.ensureDir(path.dirname(configPath));
    await fs.writeFile(
      configPath,
      [
        'model = "gpt-5"',
        '',
        '[mcp_servers.other]',
        'command = "other"',
        'args = ["mcp"]',
        '',
      ].join('\n')
    );

    const result = await adapter.writeMcpServer(context, mcpConfig, writeOptions);
    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeDefined();
    if (!result.backupPath) throw new Error('Expected Codex adapter to create a backup');
    expect(await fs.pathExists(result.backupPath)).toBe(true);

    const written = parse(await fs.readFile(configPath, 'utf-8')) as CodexFixture;
    expect(written.model).toBe('gpt-5');
    expect(written.mcp_servers?.other?.command).toBe('other');
    expect(written.mcp_servers?.archguard?.command).toBe('archguard');
    expect(written.mcp_servers?.archguard?.args).toEqual(['mcp']);
    expect(written.mcp_servers?.archguard?.startup_timeout_sec).toBe(30);
    expect(written.mcp_servers?.archguard?.tool_timeout_sec).toBe(60);

    await adapter.removeMcpServer(context, writeOptions);
    const removed = parse(await fs.readFile(configPath, 'utf-8')) as CodexFixture;
    expect(removed.mcp_servers?.other?.command).toBe('other');
    expect(removed.mcp_servers?.archguard).toBeUndefined();
  });

  it('does not mutate files during dry-run writes', async () => {
    const adapter = new CodexAdapter();
    const configPath = path.join(tmpDir, '.codex', 'config.toml');
    await fs.ensureDir(path.dirname(configPath));
    const before = 'model = "gpt-5"\n';
    await fs.writeFile(configPath, before);

    const result = await adapter.writeMcpServer(context, mcpConfig, {
      ...writeOptions,
      dryRun: true,
    });

    expect(result.changed).toBe(true);
    expect(result.diff).toContain('writeMcpServer');
    expect(await fs.readFile(configPath, 'utf-8')).toBe(before);
  });

  it('does not create backups when creating a new config file', async () => {
    const adapter = new ClaudeCodeAdapter();
    const result = await adapter.writeMcpServer(context, mcpConfig, writeOptions);

    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeUndefined();
    expect(await fs.pathExists(path.join(tmpDir, '.claude', 'mcp.json'))).toBe(true);
  });

  it('writes instructions without changing MCP entries', async () => {
    const adapter = new ClaudeCodeAdapter();
    await adapter.writeMcpServer(context, mcpConfig, writeOptions);
    const instruction: InstructionRenderResult = {
      provider: 'claude',
      content: 'Use ArchGuard.',
      sourceMetadataHash: 'abc123',
      generatedAt: '2026-06-22T00:00:00.000Z',
    };

    await adapter.writeInstructions(context, instruction, writeOptions);
    const written = (await fs.readJson(path.join(tmpDir, '.claude', 'mcp.json'))) as ClaudeFixture;
    expect(written.mcpServers?.archguard?.command).toBe('archguard');
    expect(written.archguardInstructions?.sourceMetadataHash).toBe('abc123');
  });

  it('writes Codex instructions without changing MCP entries', async () => {
    const adapter = new CodexAdapter();
    await adapter.writeMcpServer(context, mcpConfig, writeOptions);
    const instruction: InstructionRenderResult = {
      provider: 'codex',
      content: 'Use ArchGuard.\nPrefer archguard_analyze first.',
      sourceMetadataHash: 'codex123',
      generatedAt: '2026-06-22T00:00:00.000Z',
    };

    await adapter.writeInstructions(context, instruction, writeOptions);
    const written = parse(
      await fs.readFile(path.join(tmpDir, '.codex', 'config.toml'), 'utf-8')
    ) as CodexFixture;
    expect(written.mcp_servers?.archguard?.command).toBe('archguard');
    expect(written.archguard_instructions?.source_metadata_hash).toBe('codex123');
    expect(written.archguard_instructions?.content).toContain('Prefer archguard_analyze first.');
  });
});
