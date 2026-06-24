import type { AgentProvider, InstructionRenderResult } from '../metadata/index.js';

export type InstallScope = 'user' | 'project';

export interface ProviderContext {
  scope: InstallScope;
  projectRoot: string;
  homeDir: string;
}

export interface ProviderDetection {
  provider: AgentProvider;
  available: boolean;
  configPath: string;
  instructionsPath?: string;
  reason?: string;
}

export interface McpServerConfig {
  name: 'archguard';
  command: string;
  args: string[];
  env?: Record<string, string>;
  startupTimeoutSec?: number;
  toolTimeoutSec?: number;
}

export interface WriteOptions {
  scope: InstallScope;
  dryRun: boolean;
  force: boolean;
  backup: boolean;
}

export interface WriteResult {
  changed: boolean;
  path: string;
  backupPath?: string;
  diff?: string;
  warnings: string[];
}

export interface ConfigShowResult {
  provider: AgentProvider;
  scope: InstallScope;
  configPath: string;
  instructionsPath?: string;
  archguardEntry?: McpServerConfig;
  instructionsExcerpt?: string;
  sourceMetadataHash?: string;
  exists: boolean;
  warnings: string[];
}

export interface AgentProviderAdapter {
  id: AgentProvider;
  detect(context: ProviderContext): Promise<ProviderDetection>;
  readConfig(context: ProviderContext): Promise<unknown>;
  showConfig(context: ProviderContext): Promise<ConfigShowResult>;
  writeMcpServer(
    context: ProviderContext,
    config: McpServerConfig,
    options: WriteOptions
  ): Promise<WriteResult>;
  removeMcpServer(context: ProviderContext, options: WriteOptions): Promise<WriteResult>;
  writeInstructions(
    context: ProviderContext,
    result: InstructionRenderResult,
    options: WriteOptions
  ): Promise<WriteResult>;
}
