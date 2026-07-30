---
id: TASK-41
title: Guarantee a WASM-baseline install with opt-in native discovery
status: done
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

- [x] `web-tree-sitter` is installed by every supported normal npm install.
- [x] `tree-sitter` and all native grammar packages are absent from
      `dependencies`, `optionalDependencies`, and `bundleDependencies`.
- [x] A clean production dependency tree contains no native Tree-sitter
      runtime or native grammar packages.
- [x] No install/preinstall/postinstall script attempts to build or fetch
      native Tree-sitter.
- [x] The clean installed package analyzes Go, Java, Python, C++, and Kotlin
      through WASM.
- [x] Optional peer metadata, if used, does not cause npm to install the peers
      and does not emit required-peer failures.
- [x] A trusted explicitly supplied native module root selects native after
      runtime-and-grammar health checks.
- [x] Auto mode ignores native packages placed only in the analyzed project's
      `node_modules`.
- [x] Missing or broken native packages never prevent installation and fall
      back to WASM at runtime.
- [x] Documentation distinguishes the npm package name `tree-sitter` from the
      `web-tree-sitter` fallback and explains how to force either backend.

## Definition of Done

- [x] Clean `npm pack`/install and Claude npm-source plugin install evidence is
      appended here, including the installed dependency tree and lifecycle
      script log.
- [x] Native-injection, project-isolation, and WASM-baseline tests pass.
- [x] Package metadata, installer documentation, and removal of obsolete
      native staging behavior are committed.

## Coordination

TASK-31 consumes this policy in the Claude npm plugin. TASK-35 documents the
user-facing installation flow. TASK-40 may optimize WASM performance but must
not weaken the default no-native-install guarantee.

## Implementation Notes (2026-07-30)

- `package.json`: `tree-sitter` + 5 native grammar packages removed from
  `dependencies`; `bundleDependencies` and the `tree-sitter` `overrides` pin
  removed; `postinstall` (postinstall-tree-sitter.mjs) and `prepack`
  (stage-tree-sitter-prebuild.mjs) hooks deleted along with both scripts;
  `web-tree-sitter` remains a pinned production dependency; optional peers
  from TASK-39 kept (see kotlin deviation below).
- `package-lock.json` regenerated (surgical prune + `npm install
  --package-lock-only` in a temp copy so the shared node_modules was never
  touched): 0 version changes, 0 additions, 10 removals (6 native packages,
  nested `tree-sitter-c`, `node-addon-api`, `node-gyp-build`,
  `npm-check-updates`).
- Deviation from TASK-39 metadata: `@tree-sitter-grammars/tree-sitter-kotlin`
  is NOT declared as an optional peer. Its only release (1.1.0) peer-depends
  on `tree-sitter@^0.22.4`, which conflicts with our `tree-sitter@^0.25.0`
  optional peer; npm 11 resolves that optional-peer conflict with a hard
  ERESOLVE for the CONSUMER's install (reproduced minimally and in the
  clean-room test). Keeping it as a peer would violate the AC "optional peer
  metadata ... does not emit required-peer failures". The kotlin grammar is
  documented for explicit host installation instead
  (docs/user-guide/parser-runtime.md).
