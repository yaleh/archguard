---
id: TASK-30
title: "Fix packaging bug: typescript declared as devDependency but imported at
  runtime"
status: done
labels:
  - bug
  - packaging
parent: null
children: []
extra: {}
---
## Proposal

`dist/utils/tsconfig-finder.js` does `import ts from 'typescript'` at runtime, but
`package.json` declared `typescript` only under `devDependencies`. A real (non-linked)
`npm install -g` therefore fails immediately with `ERR_MODULE_NOT_FOUND: typescript`,
which `npm link` silently masked during local development (the linked checkout's own
`node_modules` has every devDependency present). Discovered 2026-07-26 while installing
archguard for Claude Code user scope from a packed tarball instead of a dev symlink.

The fix (move `typescript` to `dependencies`, regenerate `package-lock.json`) was applied
and committed in `983bf93`. This task tracked adding a regression guard so a future
runtime import of a dev-only package fails fast in CI instead of only surfacing on a
real user install.

## Plan

1. Commit the already-applied `package.json`/`package-lock.json` fix (`typescript` moved
   to `dependencies`).
2. Add a mechanical check (script or test) that scans `dist/**/*.js` for
   `from '<pkg>'` / `require('<pkg>')` bare-specifier imports and asserts every one
   resolves to a package listed in `dependencies` (not only `devDependencies` or
   transitively via another dependency).
3. Wire the check into `npm run build` or `npm test` so a future regression fails
   the pipeline, not just a downstream user's global install.
4. Re-verify with a clean `npm pack` + `npm install -g` into a scratch prefix
   (no `npm link` involved) that `archguard --version` and `archguard --help` work.

## Acceptance Criteria

- [x] `typescript` listed under `dependencies` in `package.json`; `package-lock.json`
      regenerated to match — committed in `983bf93`.
- [x] A mechanical check exists that fails if a runtime-imported package is missing
      from `dependencies` — `scripts/check-runtime-deps.ts` (scans `dist/**/*.js` for
      bare-specifier ESM/CJS/dynamic imports, resolves package names including scoped
      packages, skips Node builtins, flags anything not in `package.json` `dependencies`).
      Unit-tested in `tests/unit/scripts/check-runtime-deps.test.ts` (11 tests, including
      a reproduction of this exact regression and a clean-run assertion against the real
      `dist/`).
- [x] The check is wired into the build or test pipeline, not left as a standalone
      script nobody runs — `package.json` `postbuild` script runs
      `npm run check:runtime-deps` automatically after every `npm run build`.
- [x] A clean `npm pack` + `npm install -g` in a fresh directory (no `npm link`) runs
      `archguard --version` and `archguard --help` successfully — verified into a scratch
      global prefix (`npm install -g --prefix <scratch> <packed tarball>`); both commands
      ran successfully and `typescript` was confirmed present in the installed
      `node_modules`.

## Definition of Done

- [x] Fix and regression check committed — committed as `0af4013` on
      `milestones/archguard/TASK-30` by the quay loop-driver (2026-07-29): gate `vitest`
      exit 0 (GateEvent `6ddb51fd`, 4079 passed | 11 skipped); fresh-context adversarial
      audit: NO REFUTATION FOUND. Merge to `master` pending (human-steered).
- [x] `npm test` (or `npm run build`) exercises the new check and passes — `npm run
      build` runs the check via `postbuild` (confirmed passing), and the full `npm test`
      suite (4079 tests) passes with the new test file included.
- [x] A clean-room install (fresh global prefix, not the source checkout's `npm link`)
      verified working end-to-end — see AC #4 above.