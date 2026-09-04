/**
 * Shared, immutable manifest for the Dart grammar WASM build.
 *
 * This is the single source of truth for every pinned input consumed by both
 * `fetch-grammar-wasms.mjs` (provenance generation) and
 * `build-dart-grammar-wasm.mjs` (reproducible rebuild). It performs no network
 * or filesystem I/O and holds no side effects, so both scripts can import it
 * without coupling to each other.
 *
 * Unlike the other grammars — which ship a prebuilt WASM inside their npm
 * tarball — tree-sitter-dart must be rebuilt from source because the npm
 * tree-sitter-dart@1.0.0 grammar predates enhanced-enum support (Dart 2.17+).
 */

export const DART_GRAMMAR = {
  asset: 'tree-sitter-dart.wasm',
  licenseFile: 'tree-sitter-dart.LICENSE',
  license: 'MIT',
  licenseNote:
    'Rebuilt from git (not the npm tarball): tree-sitter-dart@1.0.0 predates ' +
    'enhanced-enum support (Dart 2.17+). The npm package also declares a stale ' +
    'ISC license while the repo is MIT.',

  repository: 'https://github.com/UserNobody14/tree-sitter-dart',
  commit: 'be07cf7118d3dba06236a3f19541685a68209934',
  commitDate: '2026-07-06T22:03:01-06:00',
  sourceArchiveUrl:
    'https://github.com/UserNobody14/tree-sitter-dart/archive/be07cf7118d3dba06236a3f19541685a68209934.tar.gz',
  sourceArchiveFormat: 'tar.gz',
  sourceArchiveSha256: 'b126efb8dfeeba8b71f0c6ae1f0cd09cf8b205560786b31d44cc16b283e782f2',

  buildTool: 'tree-sitter-cli',
  buildToolVersion: '0.25.10',
  buildScript: 'scripts/build-dart-grammar-wasm.mjs',
};

/**
 * The provenance fragment common to both `fetch-grammar-wasms --update` and
 * `build-dart-grammar-wasm --update`. Returns a fresh object each call so
 * callers can spread/assign into it safely.
 */
export function dartProvenanceSource(toolchain = {}) {
  const fragment = {
    source: 'git',
    repository: DART_GRAMMAR.repository,
    commit: DART_GRAMMAR.commit,
    commitDate: DART_GRAMMAR.commitDate,
    sourceArchiveUrl: DART_GRAMMAR.sourceArchiveUrl,
    sourceArchiveFormat: DART_GRAMMAR.sourceArchiveFormat,
    sourceArchiveSha256: DART_GRAMMAR.sourceArchiveSha256,
    license: DART_GRAMMAR.license,
    licenseFile: `licenses/${DART_GRAMMAR.licenseFile}`,
    licenseNote: DART_GRAMMAR.licenseNote,
    buildTool: DART_GRAMMAR.buildTool,
    buildToolVersion: DART_GRAMMAR.buildToolVersion,
    buildScript: DART_GRAMMAR.buildScript,
  };
  // P0-1: record the host toolchain only when it is actually known — an empty
  // probe (e.g. a plain `--update` that did not rebuild) omits the key instead of
  // fabricating a build env that never produced the artifact.
  if (Object.keys(toolchain).length > 0) fragment.hostToolchain = toolchain;
  return fragment;
}
