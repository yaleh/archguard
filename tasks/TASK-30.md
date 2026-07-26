---
id: TASK-30
title: "Fix packaging bug: typescript declared as devDependency but imported at
  runtime"
status: todo
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

The fix (move `typescript` to `dependencies`, regenerate `package-lock.json`) has already
been applied locally but is uncommitted. This task tracks committing it and adding a
regression guard so a future runtime import of a dev-only package fails fast in CI
instead of only surfacing on a real user install.

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

- [ ] `typescript` listed under `dependencies` in `package.json`; `package-lock.json`
      regenerated to match
- [ ] A mechanical check exists that fails if a runtime-imported package is missing
      from `dependencies`
- [ ] The check is wired into the build or test pipeline, not left as a standalone
      script nobody runs
- [ ] A clean `npm pack` + `npm install -g` in a fresh directory (no `npm link`) runs
      `archguard --version` and `archguard --help` successfully

## Definition of Done

- [ ] Fix and regression check committed to `master`
- [ ] `npm test` (or `npm run build`) exercises the new check and passes
- [ ] A clean-room install (fresh global prefix, not the source checkout's `npm link`)
      verified working end-to-end