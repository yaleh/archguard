/**
 * Integration: MCP query-only launch graph laziness (TASK-31).
 *
 * The plugin's MCP entry is `dist/cli/index.js mcp`. Query-only startup must
 * NOT statically load `sharp` (only needed when rendering PNGs) or the native
 * Tree-sitter runtime/grammar packages (only needed when analyzing, and only
 * on native-capable hosts). This test mechanically walks the STATIC import
 * graph of the built CLI entry and asserts those packages are unreachable;
 * dynamic imports are tracked separately so we can also assert that `sharp`
 * is still wired in — lazily — rather than accidentally dropped.
 *
 * Complemented at runtime by tests/integration/plugin-install.test.ts, which
 * performs an MCP handshake from an isolated install with sharp physically
 * removed.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');
const ENTRY = path.join(repoRoot, 'dist', 'cli', 'index.js');

/** Packages that must never appear in the static query-only launch graph. */
const FORBIDDEN_STATIC = [
  'sharp',
  'tree-sitter',
  'tree-sitter-go',
  'tree-sitter-java',
  'tree-sitter-python',
  'tree-sitter-cpp',
  '@tree-sitter-grammars/tree-sitter-kotlin',
];

// Static imports / re-exports. tsc emits one statement per line start; the
// specifier may follow after a multi-line clause, so allow newlines in the
// clause but never across a quote.
const STATIC_PATTERNS = [
  /^[ \t]*import[ \t]+[^'"(]*?\bfrom[ \t]*['"]([^'"]+)['"]/gm,
  /^[ \t]*import[ \t]*['"]([^'"]+)['"]/gm, // side-effect import
  /^[ \t]*export[ \t]+[^'"(]*?\bfrom[ \t]*['"]([^'"]+)['"]/gm,
];
const DYNAMIC_PATTERN = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

interface GraphResult {
  visitedFiles: Set<string>;
  staticBare: Set<string>;
  dynamicBare: Set<string>;
}

function packageName(specifier: string): string {
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) return parts.slice(0, 2).join('/');
  return parts[0];
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [resolved, `${resolved}.js`, path.join(resolved, 'index.js')];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Walk the static import graph of the built dist entry. */
function walkStaticGraph(entry: string): GraphResult {
  const result: GraphResult = {
    visitedFiles: new Set(),
    staticBare: new Set(),
    dynamicBare: new Set(),
  };
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (result.visitedFiles.has(file)) continue;
    result.visitedFiles.add(file);
    const source = readFileSync(file, 'utf8');

    for (const pattern of STATIC_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null) {
        const specifier = match[1];
        if (specifier.startsWith('.')) {
          const target = resolveRelative(file, specifier);
          if (target && target.startsWith(path.join(repoRoot, 'dist'))) queue.push(target);
        } else if (!specifier.startsWith('node:')) {
          result.staticBare.add(packageName(specifier));
        }
      }
    }

    DYNAMIC_PATTERN.lastIndex = 0;
    let dyn: RegExpExecArray | null;
    while ((dyn = DYNAMIC_PATTERN.exec(source)) !== null) {
      const specifier = dyn[1];
      if (specifier.startsWith('.')) {
        // Follow dynamic relative edges too: lazily-loaded modules (e.g. the
        // WASM parser backend) are still part of the application graph, and
        // their own imports must be classified. Bare-specifier laziness is
        // determined by the importing edge, not by reachability scanning.
        const target = resolveRelative(file, specifier);
        if (target && target.startsWith(path.join(repoRoot, 'dist'))) queue.push(target);
      } else if (!specifier.startsWith('node:')) {
        result.dynamicBare.add(packageName(specifier));
      }
    }
  }
  return result;
}

let graph: GraphResult;

beforeAll(() => {
  // The graph is walked on dist/: build once if the gate runs vitest alone.
  if (!existsSync(ENTRY)) {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'pipe', timeout: 280_000 });
  }
  graph = walkStaticGraph(ENTRY);
}, 300_000);

describe('MCP query-only static launch graph', () => {
  it('walks a non-trivial graph (sanity that the walker follows imports)', () => {
    expect(graph.visitedFiles.size).toBeGreaterThan(50);
    // The MCP SDK must be statically reachable — it is legitimately needed at startup.
    expect(graph.staticBare.has('@modelcontextprotocol/sdk')).toBe(true);
  });

  for (const pkg of FORBIDDEN_STATIC) {
    it(`does not statically load ${pkg}`, () => {
      expect(
        graph.staticBare.has(pkg),
        `${pkg} must not be statically reachable from the MCP entry`
      ).toBe(false);
    });
  }

  it('keeps sharp wired in lazily (dynamic import), not dropped', () => {
    expect(graph.dynamicBare.has('sharp'), 'sharp must remain a dynamic (lazy) import').toBe(true);
  });

  it('keeps the dual parser runtimes behind dynamic imports', () => {
    expect(graph.dynamicBare.has('web-tree-sitter')).toBe(true);
  });
});
