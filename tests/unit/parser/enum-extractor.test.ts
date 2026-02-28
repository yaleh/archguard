/**
 * Unit tests for Enum Extraction - Story 3
 * Testing enum extraction
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EnumExtractor } from '@/parser/enum-extractor';
import { ParseError } from '@/parser/errors';

describe('EnumExtractor', () => {
  let extractor: EnumExtractor;

  beforeEach(() => {
    extractor = new EnumExtractor();
  });

  it('should extract simple enum', () => {
    const code = `
      enum Status {
        Active,
        Inactive,
        Pending
      }
    `;

    const result = extractor.extract(code);

    expect(result).toMatchObject({
      name: 'Status',
      type: 'enum',
      visibility: 'public',
    });
    expect(result.members).toHaveLength(3);
  });

  it('should extract enum with string values', () => {
    const code = `
      enum Color {
        Red = "RED",
        Green = "GREEN",
        Blue = "BLUE"
      }
    `;

    const result = extractor.extract(code);

    expect(result.members).toHaveLength(3);
    expect(result.members[0]).toMatchObject({
      name: 'Red',
      type: 'property',
      defaultValue: '"RED"',
    });
  });

  it('should extract enum with numeric values', () => {
    const code = `
      enum Priority {
        Low = 1,
        Medium = 2,
        High = 3
      }
    `;

    const result = extractor.extract(code);

    expect(result.members[0]?.defaultValue).toBe('1');
    expect(result.members[1]?.defaultValue).toBe('2');
    expect(result.members[2]?.defaultValue).toBe('3');
  });

  it('should handle auto-incremented enum values', () => {
    const code = `
      enum Level {
        Low,
        Medium,
        High
      }
    `;

    const result = extractor.extract(code);

    // Auto-incremented values start from 0
    expect(result.members).toHaveLength(3);
    expect(result.members[0]?.name).toBe('Low');
  });

  it('should handle const enum', () => {
    const code = `
      const enum Direction {
        Up,
        Down,
        Left,
        Right
      }
    `;

    const result = extractor.extract(code);

    expect(result.name).toBe('Direction');
    expect(result.isConst).toBe(true);
  });

  it('should throw error when no enum found', () => {
    const code = 'class User {}';

    expect(() => extractor.extract(code)).toThrow('No enum found');
  });

  it('should extract exported enum', () => {
    const code = `
      export enum Status {
        Active,
        Inactive
      }
    `;

    const result = extractor.extract(code);

    expect(result.visibility).toBe('public');
  });
});

describe('EnumExtractor - Error handling', () => {
  let extractor: EnumExtractor;

  beforeEach(() => {
    extractor = new EnumExtractor();
  });

  it('should throw ParseError when no enum is found', () => {
    expect(() => extractor.extract('const x = 1;', 'src/no-enum.ts')).toThrow(ParseError);
  });

  it('should include the file path in the thrown ParseError', () => {
    try {
      extractor.extract('class Foo {}', 'src/no-enum.ts');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).filePath).toBe('src/no-enum.ts');
    }
  });

  it('should include a descriptive message in the thrown ParseError', () => {
    try {
      extractor.extract('interface Bar {}', 'src/only-interface.ts');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).message).toMatch(/enum/i);
    }
  });
});
