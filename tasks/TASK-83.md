---
id: TASK-83
title: "TASK-83: `.archguard` 输出布局契约对齐——CLAUDE.md flat 记载 vs 实测 output/ 嵌套"
status: ready
labels:
  - defect
  - docs
parent: null
children: []
extra: {}
---
# TASK-83: `.archguard` 输出布局契约对齐——CLAUDE.md flat 记载 vs 实测 output/ 嵌套

## Proposal

TASK-81 实测 analyze 输出为 `.archguard/output/index.md` + `.archguard/output/<source>/overview/package.*`
（`output/` 嵌套 + 源名字空间）；CLAUDE.md 第 162-163 行记载 `.archguard/`（index.md 平铺于根）。
判定该 `output/` 嵌套是**有意的多源命名空间**还是**回归（契约破坏）**，然后对齐文档与行为——
不静默。

- **若为意图**（多源/`-s` 场景需要名字空间）：更新 CLAUDE.md 使其准确描述实际布局。
- **若为回归**（历史契约是 flat，`output/` 是意外引入）：修 `analyze` 输出路径逻辑 + 回归测试，
  恢复文档记载的布局。

## Acceptance Criteria

- [x] 实跑 analyze 确认精确输出布局：单源自动检测、多源 config、`-s` 外部项目、`--output-dir` 四种路径各出什么
- [x] 判定意图 vs 回归（给证据：设计意图 / 代码路径 / 历史行为）
- [x] 意图 ⇒ 更新 CLAUDE.md 文档使其与实际一致；回归 ⇒ 修代码 + 覆盖测试
- [x] lint-clean；若改文档无测试需求；若改代码需测试绿
- [x] 不破坏 `.archguard/` gitignore 约定与 TASK-81 已落地的自分析证据

## Touches

- `CLAUDE.md`（输出布局描述；仅当意图）
- `src/cli/commands/analyze.ts`（输出路径逻辑；仅当回归）
- `tasks/TASK-83.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | 文档记载布局 vs 实测布局 逐项一致（四路径） |
| band | 无 discrepancy；判定有证据（意图 or 回归） |
| invariant | `.archguard/` gitignore 约定不破；TASK-81 自分析产物不受影响 |
| invoke | worktree 内 `node dist/cli/index.js analyze -v`（及 `-s` / `--output-dir` 变体）+ `grep -n '\.archguard/' CLAUDE.md` |
| control | 撤掉改动 ⇒ 布局 discrepancy 复现（负控制） |
| resume | 从「实跑四种路径确认布局」续 |

## Definition of Done

- [x] 文档与行为一致（改文档或改代码二者其一，皆有证据）— 意图 ⇒ 改 CLAUDE.md
- [x] 判定理由落盘（意图 / 回归 + 依据）
- [x] lint-clean（改代码时测试绿）— 仅改文档，无测试需求；lint 0 errors / type-check 0

## Evidence (2026-08-11, outer dispatch tick)

**四路径实跑（worktree `task-83`，`npm ci` + `npm run build`）**：

| 路径 | 实测输出布局 | 名字空间 |
|---|---|---|
| 1. 单源自动检测（无 `-s`） | `.archguard/output/index.md` + `.archguard/output/<project-basename>/overview/package.*` | 项目 basename（`task-83/`）+ 多语言 scope（`python-python/` `java-java/` `go-go/` `task-83-cpp/` `task-83-kotlin/`） |
| 2. 多源 config | `.archguard/output/<config-diagram-name>/overview/package.*` | config 的 `name` 字段（`frontend/` `parser/`） |
| 3. `-s` 外部项目（CWD 外） | `<project>/.archguard/output/...` | 项目自有 `.archguard`；单图模式平铺于 output 根（`architecture.mmd`） |
| 4. `--output-dir <dir>` | `<dir>/index.md` + `<dir>/<basename>/overview/package.*` | 无 `output/` 嵌套——文件直接写于指定目录 |

**判定：意图（intent），非回归。依据：**
1. **代码路径**：`src/cli/config-loader.ts:144` — `outputDir` 默认值 `'./.archguard/output'`（Zod 明确默认）。`src/cli/analyze/run-analysis.ts:139` — `outputDir = config.outputDir || path.join(workDir, 'output')`。`output/` 嵌套是**刻意的默认值**。
2. **历史行为**：该默认自分析管线首个提交 `3f4da52a`（`feat(cli): add analysis pipeline`）即存在，非近期回归。
3. **设计意图**：名字空间（label = 项目 basename / config `name` / source basename）服务于**多源/多语言区分**（`default-scope-planner.ts`、`normalize-to-diagrams.ts`）；`.archguard/` 下 `cache/`、`query/`、`metrics-history.jsonl` 与 `output/` 分离，output 是图表产物区。
4. **`--output-dir` 是可选的 flat 逃生口**：显式指定时绕过 `output/` 嵌套，文件平铺于指定目录——文档记载的 flat 布局作为**用户可选项**仍存在。

**对齐动作（意图 ⇒ 改文档）**：更新 `CLAUDE.md`——
- 第 162-163 行（Output Formats）：改为 `.archguard/output/<project>/`（TS 3-tier + Go Atlas 4-layer）+ `index.md` 在 `.archguard/output/index.md`；新增「默认 outputDir = `.archguard/output`，每源一个 `<source>` 名字空间，`--output-dir` 覆盖为平铺」说明。
- 第 127 行（`--output-dir` help）：默认值 `./.archguard/` → `./.archguard/output`，注明设置后文件直接写于 `<dir>`。
- 第 123 行（`-s` 外部项目 → `<project>/.archguard`）已准确，未改。

**负控制**：撤掉 CLAUDE.md 改动 ⇒ 文档仍记载 `.archguard/` flat、与实测 `.archguard/output/` 不符——discrepancy 复现（本任务判定前即处于该状态）。

**TASK-81 证据核对**：`.archguard/` gitignore 约定未动（gitignore:58 `/.archguard/`）；TASK-81 自分析产物（`.archguard/output/task-81/overview/package.*`）布局与本文档对齐。默认 `analyze -v` 在还原仓库自有 `archguard.config.json`（exclude experiments/scripts/dist）后 **exit 0**（package 图 303 edges < 500 mermaid 上限）——与 TASK-81 的 exit-0 证据一致。（执行期一度出现 521-edge render 失败，已核实为测试期误删 tracked `archguard.config.json` 所致，还原后消失；非仓库回归。）
