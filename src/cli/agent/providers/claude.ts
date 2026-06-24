import fs from 'fs-extra';
import path from 'path';
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

interface ClaudeConfig {
  mcpServers?: Record<string, unknown>;
  archguardInstructions?: {
    sourceMetadataHash: string;
    content: string;
  };
  [key: string]: unknown;
}

export class ClaudeCodeAdapter implements AgentProviderAdapter {
  id = 'claude' as const;

  async detect(context: ProviderContext): Promise<ProviderDetection> {
    const configPath = claudeConfigPath(context);
    return {
      provider: this.id,
      available: await fs.pathExists(configPath),
      configPath,
      instructionsPath: configPath,
      reason: (await fs.pathExists(configPath))
        ? undefined
        : 'Claude Code MCP config does not exist yet.',
    };
  }

  async readConfig(context: ProviderContext): Promise<ClaudeConfig> {
    const configPath = claudeConfigPath(context);
    if (!(await fs.pathExists(configPath))) return {};
    return (await fs.readJson(configPath)) as ClaudeConfig;
  }

  async showConfig(context: ProviderContext): Promise<ConfigShowResult> {
    const configPath = claudeConfigPath(context);
    const exists = await fs.pathExists(configPath);
    const current = await this.readConfig(context);
    return {
      provider: this.id,
      scope: context.scope,
      configPath,
      instructionsPath: configPath,
      archguardEntry: mcpServerFromUnknown('archguard', current.mcpServers?.archguard),
      instructionsExcerpt: excerpt(current.archguardInstructions?.content),
      sourceMetadataHash: current.archguardInstructions?.sourceMetadataHash,
      exists,
      warnings: [],
    };
  }

  async writeMcpServer(
    context: ProviderContext,
    config: McpServerConfig,
    options: WriteOptions
  ): Promise<WriteResult> {
    const configPath = claudeConfigPath(context);
    const current = await this.readConfig(context);
    const previousEntry = current.mcpServers?.[config.name];
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
    const next: ClaudeConfig = {
      ...current,
      mcpServers: {
        ...(current.mcpServers ?? {}),
        [config.name]: toClaudeEntry(config),
      },
    };
    return writeTextFile(configPath, `${JSON.stringify(next, null, 2)}\n`, options, {
      provider: this.id,
      action: 'writeMcpServer',
      entry: next.mcpServers?.[config.name],
    });
  }

  async removeMcpServer(context: ProviderContext, options: WriteOptions): Promise<WriteResult> {
    const configPath = claudeConfigPath(context);
    if (!(await fs.pathExists(configPath))) {
      return {
        changed: false,
        path: configPath,
        diff: JSON.stringify(
          { provider: this.id, action: 'removeMcpServer', existed: false },
          null,
          2
        ),
        warnings: ['Claude Code MCP config does not exist.'],
      };
    }
    const current = await this.readConfig(context);
    const next: ClaudeConfig = {
      ...current,
      mcpServers: { ...(current.mcpServers ?? {}) },
    };
    const existed = Boolean(next.mcpServers?.archguard);
    delete next.mcpServers?.archguard;
    return writeTextFile(configPath, `${JSON.stringify(next, null, 2)}\n`, options, {
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
    const configPath = claudeConfigPath(context);
    const current = await this.readConfig(context);
    const next: ClaudeConfig = {
      ...current,
      archguardInstructions: {
        sourceMetadataHash: result.sourceMetadataHash,
        content: result.content,
      },
    };
    return writeTextFile(configPath, `${JSON.stringify(next, null, 2)}\n`, options, {
      provider: this.id,
      action: 'writeInstructions',
      sourceMetadataHash: result.sourceMetadataHash,
    });
  }
}

export function claudeConfigPath(context: ProviderContext): string {
  return context.scope === 'project'
    ? path.join(context.projectRoot, '.mcp.json')
    : path.join(context.homeDir, '.claude', 'mcp.json');
}

function toClaudeEntry(config: McpServerConfig): Record<string, unknown> {
  return {
    command: config.command,
    args: config.args,
    ...(config.env ? { env: config.env } : {}),
  };
}
