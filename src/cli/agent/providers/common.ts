import fs from 'fs-extra';
import path from 'path';
import type { McpServerConfig, WriteOptions, WriteResult } from '../types.js';

interface CommandShape {
  command: string;
  args: string[];
}

type StringRecord = Record<string, string>;

export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export async function maybeBackup(
  filePath: string,
  options: WriteOptions
): Promise<string | undefined> {
  if (!options.backup || !(await fs.pathExists(filePath))) return undefined;
  const backupPath = `${filePath}.bak.${timestamp()}`;
  await fs.copy(filePath, backupPath);
  return backupPath;
}

export async function writeTextFile(
  filePath: string,
  nextContent: string,
  options: WriteOptions,
  diff: unknown
): Promise<WriteResult> {
  const previous = (await fs.pathExists(filePath))
    ? await fs.readFile(filePath, 'utf-8')
    : undefined;
  const changed = previous !== nextContent;
  if (options.dryRun || !changed) {
    return {
      changed,
      path: filePath,
      diff: JSON.stringify(diff, null, 2),
      warnings: [],
    };
  }

  const backupPath = await maybeBackup(filePath, options);
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, nextContent);
  return {
    changed,
    path: filePath,
    backupPath,
    diff: JSON.stringify(diff, null, 2),
    warnings: [],
  };
}

export function commandSignature(config: CommandShape): string {
  return JSON.stringify({ command: config.command, args: config.args });
}

export function commandSignatureFromUnknown(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as { command?: unknown; args?: unknown };
  if (typeof record.command !== 'string' || !Array.isArray(record.args)) return undefined;
  if (!record.args.every((arg): arg is string => typeof arg === 'string')) return undefined;
  return commandSignature({ command: record.command, args: record.args });
}

export function stringRecordFromUnknown(value: unknown): StringRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  if (!entries.every((entry): entry is [string, string] => typeof entry[1] === 'string')) {
    return undefined;
  }
  return Object.fromEntries(entries);
}

export function mcpServerFromUnknown(
  name: 'archguard',
  value: unknown,
  timeoutKeys?: { startup: string; tool: string }
): McpServerConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as {
    command?: unknown;
    args?: unknown;
    env?: unknown;
    [key: string]: unknown;
  };
  if (typeof record.command !== 'string') return undefined;
  if (
    !Array.isArray(record.args) ||
    !record.args.every((arg): arg is string => typeof arg === 'string')
  ) {
    return undefined;
  }

  const startupTimeoutSec = timeoutKeys ? record[timeoutKeys.startup] : undefined;
  const toolTimeoutSec = timeoutKeys ? record[timeoutKeys.tool] : undefined;
  return {
    name,
    command: record.command,
    args: record.args,
    ...(record.env ? { env: stringRecordFromUnknown(record.env) } : {}),
    ...(typeof startupTimeoutSec === 'number' ? { startupTimeoutSec } : {}),
    ...(typeof toolTimeoutSec === 'number' ? { toolTimeoutSec } : {}),
  };
}

export function excerpt(value: string | undefined, maxLength = 240): string | undefined {
  if (!value) return undefined;
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
