import { describe, it, expect } from 'vitest';
import { ImportResolver } from '@/plugins/kotlin/builders/import-resolver.js';

describe('ImportResolver', () => {
  const resolver = new ImportResolver();

  describe('isInternal', () => {
    it('returns true for package within moduleRoot', () => {
      expect(resolver.isInternal('com.example.app.data.UserRepository', 'com.example.app')).toBe(
        true
      );
    });

    it('returns false for external package', () => {
      expect(resolver.isInternal('android.os.Bundle', 'com.example.app')).toBe(false);
    });

    it('returns false for same prefix but different package', () => {
      expect(resolver.isInternal('com.example.other.Foo', 'com.example.app')).toBe(false);
    });

    it('returns true for deeply nested internal path', () => {
      expect(
        resolver.isInternal('com.example.app.feature.projects.ProjectRepository', 'com.example.app')
      ).toBe(true);
    });

    it('returns false for moduleRoot itself (no trailing dot match)', () => {
      // 'com.example.app' does NOT start with 'com.example.app.'
      expect(resolver.isInternal('com.example.app', 'com.example.app')).toBe(false);
    });

    it('does not match a package that starts with moduleRoot but has no dot separator', () => {
      // 'com.example.apptools.Foo' starts with 'com.example.app' but NOT 'com.example.app.'
      expect(resolver.isInternal('com.example.apptools.Foo', 'com.example.app')).toBe(false);
    });
  });

  describe('toRelativePath', () => {
    it('converts internal import to relative path', () => {
      expect(
        resolver.toRelativePath('com.example.app.data.UserRepository', 'com.example.app')
      ).toBe('data/UserRepository');
    });

    it('converts deeply nested import', () => {
      expect(
        resolver.toRelativePath(
          'com.example.app.feature.projects.ProjectRepository',
          'com.example.app'
        )
      ).toBe('feature/projects/ProjectRepository');
    });

    it('converts single-segment suffix', () => {
      expect(resolver.toRelativePath('com.example.app.MainViewModel', 'com.example.app')).toBe(
        'MainViewModel'
      );
    });
  });
});
