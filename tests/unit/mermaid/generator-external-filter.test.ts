/**
 * Unit tests for ValidatedMermaidGenerator external dependency filtering
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ValidatedMermaidGenerator } from '@/mermaid/generator';
import type { ArchJSON } from '@/types';

describe('ValidatedMermaidGenerator - External Dependency Filtering', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleDebugSpy.mockRestore();
  });

  it('should filter warnings for ts-morph types', () => {
    const archJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      entities: [
        {
          id: 'MyClass',
          name: 'MyClass',
          type: 'class',
          visibility: 'public',
        },
      ],
      relations: [
        {
          id: 'rel1',
          source: 'MyClass',
          target: 'Project', // ts-morph type
          type: 'dependency',
        },
        {
          id: 'rel2',
          source: 'MyClass',
          target: 'ClassDeclaration', // ts-morph type
          type: 'dependency',
        },
      ],
    };

    const generator = new ValidatedMermaidGenerator(archJson, {
      level: 'class',
      grouping: { packages: [] },
    });

    generator.generate();

    // Should not warn about external dependencies
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('should filter warnings for Node.js built-in types', () => {
    const archJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      entities: [
        {
          id: 'MyService',
          name: 'MyService',
          type: 'class',
          visibility: 'public',
        },
      ],
      relations: [
        {
          id: 'rel1',
          source: 'MyService',
          target: 'EventEmitter',
          type: 'dependency',
        },
        {
          id: 'rel2',
          source: 'MyService',
          target: 'ReadStream',
          type: 'dependency',
        },
      ],
    };

    const generator = new ValidatedMermaidGenerator(archJson, {
      level: 'class',
      grouping: { packages: [] },
    });

    generator.generate();

    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('should filter warnings for zod types', () => {
    const archJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      entities: [
        {
          id: 'MyValidator',
          name: 'MyValidator',
          type: 'class',
          visibility: 'public',
        },
      ],
      relations: [
        {
          id: 'rel1',
          source: 'MyValidator',
          target: 'z.infer',
          type: 'dependency',
        },
        {
          id: 'rel2',
          source: 'MyValidator',
          target: 'ZodType',
          type: 'dependency',
        },
      ],
    };

    const generator = new ValidatedMermaidGenerator(archJson, {
      level: 'class',
      grouping: { packages: [] },
    });

    generator.generate();

    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('should show warnings for non-external undefined entities', () => {
    const archJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      entities: [
        {
          id: 'MyClass',
          name: 'MyClass',
          type: 'class',
          visibility: 'public',
        },
      ],
      relations: [
        {
          id: 'rel1',
          source: 'MyClass',
          target: 'MissingClass', // User-defined type that doesn't exist
          type: 'dependency',
        },
      ],
    };

    const generator = new ValidatedMermaidGenerator(archJson, {
      level: 'class',
      grouping: { packages: [] },
    });

    generator.generate();

    // Should warn about missing user-defined class
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Warning: 1 relation(s) reference undefined entities:')
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('MissingClass'));
  });

  it('should show filtered count in verbose mode', () => {
    const archJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      entities: [
        {
          id: 'MyClass',
          name: 'MyClass',
          type: 'class',
          visibility: 'public',
        },
      ],
      relations: [
        {
          id: 'rel1',
          source: 'MyClass',
          target: 'Project',
          type: 'dependency',
        },
        {
          id: 'rel2',
          source: 'MyClass',
          target: 'EventEmitter',
          type: 'dependency',
        },
      ],
    };

    const generator = new ValidatedMermaidGenerator(archJson, {
      level: 'class',
      grouping: { packages: [] },
      verbose: true,
    });

    generator.generate();

    // Should show filtered count in debug
    expect(consoleDebugSpy).toHaveBeenCalledWith(
      expect.stringContaining('Filtered 2 external dependency warning(s)')
    );
  });

  it('should handle mixed external and internal undefined entities', () => {
    const archJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      entities: [
        {
          id: 'MyClass',
          name: 'MyClass',
          type: 'class',
          visibility: 'public',
        },
      ],
      relations: [
        {
          id: 'rel1',
          source: 'MyClass',
          target: 'Project', // External - should be filtered
          type: 'dependency',
        },
        {
          id: 'rel2',
          source: 'MyClass',
          target: 'MissingInternal', // Internal - should warn
          type: 'dependency',
        },
      ],
    };

    const generator = new ValidatedMermaidGenerator(archJson, {
      level: 'class',
      grouping: { packages: [] },
    });

    generator.generate();

    // Should only warn about MissingInternal
    const warnCalls = consoleWarnSpy.mock.calls.flat().join(' ');
    expect(warnCalls).toContain('MissingInternal');
    expect(warnCalls).not.toContain('Project');
  });

  it('should filter generic types', () => {
    const archJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      entities: [
        {
          id: 'MyClass',
          name: 'MyClass',
          type: 'class',
          visibility: 'public',
        },
      ],
      relations: [
        {
          id: 'rel1',
          source: 'MyClass',
          target: 'Map<string, number>',
          type: 'dependency',
        },
        {
          id: 'rel2',
          source: 'MyClass',
          target: 'z.infer<SomeSchema>',
          type: 'dependency',
        },
      ],
    };

    const generator = new ValidatedMermaidGenerator(archJson, {
      level: 'class',
      grouping: { packages: [] },
    });

    generator.generate();

    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});
