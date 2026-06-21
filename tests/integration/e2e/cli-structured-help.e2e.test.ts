import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

const builtCliPath = resolve(process.cwd(), 'dist/cli/index.js');
const describeIfBuilt = existsSync(builtCliPath) ? describe : describe.skip;

describeIfBuilt('built CLI structured help', () => {
  it('prints parseable registry-backed help JSON from dist', async () => {
    const { stdout, stderr } = await execa('node', [builtCliPath, 'help', '--json'], {
      cwd: process.cwd(),
    });

    expect(stderr).toBe('');
    const parsed = JSON.parse(stdout);

    expect(parsed.program).toBe('archguard');
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.commands).toHaveLength(7);

    const queryCommand = parsed.commands.find((command: any) => command.name === 'query');
    expect(queryCommand).toBeDefined();
    expect(queryCommand.options.find((option: any) => option.flags === '--summary')).toMatchObject({
      mapsToMcpTool: 'archguard_summary',
    });
  });

  it('keeps Commander human help output readable', async () => {
    const topLevel = await execa('node', [builtCliPath, '--help'], { cwd: process.cwd() });
    const query = await execa('node', [builtCliPath, 'query', '--help'], { cwd: process.cwd() });

    expect(topLevel.stdout).toContain('Usage: archguard [options] [command]');
    expect(topLevel.stdout).toContain('Commands:');
    expect(topLevel.stdout).toContain('help [options]');
    expect(topLevel.stdout).not.toContain('"schemaVersion"');

    expect(query.stdout).toContain('Usage: archguard query [options]');
    expect(query.stdout).toContain('--summary');
    expect(query.stdout).toContain('--query-format <format>');
    expect(query.stdout).not.toContain('"commands"');
  });

  it('keeps help subcommand fallback human-readable without --json', async () => {
    const result = await execa('node', [builtCliPath, 'help'], { cwd: process.cwd() });

    expect(result.stdout).toContain('Usage: archguard [options] [command]');
    expect(result.stdout).toContain('help [options] [command]');
    expect(result.stdout).not.toContain('"schemaVersion"');
    expect(result.stderr).toBe('');
  });

  it('keeps help subcommand fallback human-readable for a target command', async () => {
    const result = await execa('node', [builtCliPath, 'help', 'query'], { cwd: process.cwd() });

    expect(result.stdout).toContain('Usage: archguard query [options]');
    expect(result.stdout).toContain('--summary');
    expect(result.stdout).not.toContain('"commands"');
    expect(result.stderr).toBe('');
  });

  it('fails clearly when structured help is requested with an extra command argument', async () => {
    const result = await execa('node', [builtCliPath, 'help', 'query', '--json'], {
      cwd: process.cwd(),
      reject: false,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('too many arguments for structured help');
    expect(result.stderr).not.toContain('at ');
  });
});
