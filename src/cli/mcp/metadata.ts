import { getMcpToolMetadata } from '../metadata/index.js';
import type { McpToolMetadata } from '../metadata/index.js';

export function mcpToolDescription(toolName: string): string {
  const metadata = requireMcpToolMetadata(toolName);
  const parts = [metadata.mcp.description];
  const guidanceParts: string[] = [];

  const useWhen = first(metadata.agent.useWhen);
  if (useWhen) {
    guidanceParts.push(`Use when: ${stripTrailingPeriod(useWhen)}`);
  }

  if (metadata.agent.callFirst && metadata.agent.callFirst.length > 0) {
    guidanceParts.push(`Call first: ${metadata.agent.callFirst.join(', ')}`);
  }

  const recovery = first(metadata.agent.failureRecovery);
  if (recovery) {
    guidanceParts.push(`Recovery: ${stripTrailingPeriod(recovery)}`);
  }

  const limitations = metadata.agent.limitations
    .map(stripTrailingPeriod)
    .filter((item) => item.length > 0);
  if (limitations.length > 0) {
    guidanceParts.push(`Limit: ${limitations.join('; ')}`);
  }

  if (guidanceParts.length > 0) {
    parts.push(`${guidanceParts.join('; ')}.`);
  }

  return parts.join(' ');
}

export function mcpParamDescription(toolName: string, parameterName: string): string {
  const metadata = requireMcpToolMetadata(toolName);
  const parameter = metadata.mcp.parameters.find((item) => item.name === parameterName);
  if (!parameter) {
    throw new Error(`Missing MCP metadata parameter ${toolName}.${parameterName}`);
  }
  return parameter.description;
}

function requireMcpToolMetadata(toolName: string): McpToolMetadata {
  const metadata = getMcpToolMetadata(toolName);
  if (!metadata) {
    throw new Error(`Missing MCP metadata for ${toolName}`);
  }
  return metadata;
}

function first(items: string[] | undefined): string | undefined {
  return items?.find((item) => item.trim().length > 0);
}

function stripTrailingPeriod(value: string): string {
  return value.trim().replace(/[.。]+$/, '');
}
