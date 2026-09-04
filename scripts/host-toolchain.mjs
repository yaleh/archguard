/**
 * Probe the actual host toolchain used to compile a git-built grammar.
 *
 * P0-1 (B): the Dart grammar is built on the host (no container), so
 * provenance records what was really there instead of a docker image that
 * never ran. Tolerates a missing tool (that key is omitted). `treeSitterCli`
 * is fixed to the pinned CLI version because that is what the build invokes
 * via npx.
 *
 * Kept in its own module so both `fetch-grammar-wasms.mjs` and
 * `build-dart-grammar-wasm.mjs` can import it without a dependency cycle.
 */
import { execFileSync } from 'node:child_process';
import { DART_GRAMMAR } from './dart-grammar-source.mjs';

export function detectHostToolchain() {
  const toolchain = { treeSitterCli: DART_GRAMMAR.buildToolVersion };
  toolchain.node = process.version;
  try {
    const out = execFileSync('emcc', ['--version'], { encoding: 'utf8' });
    toolchain.emcc = out.split('\n')[0].trim();
  } catch {
    // emcc not on PATH — the compiler came from the CLI/registry, omit the key
  }
  return toolchain;
}
