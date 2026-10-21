/**
 * resolveFormats — the single normalization point for output-format selection.
 *
 * Precedence is OVERRIDE (not union): CLI/MCP > per-diagram > global > default.
 * Within the winning source order is preserved and duplicates are dropped.
 */

import { describe, it, expect } from 'vitest';
import { resolveFormats, DEFAULT_FORMATS } from '@/cli/utils/format-selection.js';

describe('resolveFormats', () => {
  it('defaults to mermaid when nothing is selected', () => {
    expect(resolveFormats()).toEqual(['mermaid']);
    expect(resolveFormats({})).toEqual(['mermaid']);
    expect(resolveFormats({ cli: [], diagram: [], global: [] })).toEqual(['mermaid']);
  });

  it('returns the global selection when it is the only source', () => {
    expect(resolveFormats({ global: ['json', 'plantuml'] })).toEqual(['json', 'plantuml']);
  });

  it('per-diagram selection overrides the global selection (override, not union)', () => {
    expect(resolveFormats({ diagram: ['json'], global: ['mermaid', 'plantuml'] })).toEqual([
      'json',
    ]);
  });

  it('CLI/MCP selection overrides both per-diagram and global', () => {
    expect(resolveFormats({ cli: ['plantuml'], diagram: ['json'], global: ['mermaid'] })).toEqual([
      'plantuml',
    ]);
  });

  it('treats an empty stronger source as "not selected" and falls through', () => {
    expect(resolveFormats({ cli: [], diagram: [], global: ['json'] })).toEqual(['json']);
    expect(resolveFormats({ cli: [], diagram: ['plantuml'], global: ['json'] })).toEqual([
      'plantuml',
    ]);
  });

  it('de-duplicates while preserving first-seen order', () => {
    expect(resolveFormats({ global: ['mermaid', 'json', 'mermaid', 'plantuml', 'json'] })).toEqual([
      'mermaid',
      'json',
      'plantuml',
    ]);
  });

  it('never returns the caller-provided array by reference', () => {
    const selected = ['json'];
    const resolved = resolveFormats({ global: selected });
    resolved.push('mermaid');
    expect(selected).toEqual(['json']);
  });

  it('exposes mermaid as the documented default', () => {
    expect(DEFAULT_FORMATS).toEqual(['mermaid']);
  });
});
