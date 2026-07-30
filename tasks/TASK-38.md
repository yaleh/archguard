---
id: TASK-38
title: Add a web-tree-sitter backend with bundled WASM grammars
status: ready
labels:
  - parser
  - tree-sitter
  - wasm
  - portability
parent: TASK-31
children: []
extra: {}
---
## Proposal

Implement a portable parser backend using `web-tree-sitter` while preserving
the existing Tree-sitter grammars and extractor logic. Bundle verified grammar
WASM assets for Go, Java, Python, C++, and Kotlin so fallback does not depend on
native grammar packages being installed successfully.

The measured expectation is approximately 3x slower for parser-only work and
1.5-2.5x slower for complete ArchGuard analysis before process-lifetime and
parallelism optimizations.

## Blocked

Blocked by TASK-37's runtime-neutral parser facade.

## Plan

1. Pin a compatible `web-tree-sitter` version and grammar ABI. Declare
   `web-tree-sitter` as a required production dependency so every normal npm
   installation provides the fallback runtime without an install hook.
2. Add reproducible acquisition/build and checksum verification for the five
   grammar `.wasm` assets; do not rely on untracked files from `node_modules`.
3. Implement one-time WASM runtime initialization and per-language
   `Language.load()` caching.
4. Implement parser sessions through the TASK-37 facade.
5. Resolve assets relative to the installed package with `import.meta.url`, not
   the current working directory.
6. Dispose WASM trees/parsers explicitly to bound memory in long-lived MCP
   processes.
7. Add a forced-WASM mode for deterministic tests before automatic selection
   is introduced.
8. Compare native and WASM ArchJSON across representative fixtures for all five
   languages.

## Touches

- package.json
- package-lock.json
- src/plugins/shared/** (WASM backend + runtime/Language.load caching alongside the TASK-37 facade)
- assets/grammars/** (new: five pinned grammar .wasm files + checksums/provenance)
- scripts/** (new: reproducible WASM grammar acquisition + checksum verification script)
- tests/unit/plugins/shared/** (forced-WASM backend unit tests)
- tests/plugins/** (native↔WASM ArchJSON parity fixtures for all five languages)
- tests/integration/** (packed-install / cwd-independent asset-loading integration tests)
- tasks/TASK-38.md

Product code outside `src/plugins/shared/**` (language bridges/builders, CLI, MCP) is out of scope; the WASM backend is consumed through the TASK-37 facade.

## Acceptance Criteria

- [x] A normal clean install parses all five languages without any native
      Tree-sitter runtime or grammar package present. (WasmParserBackend loads
      web-tree-sitter + bundled grammar WASM only; packed-install layout test
      in tests/integration/wasm-assets.test.ts parses all five languages.)
- [x] `web-tree-sitter` is a required production dependency, not an optional,
      peer-only, or development-only dependency. (Pinned 0.25.10 in
      dependencies; asserted by tests/integration/wasm-assets.test.ts.)
- [x] Published artifacts contain the runtime WASM and five pinned grammar
      WASM files with reproducible checksums. (assets/grammars/ in package
      files[]; npm pack dry-run manifest asserted in integration test;
      checksums.json + scripts/fetch-grammar-wasms.mjs verify.)
- [x] Asset loading works from a packed npm installation and Claude plugin
      cache, independent of `cwd`. (import.meta.url-relative resolution;
      simulated packed layout parsed from a foreign cwd in integration test.)
- [x] Native and WASM outputs are equivalent, or every intentional delta is
      documented and approved in snapshots. (Zero deltas: canonical AST dumps
      and full ArchJSON byte-identical across 16 fixtures / 5 languages in
      tests/plugins/wasm-parity/archjson-parity.test.ts.)
- [x] Repeated analysis in one process does not show unbounded WASM heap
      growth. (tests/integration/wasm-memory.test.ts: 220 parse/dispose
      cycles, RSS growth bounded.)
- [x] Parser-only and end-to-end benchmark baselines are recorded.
      (assets/grammars/benchmarks.md via scripts/benchmark-parser-backends.mjs:
      parser-only ~2.3x slower, parse+extract+map pipeline ~0.4x — WASM node
      access is cheaper than N-API accessors, offsetting raw parse cost.)

## Definition of Done

- [x] Forced-WASM unit, integration, packed-install, and parity tests pass.
      (54 new tests; full suite 4137 passed / 11 skipped.)
- [x] WASM assets, provenance, licenses, and benchmark evidence are committed.
      (assets/grammars/{*.wasm,checksums.json,provenance.json,licenses/,
      benchmarks.md}.)

## Coordination

TASK-39 adds native-first automatic selection. TASK-41 enforces the final
install-time dependency policy. TASK-40 optimizes long-running and parallel
performance after correctness is established.
