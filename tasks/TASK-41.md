---
id: TASK-41
title: Guarantee a WASM-baseline install with opt-in native discovery
status: ready
labels:
  - install
  - packaging
  - tree-sitter
  - wasm
  - security
parent: TASK-31
children: []
extra: {}
---
## Proposal

Make every normal ArchGuard/npm-plugin installation deterministic and portable:
install `web-tree-sitter` and verified grammar WASM assets, but do not install,
build, download, or vendor the native `tree-sitter` runtime or native grammar
packages.

Native parsing remains an opportunistic runtime accelerator. ArchGuard may use
it when both the `tree-sitter` runtime and the selected language's native
grammar are already available from a trusted resolution scope and pass a real
parse health check.

This distinction matters because npm `optionalDependencies` are still actively
installed when possible. They tolerate failure; they do not mean "do not
install." Therefore native Tree-sitter packages must not be listed there.

## Blocked

Blocked by TASK-38 and TASK-39. TASK-38 provides the guaranteed WASM baseline;
TASK-39 provides the native/WASM runtime resolver.

## Resolution and trust policy

In `auto` mode, native discovery may use:

1. ArchGuard's own package-resolution scope when an embedding host supplied
   compatible optional peer packages.
2. A module root explicitly supplied through a documented setting such as
   `ARCHGUARD_NATIVE_MODULE_ROOT`.

It must not automatically:

- inspect or load native packages from the project being analyzed;
- execute `npm root -g`, scan arbitrary global package locations, or mutate
  global installations;
- install missing native packages at runtime;
- switch to native after an analysis has started.

Loading native packages from the analyzed repository would execute code owned
by that repository and would violate the expectations of a static-analysis
tool. Users who intentionally want a global accelerator can pass its module
root explicitly.

## Plan

1. Put `web-tree-sitter` in production `dependencies` and ship the five grammar
   WASM assets through TASK-38.
2. Remove `tree-sitter`, native grammar packages, native staging scripts, and
   Tree-sitter `bundleDependencies` from the production dependency closure.
3. If package metadata is useful for compatible host installations, declare
   native packages as optional peers using `peerDependenciesMeta.optional`;
   otherwise document a separate native accelerator installation. Neither form
   may trigger installation during a normal ArchGuard install.
4. Implement trusted module-root resolution with `createRequire()` so the ESM
   application does not depend on `NODE_PATH`.
5. Add clean-room package and Claude-plugin install tests that record lifecycle
   scripts and inspect the installed dependency tree.
6. Add an injected native fixture proving that `auto` selects native without
   ArchGuard having installed it.
7. Document that the policy applies to Tree-sitter. `sharp` has its own
   platform-package installation policy and is tracked separately by TASK-31.

## Acceptance Criteria

- [ ] `web-tree-sitter` is installed by every supported normal npm install.
- [ ] `tree-sitter` and all native grammar packages are absent from
      `dependencies`, `optionalDependencies`, and `bundleDependencies`.
- [ ] A clean production dependency tree contains no native Tree-sitter
      runtime or native grammar packages.
- [ ] No install/preinstall/postinstall script attempts to build or fetch
      native Tree-sitter.
- [ ] The clean installed package analyzes Go, Java, Python, C++, and Kotlin
      through WASM.
- [ ] Optional peer metadata, if used, does not cause npm to install the peers
      and does not emit required-peer failures.
- [ ] A trusted explicitly supplied native module root selects native after
      runtime-and-grammar health checks.
- [ ] Auto mode ignores native packages placed only in the analyzed project's
      `node_modules`.
- [ ] Missing or broken native packages never prevent installation and fall
      back to WASM at runtime.
- [ ] Documentation distinguishes the npm package name `tree-sitter` from the
      `web-tree-sitter` fallback and explains how to force either backend.

## Definition of Done

- [ ] Clean `npm pack`/install and Claude npm-source plugin install evidence is
      appended here, including the installed dependency tree and lifecycle
      script log.
- [ ] Native-injection, project-isolation, and WASM-baseline tests pass.
- [ ] Package metadata, installer documentation, and removal of obsolete
      native staging behavior are committed.

## Coordination

TASK-31 consumes this policy in the Claude npm plugin. TASK-35 documents the
user-facing installation flow. TASK-40 may optimize WASM performance but must
not weaken the default no-native-install guarantee.
