import { describe, expect, it } from 'vitest';
import type { ArchGuardConfig } from '@/types/config.js';
import {
  PROJECT_SEMANTICS_VERSION,
  ProjectSemanticsSchema,
  mergeProjectSemantics,
  sanitizeProjectSemantics,
  type ProjectSemantics,
} from '@/types/extensions/project-semantics.js';

function makeSemantics(overrides: Partial<ProjectSemantics> = {}): ProjectSemantics {
  return {
    version: PROJECT_SEMANTICS_VERSION,
    nonProductionPatterns: ['playground'],
    barrelFiles: ['src/index.ts'],
    additionalTestPatterns: ['**/*.integration.ts'],
    customAssertionPatterns: ['\\\\bverify\\\\s*\\\\('],
    confidence: 0.9,
    ...overrides,
  };
}

describe('ProjectSemanticsSchema', () => {
  it('accepts a valid ProjectSemantics object', () => {
    const semantics = makeSemantics();
    expect(ProjectSemanticsSchema.parse(semantics)).toEqual(semantics);
  });

  it('rejects missing version', () => {
    const semantics = { ...makeSemantics() };
    delete (semantics as Partial<ProjectSemantics>).version;

    expect(() => ProjectSemanticsSchema.parse(semantics)).toThrow();
  });

  it('rejects confidence as a string', () => {
    expect(() =>
      ProjectSemanticsSchema.parse({
        ...makeSemantics(),
        confidence: '0.8',
      })
    ).toThrow();
  });

  it('rejects confidence greater than 1', () => {
    expect(() =>
      ProjectSemanticsSchema.parse({
        ...makeSemantics(),
        confidence: 1.1,
      })
    ).toThrow();
  });
});

describe('sanitizeProjectSemantics', () => {
  it('strips path traversal entries', () => {
    const sanitized = sanitizeProjectSemantics(
      makeSemantics({
        nonProductionPatterns: ['playground', '../etc'],
      })
    );

    expect(sanitized.nonProductionPatterns).toEqual(['playground']);
  });

  it('strips absolute paths', () => {
    const sanitized = sanitizeProjectSemantics(
      makeSemantics({
        barrelFiles: ['src/index.ts', '/home/user/project/src/index.ts'],
      })
    );

    expect(sanitized.barrelFiles).toEqual(['src/index.ts']);
  });

  it('strips entries containing null bytes', () => {
    const sanitized = sanitizeProjectSemantics(
      makeSemantics({
        additionalTestPatterns: ['**/*.integration.ts', 'bad\u0000pattern'],
      })
    );

    expect(sanitized.additionalTestPatterns).toEqual(['**/*.integration.ts']);
  });

  it('preserves valid entries', () => {
    const semantics = makeSemantics({
      architecturalLayers: { 'src/domain': 'domain' },
      suggestedDepth: 2,
    });

    expect(sanitizeProjectSemantics(semantics)).toEqual(semantics);
  });
});

describe('mergeProjectSemantics', () => {
  it('unions array fields across user and llm inputs', () => {
    const merged = mergeProjectSemantics(
      {
        nonProductionPatterns: ['demo'],
        additionalTestPatterns: ['**/*.e2e.ts'],
      },
      {
        nonProductionPatterns: ['playground'],
        additionalTestPatterns: ['**/*.integration.ts'],
      }
    );

    expect(merged.nonProductionPatterns).toEqual(['playground', 'demo']);
    expect(merged.additionalTestPatterns).toEqual(['**/*.integration.ts', '**/*.e2e.ts']);
  });

  it('supports ! exclusions for array fields', () => {
    const merged = mergeProjectSemantics(
      {
        nonProductionPatterns: ['!playground'],
      },
      {
        nonProductionPatterns: ['playground', 'demo'],
      }
    );

    expect(merged.nonProductionPatterns).toEqual(['demo']);
  });

  it('prefers user scalar fields over llm values', () => {
    const merged = mergeProjectSemantics(
      {
        confidence: 0.95,
        suggestedDepth: 3,
      },
      {
        confidence: 0.6,
        suggestedDepth: 2,
      }
    );

    expect(merged.confidence).toBe(0.95);
    expect(merged.suggestedDepth).toBe(3);
  });

  it('merges architecturalLayers with user entries overriding llm entries', () => {
    const merged = mergeProjectSemantics(
      {
        architecturalLayers: {
          'src/domain': 'core-domain',
        },
      },
      {
        architecturalLayers: {
          'src/domain': 'domain',
          'src/infra': 'infrastructure',
        },
      }
    );

    expect(merged.architecturalLayers).toEqual({
      'src/domain': 'core-domain',
      'src/infra': 'infrastructure',
    });
  });
});

describe('ProjectSemantics config typing', () => {
  it('allows ArchGuardConfig to include partial projectSemantics', () => {
    const config: ArchGuardConfig = {
      diagrams: [],
      outputDir: './archguard',
      format: 'mermaid',
      exclude: [],
      cli: {
        command: 'claude',
        args: [],
        timeout: 60000,
      },
      cache: {
        enabled: true,
        ttl: 86400,
      },
      concurrency: 8,
      verbose: false,
      projectSemantics: {
        nonProductionPatterns: ['playground'],
      },
    };

    expect(config.projectSemantics?.nonProductionPatterns).toEqual(['playground']);
  });
});
