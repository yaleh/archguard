import fs from 'fs-extra';
import path from 'path';
import { parse, stringify } from 'smol-toml';
import type { InstructionRenderResult } from '../../metadata/index.js';
import type {
  AgentProviderAdapter,
  ConfigShowResult,
  McpServerConfig,
  ProviderContext,
  ProviderDetection,
  WriteOptions,
  WriteResult,
} from '../types.js';
import {
  commandSignature,
  commandSignatureFromUnknown,
  excerpt,
  mcpServerFromUnknown,
  writeTextFile,
} from './common.js';

interface CodexConfig {
  mcp_servers?: Record<string, Record<string, unknown>>;
  archguard_instructions?: {
    source_metadata_hash: string;
    content: string;
  };
  [key: string]: unknown;
}

export class CodexAdapter implements AgentProviderAdapter {
  id = 'codex' as const;

  async detect(context: ProviderContext): Promise<ProviderDetection> {
    const configPath = codexConfigPath(context);
    return {
      provider: this.id,
      available: await fs.pathExists(configPath),
      configPath,
      instructionsPath: configPath,
      reason: (await fs.pathExists(configPath)) ? undefined : 'Codex config does not exist yet.',
    };
  }

  async readConfig(context: ProviderContext): Promise<CodexConfig> {
    const configPath = codexConfigPath(context);
    if (!(await fs.pathExists(configPath))) return {};
    return parse(await fs.readFile(configPath, 'utf-8')) as CodexConfig;
  }

  async showConfig(context: ProviderContext): Promise<ConfigShowResult> {
    const configPath = codexConfigPath(context);
    const exists = await fs.pathExists(configPath);
    const current = await this.readConfig(context);
    return {
      provider: this.id,
      scope: context.scope,
      configPath,
      instructionsPath: configPath,
      archguardEntry: mcpServerFromUnknown('archguard', current.mcp_servers?.archguard, {
        startup: 'startup_timeout_sec',
        tool: 'tool_timeout_sec',
      }),
      instructionsExcerpt: excerpt(current.archguard_instructions?.content),
      sourceMetadataHash: current.archguard_instructions?.source_metadata_hash,
      exists,
      warnings: [],
    };
  }

  async writeMcpServer(
    context: ProviderContext,
    config: McpServerConfig,
    options: WriteOptions
  ): Promise<WriteResult> {
    const configPath = codexConfigPath(context);
    const current = await this.readConfig(context);
    const previousEntry = current.mcp_servers?.[config.name];
    if (
      previousEntry &&
      !options.force &&
      commandSignatureFromUnknown(previousEntry) !== commandSignature(config)
    ) {
      return {
        changed: false,
        path: configPath,
        warnings: ['Existing ArchGuard MCP entry differs; pass force to overwrite.'],
      };
    }
    const next: CodexConfig = {
      ...current,
      mcp_servers: {
        ...(current.mcp_servers ?? {}),
        [config.name]: toCodexEntry(config),
      },
    };
    return writeTextFile(configPath, stringify(next), options, {
      provider: this.id,
      action: 'writeMcpServer',
      entry: next.mcp_servers?.[config.name],
    });
  }

  async removeMcpServer(context: ProviderContext, options: WriteOptions): Promise<WriteResult> {
    const configPath = codexConfigPath(context);
    if (!(await fs.pathExists(configPath))) {
      return {
        changed: false,
        path: configPath,
        diff: JSON.stringify(
          { provider: this.id, action: 'removeMcpServer', existed: false },
          null,
          2
        ),
        warnings: ['Codex config does not exist.'],
      };
    }
    const current = await this.readConfig(context);
    const next: CodexConfig = {
      ...current,
      mcp_servers: { ...(current.mcp_servers ?? {}) },
    };
    const existed = Boolean(next.mcp_servers?.archguard);
    delete next.mcp_servers?.archguard;
    return writeTextFile(configPath, stringify(next), options, {
      provider: this.id,
      action: 'removeMcpServer',
      existed,
    });
  }

  async writeInstructions(
    context: ProviderContext,
    result: InstructionRenderResult,
    options: WriteOptions
  ): Promise<WriteResult> {
    const configPath = codexConfigPath(context);
    const current = await this.readConfig(context);
    const next: CodexConfig = {
      ...current,
      archguard_instructions: {
        source_metadata_hash: result.sourceMetadataHash,
        content: result.content,
      },
    };
    return writeTextFile(configPath, stringify(next), options, {
      provider: this.id,
      action: 'writeInstructions',
      sourceMetadataHash: result.sourceMetadataHash,
    });
  }
}

export function codexConfigPath(context: ProviderContext): string {
  return context.scope === 'project'
    ? path.join(context.projectRoot, '.codex', 'config.toml')
    : path.join(context.homeDir, '.codex', 'config.toml');
}

function toCodexEntry(config: McpServerConfig): Record<string, unknown> {
  return {
    command: config.command,
    args: config.args,
    ...(config.env ? { env: config.env } : {}),
    ...(config.startupTimeoutSec ? { startup_timeout_sec: config.startupTimeoutSec } : {}),
    ...(config.toolTimeoutSec ? { tool_timeout_sec: config.toolTimeoutSec } : {}),
  };
}
