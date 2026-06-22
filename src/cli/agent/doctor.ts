import fs from 'fs-extra';
import { mcpToolBaseline } from '../metadata/index.js';
import { getProviderAdapter, resolveProviderSelection } from './providers/index.js';
import type { AgentProvider } from '../metadata/index.js';
import type { InstallScope, ProviderContext } from './types.js';
import { probeMcpListTools } from './mcp-probe.js';
import type { McpProbeOptions } from './mcp-probe.js';

export interface DoctorResult {
  ok: boolean;
  provider?: AgentProvider;
  checks: DoctorCheck[];
  recovery: string[];
}

export interface DoctorCheck {
  id: string;
  status: 'pass' | 'warn' | 'fail' | 'skipped';
  message: string;
  path?: string;
  recovery?: string;
}

export interface DoctorOptions {
  provider?: string;
  scope: InstallScope;
  homeDir: string;
  projectRoot: string;
  probe?: boolean;
  probeOptions?: McpProbeOptions;
}

export async function runConfigDoctor(options: DoctorOptions): Promise<DoctorResult> {
  const providers = resolveProviderSelection(options.provider);
  const checks: DoctorCheck[] = [];
  for (const provider of providers) {
    checks.push(...(await checkProvider(provider, options)));
  }

  if (options.probe !== false) {
    checks.push(await checkMcpProbe(options.probeOptions));
  }

  const recovery = checks.flatMap((check) =>
    check.recovery && check.status !== 'pass' ? [check.recovery] : []
  );
  return {
    ok: checks.every((check) => check.status === 'pass' || check.status === 'warn'),
    ...(providers.length === 1 ? { provider: providers[0] } : {}),
    checks,
    recovery: [...new Set(recovery)],
  };
}

async function checkProvider(
  provider: AgentProvider,
  options: DoctorOptions
): Promise<DoctorCheck[]> {
  const adapter = getProviderAdapter(provider);
  const context: ProviderContext = {
    scope: options.scope,
    homeDir: options.homeDir,
    projectRoot: options.projectRoot,
  };
  const show = await adapter.showConfig(context);
  const checks: DoctorCheck[] = [];
  checks.push({
    id: `${provider}.config.exists`,
    status: show.exists ? 'pass' : 'fail',
    message: show.exists
      ? `${provider} config exists.`
      : `${provider} config does not exist at ${show.configPath}.`,
    path: show.configPath,
    recovery: show.exists
      ? undefined
      : `Run archguard install ${provider} --scope ${options.scope} before doctor.`,
  });
  checks.push({
    id: `${provider}.config.archguard-entry`,
    status: show.archguardEntry ? 'pass' : 'fail',
    message: show.archguardEntry
      ? `${provider} ArchGuard MCP entry is present.`
      : `${provider} ArchGuard MCP entry is missing.`,
    path: show.configPath,
    recovery: show.archguardEntry
      ? undefined
      : `Run archguard install ${provider} --scope ${options.scope} to add the ArchGuard MCP entry.`,
  });
  checks.push({
    id: `${provider}.instructions`,
    status: show.sourceMetadataHash ? 'pass' : 'warn',
    message: show.sourceMetadataHash
      ? `${provider} generated instructions are present.`
      : `${provider} generated instructions are missing.`,
    path: show.instructionsPath,
    recovery: show.sourceMetadataHash
      ? undefined
      : `Run archguard update ${provider} --instructions-only --scope ${options.scope}.`,
  });
  if (show.archguardEntry) {
    const command = show.archguardEntry.command;
    const commandLooksRunnable = command === 'archguard' || (await fs.pathExists(command));
    checks.push({
      id: `${provider}.command.exists`,
      status: commandLooksRunnable ? 'pass' : 'fail',
      message: commandLooksRunnable
        ? `${provider} ArchGuard command is runnable or resolved by PATH.`
        : `${provider} ArchGuard command does not exist: ${command}.`,
      path: command,
      recovery: commandLooksRunnable
        ? undefined
        : `Update ${show.configPath} so the archguard MCP command points at a real executable.`,
    });
  } else {
    checks.push({
      id: `${provider}.command.exists`,
      status: 'skipped',
      message: `${provider} command check skipped because ArchGuard entry is missing.`,
      recovery: `Run archguard install ${provider} --scope ${options.scope}.`,
    });
  }
  return checks;
}

async function checkMcpProbe(probeOptions: McpProbeOptions | undefined): Promise<DoctorCheck> {
  const result = await probeMcpListTools(probeOptions);
  if (!result.ok) {
    return {
      id: 'mcp.stdio.list-tools',
      status: 'fail',
      message: `Failed to list tools from independent ArchGuard MCP process: ${result.error ?? 'unknown error'}`,
      recovery: 'Run npm run build and retry archguard config doctor.',
    };
  }
  const missing = mcpToolBaseline.filter((toolName) => !result.toolNames.includes(toolName));
  if (missing.length > 0) {
    return {
      id: 'mcp.stdio.list-tools',
      status: 'fail',
      message: `Independent MCP process is missing tools: ${missing.join(', ')}`,
      recovery: 'Rebuild ArchGuard and rerun metadata surface tests.',
    };
  }
  return {
    id: 'mcp.stdio.list-tools',
    status: result.teardownMs <= 500 ? 'pass' : 'warn',
    message: `Independent MCP process listed ${result.toolNames.length} tools; teardown took ${result.teardownMs}ms.`,
    recovery:
      result.teardownMs <= 500
        ? undefined
        : 'Inspect MCP stdio process teardown if this warning repeats in CI.',
  };
}
