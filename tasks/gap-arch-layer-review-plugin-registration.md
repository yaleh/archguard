---
id: gap-arch-layer-review-plugin-registration
title: arch-layer-review skill 未打包进发布渠道：从 .claude/skills 搬到 plugin/skills +
  .agents/skills，注册进 plugin.json
status: done
labels:
  - gap
  - architecture
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

Quay 新常驻会话（session 886cc353-96b4-4cae-a826-984df8434ca9）实测：user-scope 已装 ArchGuard 0.1.37，但 `arch-layer-review` skill 不可用。根因已核实（非猜测，逐项查过文件系统+git 历史+已有测试）：

- `arch-layer-review` 目前只存在于 `.claude/skills/arch-layer-review/`——这是本仓库"仅本地 dev-workspace 自用、不随插件发布"的既有惯例（同目录下的 `cognitive-analysis`/`cognitive-prep`/`feature-to-issues`/`refactoring-lifecycle-management` 都是这一类，均未随插件发布）。
- **真正会被发布的两个位置**是 `plugin/skills/`（打包进 npm 包 `@yalehwang/archguard-claude-plugin`，`plugin/package.json` 的 `files` 字段含 `"skills/"`）和 `.agents/skills/`（供 worktree 里的 worker agent 使用，`docs/dev-guide/l0-agent-queue.md` 记录的 symlink 惯例）。`feature-developer`、`project-semantics-discovery` 两个都同时存在于这两处，且**都不在** `.claude/skills/` 里——`arch-layer-review` 当初落地时（`gap-a4-d1-semantic-review-skill`）照抄了 `cognitive-analysis` 的"仅本地"惯例，而不是 `feature-developer` 的"随插件发布"惯例，这是选错了参照模式，不是代码缺陷。
- `plugin/.claude-plugin/plugin.json` 的 `commands` 数组只登记了 `feature-developer`、`project-semantics-discovery` 两个，没有 `arch-layer-review`——即使文件在正确位置，不登记也不会被 Claude Code 发现。
- 已有的机械测试 `tests/unit/packaging/plugin-package.test.ts` 的 `describe('plugin skills', ...)` 用例把要打包的 skill 列表硬编码为 `['feature-developer', 'project-semantics-discovery']`——这条测试本应在 `arch-layer-review` 该随发布但没随发布时报红，但因为列表本身没更新，测试对这个缺口是瞎的（测的是"列表自洽"，不是"真的所有该发布的 skill 都发布了"）。

**修复范围（按本仓库现有发布规范，不是本地 hack）**：

1. 把 `.claude/skills/arch-layer-review/{SKILL.md, references/goal-030-example-output.json, references/archguard-selfreview-example-output.json}` 整体搬到 `plugin/skills/arch-layer-review/`（同构 `feature-developer`/`project-semantics-discovery` 的目录形状），再复制一份到 `.agents/skills/arch-layer-review/`（同构既有两个 skill 在该目录下的存在方式）。
2. 删除 `.claude/skills/arch-layer-review/` 整个目录——该 skill 从"仅本地自用"升级为"随插件发布"后，不应该再保留一份仅本地可见的旧副本（避免两份内容后续各自漂移）。
3. `plugin/.claude-plugin/plugin.json` 的 `commands` 数组追加 `"./skills/arch-layer-review/SKILL.md"`；`description` 字段顺带把 "feature-developer and project-semantics-discovery skills" 更新为包含 `arch-layer-review`（准确性修正，不是额外范围）。
4. `tests/unit/packaging/plugin-package.test.ts` 的硬编码 skill 列表加入 `'arch-layer-review'`——这是让该测试真正具备"发现新 skill 漏打包"能力的唯一方式（硬编码列表本身没法自动发现新 skill，但至少不能让已知的三个 skill 只断言两个）。
5. `tests/unit/skills/arch-layer-review-skill.test.ts` 的 `skillDir` 从 `.claude/skills/arch-layer-review` 改为 `.agents/skills/arch-layer-review`（与 `tests/unit/skills/project-semantics-discovery-skill.test.ts` 的既有路径惯例一致）；测试体本身的断言逻辑不变。

**明确不做**：不新建"build 时自动从一处同步到另外两处"的同步机制——`feature-developer`/`project-semantics-discovery` 现状就是手工维护两份拷贝（`plugin/skills/` + `.agents/skills/`），本任务跟随现状，不顺手引入新的同步基础设施（那是另一个独立的改进，不在本次缺口修复范围内）。

