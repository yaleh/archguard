import type { ArchGuardMetadataEntry, ArchGuardMetadataRegistry } from './types.js';
import {
  archGuardMetadataRegistry,
  cliCommandBaseline,
  mcpToolBaseline,
  workflowDependentMcpTools,
} from './registry.js';

export interface RegistryValidationOptions {
  expectedCliCommands?: readonly string[];
  expectedMcpTools?: readonly string[];
  expectedWorkflowDependentTools?: readonly string[];
}

export function validateMetadataRegistry(
  registry: ArchGuardMetadataRegistry = archGuardMetadataRegistry,
  options: RegistryValidationOptions = {}
): string[] {
  const errors: string[] = [];
  const expectedCliCommands = options.expectedCliCommands ?? cliCommandBaseline;
  const expectedMcpTools = options.expectedMcpTools ?? mcpToolBaseline;
  const expectedWorkflowDependentTools =
    options.expectedWorkflowDependentTools ?? workflowDependentMcpTools;

  const cliIds = registry.cliCommands.map((command) => command.cli.command);
  const toolNames = registry.mcpTools.map((tool) => tool.mcp.toolName);
  const allEntryIds = [
    ...registry.cliCommands.map((command) => command.id),
    ...registry.mcpTools.map((tool) => tool.id),
  ];

  collectSetErrors(errors, 'CLI command', expectedCliCommands, cliIds);
  collectSetErrors(errors, 'MCP tool', expectedMcpTools, toolNames);
  collectDuplicateErrors(errors, 'metadata id', allEntryIds);
  collectDuplicateErrors(errors, 'CLI command', cliIds);
  collectDuplicateErrors(errors, 'MCP tool', toolNames);

  for (const entry of [...registry.cliCommands, ...registry.mcpTools]) {
    collectEntryCompletenessErrors(errors, entry);
  }

  for (const tool of registry.mcpTools) {
    if (tool.id !== tool.mcp.toolName) {
      errors.push(`MCP tool entry id must match toolName: ${tool.id}`);
    }
    for (const target of tool.agent.callFirst ?? []) {
      if (!toolNames.includes(target) && !cliIds.includes(stripArchguardPrefix(target))) {
        errors.push(`${tool.mcp.toolName} callFirst references unknown target: ${target}`);
      }
    }
  }

  for (const toolName of expectedWorkflowDependentTools) {
    const tool = registry.mcpTools.find((entry) => entry.mcp.toolName === toolName);
    if (!tool) continue;
    if (!tool.agent.callFirst || tool.agent.callFirst.length === 0) {
      errors.push(`${toolName} is workflow-dependent but has no callFirst guidance`);
    }
  }

  for (const mapping of registry.queryMappings) {
    if (!toolNames.includes(mapping.mcpTool)) {
      errors.push(`Query mapping references unknown MCP tool: ${mapping.mcpTool}`);
    }
    if (!mapping.cliEquivalent.startsWith('archguard ')) {
      errors.push(`Query mapping must use an archguard CLI equivalent: ${mapping.mcpTool}`);
    }
  }

  const analyzeGitMapping = registry.queryMappings.find(
    (mapping) => mapping.mcpTool === 'archguard_analyze_git'
  );
  if (analyzeGitMapping?.cliEquivalent !== 'archguard analyze --include-git') {
    errors.push('archguard_analyze_git must map to archguard analyze --include-git');
  }

  return errors;
}

export function assertValidMetadataRegistry(
  registry: ArchGuardMetadataRegistry = archGuardMetadataRegistry,
  options: RegistryValidationOptions = {}
): void {
  const errors = validateMetadataRegistry(registry, options);
  if (errors.length > 0) {
    throw new Error(`Invalid ArchGuard metadata registry:\n${errors.join('\n')}`);
  }
}

export function getCliCommandMetadata(command: string) {
  return archGuardMetadataRegistry.cliCommands.find((entry) => entry.cli.command === command);
}

export function getMcpToolMetadata(toolName: string) {
  return archGuardMetadataRegistry.mcpTools.find((entry) => entry.mcp.toolName === toolName);
}

function collectSetErrors(
  errors: string[],
  label: string,
  expected: readonly string[],
  actual: readonly string[]
): void {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  for (const item of expectedSet) {
    if (!actualSet.has(item)) errors.push(`Missing ${label}: ${item}`);
  }
  for (const item of actualSet) {
    if (!expectedSet.has(item)) errors.push(`Unexpected ${label}: ${item}`);
  }
}

function collectDuplicateErrors(errors: string[], label: string, values: readonly string[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  for (const duplicate of duplicates) {
    errors.push(`Duplicate ${label}: ${duplicate}`);
  }
}

function collectEntryCompletenessErrors(errors: string[], entry: ArchGuardMetadataEntry): void {
  if (!entry.summary.trim()) errors.push(`${entry.id} is missing summary`);
  if (entry.agent.useWhen.length === 0) errors.push(`${entry.id} is missing agent.useWhen`);
  if (entry.agent.failureRecovery.length === 0) {
    errors.push(`${entry.id} is missing agent.failureRecovery`);
  }
  if (entry.agent.limitations.length === 0) errors.push(`${entry.id} is missing agent.limitations`);
  if (entry.examples.length === 0) errors.push(`${entry.id} is missing examples`);
  if (entry.verification.length === 0) errors.push(`${entry.id} is missing verification hints`);
  for (const hint of entry.verification) {
    if (!isRealVerificationTarget(hint.target)) {
      errors.push(`${entry.id} verification target is not concrete: ${hint.target}`);
    }
  }
}

function isRealVerificationTarget(target: string): boolean {
  return (
    target.startsWith('npm ') ||
    target.startsWith('node ') ||
    target.startsWith('archguard ') ||
    target.startsWith('tests/')
  );
}

function stripArchguardPrefix(target: string): string {
  return target.startsWith('archguard ') ? target.slice('archguard '.length).split(' ')[0] : target;
}
