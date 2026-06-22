export { ClaudeCodeAdapter, claudeConfigPath } from './claude.js';
export { CodexAdapter, codexConfigPath } from './codex.js';
import type { AgentProvider } from '../../metadata/index.js';
import type { AgentProviderAdapter, McpServerConfig } from '../types.js';
import { ClaudeCodeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';

export const supportedAgentProviders = ['claude', 'codex'] as const;
export type ProviderSelection = AgentProvider | 'all';

const adapters: Record<AgentProvider, AgentProviderAdapter> = {
  claude: new ClaudeCodeAdapter(),
  codex: new CodexAdapter(),
};

export function getProviderAdapter(provider: AgentProvider): AgentProviderAdapter {
  return adapters[provider];
}

export function resolveProviderSelection(provider: string | undefined): AgentProvider[] {
  const selected = provider ?? 'all';
  if (selected === 'all') return [...supportedAgentProviders];
  if (supportedAgentProviders.includes(selected as AgentProvider)) {
    return [selected as AgentProvider];
  }
  throw new Error(`Unsupported provider: ${selected}. Expected claude, codex, or all.`);
}

export function defaultArchGuardMcpConfig(command = 'archguard'): McpServerConfig {
  return {
    name: 'archguard',
    command,
    args: ['mcp'],
  };
}
