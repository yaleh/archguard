import { describe, expect, it } from 'vitest';
import {
  archGuardMetadataRegistry,
  renderAgentInstructions,
  renderMetadataDocsBlock,
} from '@/cli/metadata';

describe('agent instruction renderer', () => {
  it('renders Codex instructions from registry guidance', () => {
    const result = renderAgentInstructions(archGuardMetadataRegistry, {
      provider: 'codex',
      format: 'markdown',
    });

    expect(result.provider).toBe('codex');
    expect(result.content).toContain('ArchGuard Instructions for Codex');
    expect(result.content).toContain('archguard_analyze');
    expect(result.content).toContain('archguard_detect_test_patterns');
    expect(result.content).toContain('archguard_analyze_git');
    expect(result.content).toContain('Go Atlas');
    expect(result.content).toContain('Freshness:');
    expect(result.content).toContain('Recovery:');
    expect(result.sourceMetadataHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('renders Claude instructions with provider-specific setup', () => {
    const result = renderAgentInstructions(archGuardMetadataRegistry, {
      provider: 'claude',
      format: 'text',
    });

    expect(result.provider).toBe('claude');
    expect(result.content).toContain('ArchGuard Instructions for Claude Code');
    expect(result.content).toContain('~/.claude/mcp.json');
    expect(result.content).toContain('archguard_get_test_metrics');
  });

  it('keeps sourceMetadataHash deterministic for unchanged metadata', () => {
    const first = renderAgentInstructions(archGuardMetadataRegistry, {
      provider: 'codex',
      format: 'markdown',
    });
    const second = renderAgentInstructions(archGuardMetadataRegistry, {
      provider: 'codex',
      format: 'markdown',
    });

    expect(first.sourceMetadataHash).toBe(second.sourceMetadataHash);
    expect(first.content).toBe(second.content);
  });

  it('uses the instruction renderer for the agent surface docs block', () => {
    const rendered = renderMetadataDocsBlock('agent-surface', archGuardMetadataRegistry);

    expect(rendered).toContain('# ArchGuard Agent Surface');
    expect(rendered).toContain('# ArchGuard Instructions for Codex');
    expect(rendered).toContain('Source metadata hash:');
  });
});