<!-- dedup-ref -->
与 `gap-a4-d1-semantic-review-skill`（已 done，落地 skill 本体，范围是"内容对不对"）、`gap-a4-d1-single-tree-architecture-health-mode`（已 done，加第二套问题集，范围同样是"内容对不对"）不是同一机制——那两个任务做的是"skill 该说什么"，本任务做的是"skill 放在哪、有没有被发布渠道收录"，是打包/分发层面的缺口，两者正交。

## AC

- [x] `plugin/skills/arch-layer-review/SKILL.md` 与 `.agents/skills/arch-layer-review/SKILL.md` 存在且内容与原 `.claude/skills/arch-layer-review/SKILL.md` 一致（`diff` 核对，除路径本身外逐字节相同）
- [x] `.claude/skills/arch-layer-review/` 目录已删除（`test -d .claude/skills/arch-layer-review` 返回非 0）
- [x] `node -e "console.log(JSON.parse(require('fs').readFileSync('plugin/.claude-plugin/plugin.json')).commands)"` 的输出数组包含 `"./skills/arch-layer-review/SKILL.md"`
- [x] `npx vitest run tests/unit/packaging/plugin-package.test.ts` 全绿，且该文件的 `describe('plugin skills', ...)` 用例断言的 skill 列表包含三个（`feature-developer`、`project-semantics-discovery`、`arch-layer-review`）
- [x] `npx vitest run tests/unit/skills/arch-layer-review-skill.test.ts` 全绿（路径已指向 `.agents/skills/arch-layer-review`，不再依赖已删除的 `.claude/skills/` 副本）
- [x] `npm run build && node -e "const p=require('./plugin/package.json'); console.log(p.files)"` 确认 `plugin/package.json` 的 `files` 字段仍含 `"skills/"`（无需改动，仅用于验收：既有通配符字段天然覆盖新目录，核对它没被意外改窄）
- [x] `npm pack` 在 `plugin/` 目录下打出的 tarball（`npm pack --dry-run` 即可，不需要真的产出文件）列出的文件清单里包含 `skills/arch-layer-review/SKILL.md`——这是"真的会被发布"的最终机械证据，比"文件在磁盘上"更硬
- [x] `npm test`（全量）与 `npm run type-check` 通过

## DoD

不是"文件挪了 + plugin.json 加了一行 + 测试绿"就算完成，必须证明：

1. **三份拷贝内容一致，不是复制后各自漂移的起点**——`plugin/skills/arch-layer-review` 与 `.agents/skills/arch-layer-review` 必须逐字节相同（同一次复制产生，不是分别手写）。
2. **`npm pack --dry-run` 的产物清单是真实证据，不是读 `files` 字段猜测**——AC 里专门要求跑这条命令并确认 `arch-layer-review` 真的在里面，因为 `files` 字段用的是 `"skills/"` 这种目录通配符，理论上"新增子目录天然被覆盖"，但本任务的 DoD 要求实测验证这个假设成立，不能只读配置就下结论。
3. **没有引入新的同步基础设施**——如果实现过程中觉得"应该写个脚本自动从一处同步到另外两处"，先停下来判断这是否超出了本任务范围（本任务明确排除了这一点，见 Proposal 的"明确不做"）；两份拷贝的手工维护是本仓库现状，不是本任务要解决的问题。
4. **这是打包面修复，不包含版本发布**——本任务完成后代码层面"随发布的 skill 清单包含 arch-layer-review"即达标；把这个修复真正发布成一个新的 npm/plugin 版本、推进 tag/master、让 user-scope 装上它，是本任务之外的发布流程动作（GOAL-001 已裁定"人在 Claude Code 会话中触发发布"，不是本任务或任何 loop/worker 的职责）。

## Touches

- plugin/skills/arch-layer-review/SKILL.md
- plugin/skills/arch-layer-review/references/goal-030-example-output.json
- plugin/skills/arch-layer-review/references/archguard-selfreview-example-output.json
- .agents/skills/arch-layer-review/SKILL.md
- .agents/skills/arch-layer-review/references/goal-030-example-output.json
- .agents/skills/arch-layer-review/references/archguard-selfreview-example-output.json
- .claude/skills/arch-layer-review/SKILL.md
- .claude/skills/arch-layer-review/references/goal-030-example-output.json
- .claude/skills/arch-layer-review/references/archguard-selfreview-example-output.json
- plugin/.claude-plugin/plugin.json
- tests/unit/packaging/plugin-package.test.ts
- tests/unit/skills/arch-layer-review-skill.test.ts
- tasks/gap-arch-layer-review-plugin-registration.md