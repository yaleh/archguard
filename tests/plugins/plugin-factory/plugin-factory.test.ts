import { describe, expect, it } from 'vitest';
import { createLanguagePlugin } from '@/plugins/shared/plugin-factory.js';
import { GoPlugin } from '@/plugins/golang/index.js';
import { JavaPlugin } from '@/plugins/java/index.js';
import { PythonPlugin } from '@/plugins/python/index.js';
import { CppPlugin } from '@/plugins/cpp/index.js';
import { KotlinPlugin } from '@/plugins/kotlin/index.js';

describe('createLanguagePlugin', () => {
  it.each([
    ['go', GoPlugin],
    ['java', JavaPlugin],
    ['python', PythonPlugin],
    ['cpp', CppPlugin],
    ['kotlin', KotlinPlugin],
  ] as const)(
    'constructs the %s plugin through resolver-selected WASM',
    async (language, PluginClass) => {
      const plugin = await createLanguagePlugin(language, { policy: 'wasm' });
      expect(plugin).toBeInstanceOf(PluginClass);
    }
  );

  it.each([GoPlugin, JavaPlugin, PythonPlugin, CppPlugin, KotlinPlugin])(
    'rejects omitted backends at runtime for %s',
    (PluginClass) => {
      expect(() => Reflect.construct(PluginClass, [])).toThrow(
        'A resolver-selected parser backend is required'
      );
    }
  );

  it('does not probe native modules under forced WASM', async () => {
    let nativeImports = 0;
    await createLanguagePlugin('java', {
      policy: 'wasm',
      nativeLoaders: {
        loadRuntime: () => {
          nativeImports += 1;
          throw new Error('must not run');
        },
        loadGrammar: () => {
          nativeImports += 1;
          return {};
        },
      },
    });
    expect(nativeImports).toBe(0);
  });
});
