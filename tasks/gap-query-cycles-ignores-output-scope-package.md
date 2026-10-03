---
id: gap-query-cycles-ignores-output-scope-package
title: CLI `query --cycles --output-scope package` 忽略 output-scope，对存在目录级环的树报"无环"
status: ready
labels:
  - gap
  - defect
  - cli
  - typescript
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`archguard_detect_cycles(outputScope=package)` 的同类缺陷已在 37005f9a 修复（MCP handler 改走 `engine.getPackageCycles()`，三态返回）。但 CLI `query` 的 `--cycles` 分支漏修：`src/cli/commands/query.ts:389-391` 直接 `engine.getCycles()`（实体级 `index.cycles`），完全无视 `opts.outputScope`（该 flag 在 :208 声明、:698 校验，却只在别处生效）。实测（2026-10-03 当前树）：`node dist/cli/index.js query --cycles --output-scope package` 打印 "No dependency cycles detected."，而对同一产物手工跑 Tarjan SCC 得到 4 个目录级 SCC（size 13/10/2/2）——"忽略 flag"与"已评估无环"再次同形，正是三态原则要消灭的形状。修复：`--cycles` 读 outputScope，package 时走 `getPackageCycles()` 并输出 `{granularity,evaluated,reason?,cycles}`；not-evaluated 时打印原因且退出码非 0。class 缺省行为保持不变。

## AC

- [x] `query.ts` 的 `--cycles` 分支读取 `opts.outputScope`，package 时调用 `engine.getPackageCycles()`，按三态输出
- [x] `tests/unit/cli/commands/query.test.ts` 新增成对用例：含目录级互指的夹具 package 返回非空 cycles；无 moduleGraph 返回 `evaluated:false` + 非空 reason；`npx vitest run tests/unit/cli/commands/query.test.ts` 退出码 0
- [x] 真实对照：对 archguard 自身 `query --cycles --output-scope package` 输出非空 cycles（当前树 4 个 SCC），修前同参数为 "No dependency cycles detected."
- [x] class 缺省调用返回与修前一致；type-check + 全量测试通过

## DoD

不是"handler 读了 outputScope"就算完成：必须在真实 TS 项目（archguard 自身）用修复后的构建真实调用 CLI，读到非空的目录级环（修前同参数无输出），确认 class 缺省输出与修前逐字一致，且有一个真实触发的 not-evaluated 样本（如 Go scope）。

## Touches

- src/cli/commands/query.ts
- tests/unit/cli/commands/query.test.ts
- tasks/gap-query-cycles-ignores-output-scope-package.md

## Evidence

验证于 e0b8d1aa（merge develop 之后的树），四条 AC 逐条复验：

- **AC1** `src/cli/commands/query.ts`：`--cycles` 分支读 `opts.outputScope`；`package` 走 `engine.getPackageCycles()` 输出 `{granularity,evaluated,reason?,cycles}`，`evaluated:false` 时 `process.exitCode = 1`（不 `process.exit`，保证 reason/JSON 先落盘）；`class` 缺省仍走原 `getCycles()`。
- **AC2** `npx vitest run tests/unit/cli/commands/query.test.ts` → 56 passed，exit 0。新增 `describe('query --cycles --output-scope package (Phase 101)')` 6 例，含成对用例：目录级互指夹具 → `evaluated:true` + 非空 cycles；无 moduleGraph → `evaluated:false` + 非空 reason + 非零退出码；class 缺省对照。
- **AC3** 真实对照，同一产物（worktree `.archguard/query`，globalScopeKey `58ec3adf`，833 entities）：
  - 修复后 `node dist/cli/index.js query --cycles --output-scope package` → `Found 4 directory-level dependency cycle(s)`，size 13/10/2/2，exit 0；
  - 修前构建（主检出 `dist`，已确认不含 `getPackageCycles`）同 cwd 同参数 → `No dependency cycles detected.`，exit 0。二者对同一输入给出完全不同的结论，正是本缺陷。
- **AC4** class 缺省 `query --cycles --format json` 修复前后输出逐字节相同（`diff` 为空）；`npm run type-check` 通过；`bash scripts/test.sh` 全量 → `372 passed | 3 skipped (375 files)`，`5470 passed | 18 skipped`，exit 0。

**真实 not-evaluated 样本（DoD 要求）**：`--scope 2ac2a376`（go 夹具 scope，无 `tsAnalysis.moduleGraph`）→ 文本 `Directory-level dependency cycles were not evaluated: no directory-level module graph for this scope (language: go; tsAnalysis.moduleGraph absent)`，JSON `{granularity:"package",evaluated:false,reason:"...",cycles:[]}`，exit 1；修前同参数为 `No dependency cycles detected.` + exit 0 —— "未评估"与"已评估无环"同形，正是三态原则要消灭的形状。

**环境说明（非代码改动）**：上一轮 doc-check/suite 变红与本修复无关，原因有二：(a) fan-in 的 doc-check 步骤执行 `bash <worktree>/scripts/test.sh --static-checks-doc`，而本仓 `scripts/test.sh` 对本协议 flag 不识别、落到全量 suite；(b) 该全量 suite 在本 worktree 内有 5 个 go/gopls 测试文件报 `Cannot find module '<worktree>/stream'`——vitest 3.2.4 `execute.*.js` 的 `normalizedDistDir.slice(root.length)`：worktree 根长度 53 时切出 `"st"`，使裸导入 `stream` 被误判为根相对 id 并外部化为 `file://<worktree>/stream`。触发前提是 worktree 的 `node_modules` 为指向主检出的符号链接（`normalizedDistDir` 不在根下）。处置：把该 worktree 的 `node_modules` 由符号链接换成真实目录（`cp -a`），`distDir` 因此落在根内，`relativeRoot` 恢复为 `/node_modules/vitest/dist`，5 个失败文件全部转绿。此项为 worktree 环境修复，未改动任何被 git 跟踪的文件。
