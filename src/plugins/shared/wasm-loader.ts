/**
 * Shared WASM loader for web-tree-sitter.
 *
 * Handles one-time Parser initialization and caches loaded Language instances.
 * Resolves WASM paths from node_modules using createRequire().
 */
import { Parser, Language } from 'web-tree-sitter';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const _require = createRequire(import.meta.url);

let initPromise: Promise<void> | null = null;
const languageCache = new Map<string, Language>();

/**
 * Initialize web-tree-sitter (idempotent, safe to call multiple times).
 */
export async function initTreeSitter(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init({
      locateFile(scriptName: string) {
        // Resolve web-tree-sitter's own WASM file from node_modules
        const pkgDir = path.dirname(_require.resolve('web-tree-sitter'));
        return path.join(pkgDir, scriptName);
      },
    });
  }
  return initPromise;
}

/**
 * Load a tree-sitter grammar WASM file from a grammar npm package.
 * Results are cached — subsequent calls with the same key return the same instance.
 *
 * @param packageName - npm package name (e.g. 'tree-sitter-go')
 * @param wasmFile    - WASM filename (e.g. 'tree-sitter-go.wasm')
 */
export async function loadLanguage(packageName: string, wasmFile: string): Promise<Language> {
  const cacheKey = `${packageName}/${wasmFile}`;
  const cached = languageCache.get(cacheKey);
  if (cached) return cached;

  await initTreeSitter();

  const pkgJsonPath = _require.resolve(`${packageName}/package.json`);
  const wasmPath = path.join(path.dirname(pkgJsonPath), wasmFile);

  const lang = await Language.load(wasmPath);
  languageCache.set(cacheKey, lang);
  return lang;
}