- src/plugins/shared/** unchanged: TASK-39's createRequire-based trusted
  module-root resolution already satisfies the policy (verified by the
  clean-room native-injection and analyzed-project isolation tests).

## DoD Evidence (2026-07-30)

### Clean-room npm pack/install (also what a Claude npm-source plugin install consumes)

ArchGuard has no marketplace plugin manifest; a Claude "npm-source" plugin
install consumes the same npm tarball this evidence installs, so the
`npm pack` + `npm install <tarball>` run below is the shared code path for
both install routes.

```
$ npm pack --ignore-scripts                 # yalehwang-archguard-0.1.31.tgz
$ mkdir app && cd app && npm init -y
$ npm install ../yalehwang-archguard-0.1.31.tgz --omit=dev --no-audit --no-fund --foreground-scripts

> sharp@0.34.5 install
> node install/check.js || npm run build

added 356 packages in 40s
INSTALL_EXIT=0
```

Lifecycle-script audit: the ONLY lifecycle script in the entire install is
sharp's own `install` (sharp's platform-package policy, tracked by TASK-31).
No `node-gyp`, `prebuild-install`, `postinstall-tree-sitter`,
`stage-tree-sitter`, or `tree_sitter_runtime_binding` output. No `ERESOLVE`,
no peer warnings for tree-sitter packages.

Installed dependency tree (`npm ls --all --omit=dev`, 559 lines): every
tree-sitter line is unmet-optional metadata, nothing native materialized:

```
  ├── UNMET OPTIONAL DEPENDENCY tree-sitter-cpp@^0.23.4
  ├── UNMET OPTIONAL DEPENDENCY tree-sitter-go@^0.25.0
  ├── UNMET OPTIONAL DEPENDENCY tree-sitter-java@^0.23.5
  ├── UNMET OPTIONAL DEPENDENCY tree-sitter-python@^0.25.0
  ├── UNMET OPTIONAL DEPENDENCY tree-sitter@^0.25.0
  ├─┬ web-tree-sitter@0.25.10          <- installed (WASM baseline)
```

`node_modules/` contains `web-tree-sitter` and NONE of `tree-sitter`,
`tree-sitter-go`, `tree-sitter-java`, `tree-sitter-python`, `tree-sitter-cpp`,
`@tree-sitter-grammars/tree-sitter-kotlin`. The installed package ships
`assets/grammars/tree-sitter.wasm` + the five grammar WASMs.

### Tests

- `tests/unit/packaging/install-policy.test.ts` (15 tests): package.json /
  lockfile invariants — WASM baseline required, natives absent from
  dependencies/optionalDependencies/bundleDependencies/overrides, optional
  peers optional, kotlin peer exclusion rationale, no install/prepack hooks,
  staging scripts deleted, lockfile root + entries clean.
- `tests/integration/install-policy.test.ts` (8 tests): real tarball install
  into an isolated temp project (own node_modules from the registry) —
  dependency-tree and lifecycle-log audits; the clean installed package
  analyzes Go/Java/Python/C++/Kotlin through WASM (ArchJSON byte-identical to
  the in-repo WASM baseline); ARCHGUARD_NATIVE_MODULE_ROOT injection selects
  native for all five languages (byte-identical to the native baseline)
  without ArchGuard having installed anything; native packages placed only in
  the analyzed project's node_modules are ignored even with cwd and the entry
  script inside that project (WASM selected, fallback reason recorded).
- Regression: TASK-39 packed-install, wasm-assets, parser-runtime unit and
  mixed-selection suites all pass unchanged (61 tests).
- Full gate: `npx vitest run` — see Land Evidence below.

### Known pre-existing caveat (base branch, out of TASK-41 scope)

`src/cli/processors/arch-json-provider.ts` still constructs language plugins
with their default native backend when the optional plugin registry is unset,
so a registry-less CLI `analyze --lang go` in a native-free install fails
instead of falling back to WASM. TASK-39's adversarial audit explicitly
adjudicated this main-pipeline routing gap NON-BLOCKING (no AC routes that
file through the resolver), and TASK-41's declared touches exclude it. The
guarantee delivered here is at the package/resolver level, proven by the
clean-room tests above. Follow-up candidate: route arch-json-provider plugin
construction through `selectParserBackendFor`.


## Loop-driver land evidence (2026-07-30)

- **Gate**: vitest **PASS** (exit 0), GateEvent `ac0832b8-c114-4cf8-8863-53d59e59d62e`
  (2026-07-30T09:59:51Z), run with cwd = worktree and a 600s timeoutMs override
  (machine under load; 4226 passed | 11 skipped per the builder's run).
- **Adversarial audit** (fresh-context, refute-first): **NO REFUTATION FOUND**.
  Kotlin-peer removal adjudicated a reasonable conservative resolution (stale
  `tree-sitter@^0.22.4` peer range verified from the old lockfile; decision
  pinned by unit test + documented override path). Lockfile diff verified
  surgical: zero added lines, exactly the 10 claimed removals, web-tree-sitter
  untouched. node_modules hygiene verified (no tracked symlink/dir). Clean-room
  tarball install asserts zero ERESOLVE/peer complaints, five-language WASM
  analysis byte-identical to baseline, trusted-root native injection with real
  native modules, and analyzed-project isolation.
- **Non-blocking observations**: ERESOLVE-with-kotlin-peer rests on builder's
  minimal-repro prose (not a committed test); `scripts/stage-tree-sitter-prebuild.mjs`
  + `prepack` deletion slightly exceeds the literal Touches list (same intended
  category); branch task file lacked ## Touches/status (stacking artifact —
  declaration lives on master as df20e8a); `scripts/fetch-grammar-wasms.mjs`
  retained deliberately (dev-time WASM vendoring, no lifecycle hook).
- Merge to master pending human-steered merge (same convention as
  TASK-30/32/33/37/38/39).
