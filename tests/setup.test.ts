import { describe, it, expect } from 'vitest';

/**
 * Smoke tests to validate the project setup
 */
describe('Project Setup', () => {
  describe('Environment', () => {
    it('should have Node.js version >= 18', () => {
      const version = process.version;
      const major = parseInt(version.slice(1).split('.')[0] ?? '0', 10);
      expect(major).toBeGreaterThanOrEqual(18);
    });

    it('should be running in test environment', () => {
      expect(process.env.NODE_ENV).toMatch(/test|undefined/);
    });
  });

  describe('TypeScript Configuration', () => {
    it('should import from main entry point', async () => {
      const module = await import('../src/index');
      expect(module).toBeDefined();
    });

    it('should import types module', async () => {
      const typesModule = await import('../src/types');
      expect(typesModule).toBeDefined();
    });
  });

  describe('Module Placeholders', () => {
    it('should export parser version', async () => {
      const { parserVersion } = await import('../src/parser');
      expect(parserVersion).toBe('0.1.0');
    });

    it('should export utils version', async () => {
      const { utilsVersion } = await import('../src/utils');
      expect(utilsVersion).toBe('0.1.0');
    });
  });

  describe('Basic TypeScript Features', () => {
    it('should support async/await', async () => {
      const asyncFunction = async (): Promise<string> => {
        await Promise.resolve();
        return 'test';
      };
      const result = await asyncFunction();
      expect(result).toBe('test');
    });

    it('should support arrow functions', () => {
      const add = (a: number, b: number): number => a + b;
      expect(add(2, 3)).toBe(5);
    });

    it('should support destructuring', () => {
      const obj = { a: 1, b: 2 };
      const { a, b } = obj;
      expect(a).toBe(1);
      expect(b).toBe(2);
    });
  });
});
