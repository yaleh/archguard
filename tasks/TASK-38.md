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

## Acceptance Criteria

- [ ] A normal clean install parses all five languages without any native
      Tree-sitter runtime or grammar package present.
- [ ] `web-tree-sitter` is a required production dependency, not an optional,
      peer-only, or development-only dependency.
- [ ] Published artifacts contain the runtime WASM and five pinned grammar
      WASM files with reproducible checksums.
- [ ] Asset loading works from a packed npm installation and Claude plugin
      cache, independent of `cwd`.
- [ ] Native and WASM outputs are equivalent, or every intentional delta is
      documented and approved in snapshots.
- [ ] Repeated analysis in one process does not show unbounded WASM heap growth.
- [ ] Parser-only and end-to-end benchmark baselines are recorded.

## Definition of Done

- [ ] Forced-WASM unit, integration, packed-install, and parity tests pass.
- [ ] WASM assets, provenance, licenses, and benchmark evidence are committed.

## Coordination

TASK-39 adds native-first automatic selection. TASK-41 enforces the final
install-time dependency policy. TASK-40 optimizes long-running and parallel
performance after correctness is established.
