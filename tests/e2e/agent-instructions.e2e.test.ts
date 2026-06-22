import { describe, expect, it } from 'vitest';
import { execa } from 'execa';

describe('agent instructions E2E', () => {
  it('prints Codex instructions from the built CLI', async () => {
    const result = await execa('node', ['dist/cli/index.js', 'agent', 'instructions', 'codex']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ArchGuard Instructions for Codex');
    expect(result.stdout).toContain('archguard_analyze');
    expect(result.stdout).toContain('Freshness:');
  });

  it('prints Claude instructions from the built CLI', async () => {
    const result = await execa('node', ['dist/cli/index.js', 'agent', 'instructions', 'claude']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ArchGuard Instructions for Claude Code');
    expect(result.stdout).toContain('archguard_analyze_git');
    expect(result.stdout).toContain('Recovery:');
  });
});
