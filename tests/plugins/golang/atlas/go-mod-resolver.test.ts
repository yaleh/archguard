import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
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

  describe('require parsing', () => {
    it('parses multi-line require block', async () => {
      const resolver = new GoModResolver();
      const goModContent = `module github.com/example/app

go 1.21

require (
  github.com/gin-gonic/gin v1.9.1
  google.golang.org/grpc v1.60.0 // indirect
  github.com/spf13/cobra v1.8.0
)
`;
      // Write a temp go.mod and resolve it
      const tmpDir = path.join(os.tmpdir(), `gomod-test-${Date.now()}`);
      await fs.ensureDir(tmpDir);
      await fs.writeFile(path.join(tmpDir, 'go.mod'), goModContent);
      try {
        const info = await resolver.resolveProject(tmpDir);
        expect(info.requires).toHaveLength(3);
        expect(info.requires[0]).toEqual({ path: 'github.com/gin-gonic/gin', version: 'v1.9.1', indirect: false });
        expect(info.requires[1]).toEqual({ path: 'google.golang.org/grpc', version: 'v1.60.0', indirect: true });
        expect(info.requires[2]).toEqual({ path: 'github.com/spf13/cobra', version: 'v1.8.0', indirect: false });
      } finally {
        await fs.remove(tmpDir);
      }
    });

    it('parses single-line require statement', async () => {
      const resolver = new GoModResolver();
      const goModContent = `module github.com/example/simple

go 1.21

require github.com/pkg/errors v0.9.1
`;
      const tmpDir = path.join(os.tmpdir(), `gomod-test-${Date.now()}`);
      await fs.ensureDir(tmpDir);
      await fs.writeFile(path.join(tmpDir, 'go.mod'), goModContent);
      try {
        const info = await resolver.resolveProject(tmpDir);
        expect(info.requires).toHaveLength(1);
        expect(info.requires[0]).toEqual({ path: 'github.com/pkg/errors', version: 'v0.9.1', indirect: false });
      } finally {
        await fs.remove(tmpDir);
      }
    });

    it('returns empty requires when no require block', async () => {
      const resolver = new GoModResolver();
      const goModContent = `module github.com/example/library

go 1.21
`;
      const tmpDir = path.join(os.tmpdir(), `gomod-test-${Date.now()}`);
      await fs.ensureDir(tmpDir);
      await fs.writeFile(path.join(tmpDir, 'go.mod'), goModContent);
      try {
        const info = await resolver.resolveProject(tmpDir);
        expect(info.requires).toHaveLength(0);
        expect(info.requires).toEqual([]);
      } finally {
        await fs.remove(tmpDir);
      }
    });

    it('getModuleInfo() returns resolved info after resolveProject()', async () => {
      const resolver = new GoModResolver();
      const goModContent = `module github.com/example/app

require (
  github.com/gin-gonic/gin v1.9.1
)
`;
      const tmpDir = path.join(os.tmpdir(), `gomod-test-${Date.now()}`);
      await fs.ensureDir(tmpDir);
      await fs.writeFile(path.join(tmpDir, 'go.mod'), goModContent);
      try {
        await resolver.resolveProject(tmpDir);
        const info = resolver.getModuleInfo();
        expect(info.moduleName).toBe('github.com/example/app');
        expect(info.requires).toHaveLength(1);
      } finally {
        await fs.remove(tmpDir);
      }
    });

    it('getModuleInfo() throws when not initialized', () => {
      const resolver = new GoModResolver();
      expect(() => resolver.getModuleInfo()).toThrow('not initialized');
    });
  });
});
