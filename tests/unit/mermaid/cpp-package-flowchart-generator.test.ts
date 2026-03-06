import { describe, it, expect } from 'vitest';
import { CppPackageFlowchartGenerator } from '@/mermaid/cpp-package-flowchart-generator.js';
import type { ArchJSON } from '@/types/index.js';

function makeArchJSON(entities: any[], relations: any[] = []): ArchJSON {
  return {
    version: '1.0', language: 'cpp', timestamp: '',
    sourceFiles: [],
    entities,
    relations,
  };
}

describe('CppPackageFlowchartGenerator', () => {
  const gen = new CppPackageFlowchartGenerator();

  it('generates flowchart header', () => {
    const result = gen.generate(makeArchJSON([]));
    expect(result).toContain('flowchart LR');
  });

  it('generates a node for each entity', () => {
    const archJSON = makeArchJSON([
      { id: 'src', name: 'src', type: 'class', visibility: 'public', members: [], sourceLocation: { file: '', startLine: 1, endLine: 1 } },
      { id: 'ggml', name: 'ggml', type: 'class', visibility: 'public', members: [], sourceLocation: { file: '', startLine: 1, endLine: 1 } },
    ]);
    const result = gen.generate(archJSON);
    expect(result).toContain('src["src"]');
    expect(result).toContain('ggml["ggml"]');
  });

  it('generates an edge for each relation', () => {
    const archJSON = makeArchJSON(
      [
        { id: 'src', name: 'src', type: 'class', visibility: 'public', members: [], sourceLocation: { file: '', startLine: 1, endLine: 1 } },
        { id: 'ggml', name: 'ggml', type: 'class', visibility: 'public', members: [], sourceLocation: { file: '', startLine: 1, endLine: 1 } },
      ],
      [{ id: 'r1', type: 'dependency', source: 'src', target: 'ggml' }]
    );
    const result = gen.generate(archJSON);
    expect(result).toContain('src --> ggml');
  });

  it('sanitizes node IDs with dots and slashes', () => {
    const archJSON = makeArchJSON([
      { id: 'tools/server', name: 'tools/server', type: 'class', visibility: 'public', members: [], sourceLocation: { file: '', startLine: 1, endLine: 1 } },
    ]);
    const result = gen.generate(archJSON);
    expect(result).toContain('tools_server["tools/server"]');
    expect(result).not.toContain('tools/server[');
  });

  it('skips edges where endpoints are not in entity list', () => {
    const archJSON = makeArchJSON(
      [{ id: 'src', name: 'src', type: 'class', visibility: 'public', members: [], sourceLocation: { file: '', startLine: 1, endLine: 1 } }],
      [{ id: 'r1', type: 'dependency', source: 'src', target: 'unknown' }]
    );
    const result = gen.generate(archJSON);
    expect(result).not.toContain('unknown');
  });

  it('handles empty entities with fallback message', () => {
    const result = gen.generate(makeArchJSON([]));
    expect(result).toContain('empty');
  });
});
