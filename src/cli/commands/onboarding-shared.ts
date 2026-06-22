import path from 'path';
import type { AgentProvider, InstructionRenderInput } from '../metadata/index.js';
import { renderAgentInstructions } from '../metadata/index.js';
import {
  defaultArchGuardMcpConfig,
  getProviderAdapter,
  resolveProviderSelection,
} from '../agent/providers/index.js';
import type {
  ConfigShowResult,
  InstallScope,
  ProviderContext,
  WriteOptions,
  WriteResult,
} from '../agent/types.js';

export interface OnboardingOptions {
  scope?: string;
  home?: string;
  projectRoot?: string;
  dryRun?: boolean;
  force?: boolean;
  mcpOnly?: boolean;
  instructionsOnly?: boolean;
  json?: boolean;
  probe?: boolean;
}

export interface ProviderOperationResult {
  provider: AgentProvider;
  mcp?: WriteResult;
  instructions?: WriteResult;
  show?: ConfigShowResult;
  warnings: string[];
}

export function parseScope(value: string | undefined): InstallScope {
  const scope = value ?? 'user';
  if (scope !== 'user' && scope !== 'project') {
    throw new Error(`Unsupported scope: ${scope}. Expected user or project.`);
  }
  return scope;
}

export function createProviderContext(options: OnboardingOptions): ProviderContext {
  return {
    scope: parseScope(options.scope),
    homeDir: path.resolve(options.home ?? process.env.HOME ?? process.cwd()),
    projectRoot: path.resolve(options.projectRoot ?? process.cwd()),
  };
}

export function createWriteOptions(options: OnboardingOptions): WriteOptions {
  const scope = parseScope(options.scope);
  return {
    scope,
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
    backup: true,
  };
}

export function parseOperationMode(options: OnboardingOptions): {
  writeMcp: boolean;
  writeInstructions: boolean;
} {
  if (options.mcpOnly && options.instructionsOnly) {
    throw new Error('Use only one of --mcp-only or --instructions-only.');
  }
  return {
    writeMcp: !options.instructionsOnly,
    writeInstructions: !options.mcpOnly,
  };
}

export async function installProvider(
  provider: AgentProvider,
  options: OnboardingOptions
): Promise<ProviderOperationResult> {
  const adapter = getProviderAdapter(provider);
  const context = createProviderContext(options);
  const writeOptions = createWriteOptions(options);
  const mode = parseOperationMode(options);
  const result: ProviderOperationResult = { provider, warnings: [] };

  if (mode.writeMcp) {
    result.mcp = await adapter.writeMcpServer(context, defaultArchGuardMcpConfig(), writeOptions);
  }
  if (mode.writeInstructions) {
    result.instructions = await adapter.writeInstructions(
      context,
      renderAgentInstructions(undefined, instructionInput(provider)),
      writeOptions
    );
  }
  result.warnings = [...(result.mcp?.warnings ?? []), ...(result.instructions?.warnings ?? [])];
  return result;
}

export async function updateProvider(
  provider: AgentProvider,
  options: OnboardingOptions
): Promise<ProviderOperationResult> {
  return installProvider(provider, { ...options, force: true });
}

export async function showProviderConfig(
  provider: AgentProvider,
  options: OnboardingOptions
): Promise<ProviderOperationResult> {
  const adapter = getProviderAdapter(provider);
  const context = createProviderContext(options);
  const show = await adapter.showConfig(context);
  return { provider, show, warnings: show.warnings };
}

export async function removeProviderConfig(
  provider: AgentProvider,
  options: OnboardingOptions
): Promise<ProviderOperationResult> {
  const adapter = getProviderAdapter(provider);
  const context = createProviderContext(options);
  const result = await adapter.removeMcpServer(context, createWriteOptions(options));
  return { provider, mcp: result, warnings: result.warnings };
}

export function selectedProviders(provider: string | undefined): AgentProvider[] {
  return resolveProviderSelection(provider);
}

export function outputResults(results: ProviderOperationResult[], json: boolean | undefined): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return;
  }

  for (const result of results) {
    process.stdout.write(`${result.provider}:\n`);
    if (result.show) {
      process.stdout.write(`  config: ${result.show.configPath}\n`);
      process.stdout.write(`  exists: ${String(result.show.exists)}\n`);
      process.stdout.write(`  archguard: ${result.show.archguardEntry ? 'present' : 'missing'}\n`);
      if (result.show.sourceMetadataHash) {
        process.stdout.write(`  instructions: ${result.show.sourceMetadataHash}\n`);
      }
    }
    if (result.mcp) {
      process.stdout.write(
        `  mcp: ${result.mcp.changed ? 'changed' : 'unchanged'} ${result.mcp.path}\n`
      );
      if (result.mcp.backupPath) process.stdout.write(`  backup: ${result.mcp.backupPath}\n`);
    }
    if (result.instructions) {
      process.stdout.write(
        `  instructions: ${result.instructions.changed ? 'changed' : 'unchanged'} ${result.instructions.path}\n`
      );
    }
    for (const warning of result.warnings) {
      process.stdout.write(`  warning: ${warning}\n`);
    }
  }
}

function instructionInput(provider: AgentProvider): InstructionRenderInput {
  return { provider, format: 'markdown' };
}
