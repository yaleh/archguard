import { describe, it, expect } from 'vitest';
import { GoModResolver } from '@/plugins/golang/atlas/go-mod-resolver.js';

describe('GoModResolver', () => {
  describe('classifyImport', () => {
    it('should throw if not initialized', () => {
      const resolver = new GoModResolver();
      expect(() => resolver.classifyImport('fmt')).toThrow('not initialized');
    });

    it('should classify standard library imports', async () => {
      const resolver = new GoModResolver();
      // Manually set private field via type assertion for testing
      (resolver as unknown as { moduleInfo: object }).moduleInfo = {
        moduleName: 'github.com/test/project',
        moduleRoot: '/test',
        goModPath: '/test/go.mod',
      };

      expect(resolver.classifyImport('fmt')).toBe('std');
      expect(resolver.classifyImport('net/http')).toBe('std');
      expect(resolver.classifyImport('encoding/json')).toBe('std');
      expect(resolver.classifyImport('sync')).toBe('std');
    });

    it('should classify external imports', async () => {
      const resolver = new GoModResolver();
      (resolver as unknown as { moduleInfo: object }).moduleInfo = {
        moduleName: 'github.com/test/project',
        moduleRoot: '/test',
        goModPath: '/test/go.mod',
      };

      expect(resolver.classifyImport('github.com/gin-gonic/gin')).toBe('external');
      expect(resolver.classifyImport('go.uber.org/zap')).toBe('external');
    });

    it('should classify internal imports', async () => {
      const resolver = new GoModResolver();
      (resolver as unknown as { moduleInfo: object }).moduleInfo = {
        moduleName: 'github.com/test/project',
        moduleRoot: '/test',
        goModPath: '/test/go.mod',
      };

      expect(resolver.classifyImport('github.com/test/project/pkg/hub')).toBe('internal');
      expect(resolver.classifyImport('./utils')).toBe('internal');
    });

    it('should classify vendor imports', async () => {
      const resolver = new GoModResolver();
      (resolver as unknown as { moduleInfo: object }).moduleInfo = {
        moduleName: 'github.com/test/project',
        moduleRoot: '/test',
        goModPath: '/test/go.mod',
      };

      expect(resolver.classifyImport('vendor/github.com/pkg/errors')).toBe('vendor');
    });
  });

  describe('getModuleName', () => {
    it('should return empty string before initialization', () => {
      const resolver = new GoModResolver();
      expect(resolver.getModuleName()).toBe('');
    });
  });
});
