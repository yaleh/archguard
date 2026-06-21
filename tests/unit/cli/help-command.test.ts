import { describe, expect, it, vi, afterEach } from 'vitest';
import { createHelpCommand, createStructuredHelp } from '@/cli/commands/help';
import { createCLI } from '@/cli/index';
import { cliCommandBaseline } from '@/cli/metadata';

describe('structured help command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serializes registry-backed CLI help', () => {
    const help = createStructuredHelp();

    expect(help.program).toBe('archguard');
    expect(help.schemaVersion).toBe(1);
    expect(help.commands.map((command) => command.name)).toEqual([...cliCommandBaseline]);

    const query = help.commands.find((command) => command.name === 'query');
    expect(query).toBeDefined();
    expect(query?.agent.useWhen.length).toBeGreaterThan(0);
    expect(query?.options.find((option) => option.flags === '--summary')?.mapsToMcpTool).toBe(
      'archguard_summary'
    );
  });

  it('prints only JSON for --json', async () => {
    let stdout = '';
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdout += String(chunk);
      return true;
    });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const command = createHelpCommand();
    await command.parseAsync(['node', 'help', '--json']);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).not.toHaveBeenCalled();
    const parsed = JSON.parse(stdout);
    expect(parsed.commands).toHaveLength(7);
    expect(parsed.commands.find((item: any) => item.name === 'query')).toBeDefined();
  });

  it('falls back to human-readable program help without --json', async () => {
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const command = createCLI();
    command.exitOverride();

    await expect(command.parseAsync(['node', 'archguard', 'help'])).rejects.toMatchObject({
      code: 'commander.help',
      exitCode: 0,
    });
    expect(stdout).toContain('Usage: archguard [options] [command]');
    expect(stdout).toContain('help [options] [command]');
    expect(stdout).not.toContain('"schemaVersion"');
  });

  it('falls back to human-readable command help with a command argument', async () => {
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const command = createCLI();
    command.exitOverride();

    await command.parseAsync(['node', 'archguard', 'help', 'query']);
    expect(stdout).toContain('Usage: archguard query [options]');
    expect(stdout).toContain('--summary');
    expect(stdout).not.toContain('"commands"');
  });

  it('fails clearly when a command argument is passed with --json', async () => {
    let stderr = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      stderr += String(chunk);
      return true;
    });

    const command = createHelpCommand();
    command.exitOverride();

    await expect(command.parseAsync(['node', 'help', 'query', '--json'])).rejects.toMatchObject({
      code: 'commander.error',
      exitCode: 1,
    });
    expect(stderr).toContain('too many arguments for structured help');
  });
});
