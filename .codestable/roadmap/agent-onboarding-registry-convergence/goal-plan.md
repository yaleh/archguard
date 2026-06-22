# Goal Plan: agent-onboarding-registry-convergence

## Inputs

- Roadmap: `.codestable/roadmap/agent-onboarding-registry-convergence/agent-onboarding-registry-convergence-roadmap.md`
- Items: `.codestable/roadmap/agent-onboarding-registry-convergence/agent-onboarding-registry-convergence-items.yaml`
- Roadmap review: `.codestable/roadmap/agent-onboarding-registry-convergence/agent-onboarding-registry-convergence-roadmap-review.md`
- Source proposal: `docs/proposals/proposal-agent-install-and-command-registry.md`
- Baseline ref: `6096568b00aa2f986433fae5746ee91c8ce5a5e8`

## Feature Order
1. `registry-agent-guidance-contract` (non-functional) — 扩展 agent guidance metadata 合同，补 freshness/docs policy/validator。
2. `agent-instructions-renderer` (mixed) — 从 registry 生成 Claude/Codex instructions，并提供只读 CLI。
3. `registry-install-config-contract` (non-functional) — 扩展 install/config metadata 合同，含 staged command metadata 与 validators。
4. `provider-config-adapters` (functional) — 实现 Claude/Codex provider adapters，支持 show/write/remove/dry-run/backup。
5. `agent-onboarding-cli` (functional) — 新增 install/update/config show/remove CLI，复用 adapters 和 renderer。
6. `config-doctor-mcp-e2e` (functional) — 新增 config doctor、独立 stdio MCP probe 和真实 E2E 收口。

## Roadmap-Level Core Acceptance Path

This roadmap is functional/mixed. Completion requires real built-CLI evidence for the new Codex and Claude onboarding surface:

1. Build the CLI with `npm run build`.
2. Generate agent instructions with `node dist/cli/index.js agent instructions codex` and `node dist/cli/index.js agent instructions claude`.
3. Install Codex and Claude config into temporary HOME directories only.
4. Run `archguard config doctor codex|claude --home <tmp-home> --json`.
5. Doctor must launch an independent stdio `archguard mcp` process from the current build and list tools; current agent-hosted MCP tools are not accepted as verification evidence.
6. `npm run test:e2e` must execute real files under `tests/e2e/` and must not empty-run.

## Key Assumptions

- Implementation starts from the current `feature/command-metadata-registry` baseline.
- First provider scope is only Claude Code and Codex.
- Tests must use `--home <tmp-home>` and must not write the real user HOME.
- Codex TOML parsing uses `smol-toml`.
- Claude paths follow current docs: user `~/.claude/mcp.json`, project `<projectRoot>/.mcp.json`.
- Codex paths follow current docs: user `~/.codex/config.toml`, project `<projectRoot>/.codex/config.toml`.

## Top 3 Risks And Mitigations

1. User config corruption: adapters must only modify ArchGuard entries, use structured parsers, create backups, and cover unrelated config preservation in tests.
2. Metadata/runtime drift: `help` is enforced immediately, while `install/update/config` use staged metadata until command shells are registered.
3. False doctor success: doctor must use a built CLI stdio MCP process and teardown deterministically; in-process checks are optional fast-path only.

## Mandatory Command Set

Feature-specific commands are listed in `goal-features/*.md`. Roadmap completion must rerun this aggregate set when feasible:

- `npm run type-check`
- `npm run lint`
- `npm run build`
- `npm test -- tests/unit/cli/metadata-registry.test.ts tests/unit/cli/cli-metadata-drift.test.ts`
- `npm test -- tests/unit/cli/instruction-renderer.test.ts`
- `npm test -- tests/unit/cli/agent/provider-config-adapters.test.ts`
- `npm test -- tests/unit/cli/onboarding-cli.test.ts`
- `npm test -- tests/integration/cli-mcp/metadata-surface-e2e.test.ts`
- `npm run test:e2e`
- `npm run docs:check`
- `node dist/cli/index.js agent instructions codex`
- `node dist/cli/index.js agent instructions claude`
- `node dist/cli/index.js install codex --home <tmp-home> --dry-run`
- `node dist/cli/index.js install claude --home <tmp-home> --dry-run`
- `node dist/cli/index.js config doctor codex --home <tmp-home> --json`
- `node dist/cli/index.js config doctor claude --home <tmp-home> --json`

## Preflight Strategy

At goal start, run cheap metadata checks first when feasible: YAML/design status checks, then type-check or targeted unit tests. Do not block on commands that cannot exist before their owning feature; record them as deferred until the owning feature is complete.

## Recovery If Validation Tools Are Missing

If a runner or dependency is missing, add the proper project dependency or use the existing project runner. Do not create same-name command shims or fake validation outputs.

## Final Audit Must Verify

- All six feature review reports passed.
- All six QA reports passed.
- All six acceptance reports passed.
- Checklist steps are `done` and checks are `passed`.
- Roadmap items are `done`.
- Roadmap-level E2E path above has real evidence, especially Codex support.
