import type { ILanguagePlugin } from '@/core/interfaces/language-plugin.js';
import type { ParserLanguage } from './parser-backend.js';
import { selectParserBackendFor, type SelectParserBackendOptions } from './parser-runtime.js';

/** Construct a Tree-sitter language plugin with its resolver-selected backend. */
export async function createLanguagePlugin(
  language: ParserLanguage,
  options: SelectParserBackendOptions = {}
): Promise<ILanguagePlugin> {
  const { backend } = await selectParserBackendFor(language, options);

  switch (language) {
    case 'go': {
      const { GoAtlasPlugin } = await import('@/plugins/golang/atlas/index.js');
      return new GoAtlasPlugin(backend);
    }
    case 'java': {
      const { JavaPlugin } = await import('@/plugins/java/index.js');
      return new JavaPlugin(backend);
    }
    case 'python': {
      const { PythonPlugin } = await import('@/plugins/python/index.js');
      return new PythonPlugin(backend);
    }
    case 'cpp': {
      const { CppPlugin } = await import('@/plugins/cpp/index.js');
      return new CppPlugin(backend);
    }
    case 'kotlin': {
      const { KotlinPlugin } = await import('@/plugins/kotlin/index.js');
      return new KotlinPlugin(backend);
    }
  }
}
