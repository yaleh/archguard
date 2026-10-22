---
id: gap-break-plugin-shared-hub-cycle
title: src/plugins/shared 作为 hub 反向依赖具体语言插件，形成 13 模块 package 环（plugin-factory 放错层）
status: ready
labels:
  - gap
  - refactor
  - architecture
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（实测）**：archguard 自身 package 级环检测（`extensions.tsAnalysis.moduleGraph.cycles`，scope `8f71319d`，0.1.42）报一个 **13 模块、severity=error** 的 SCC，根因是 `src/plugins/shared` 这个 hub 反向依赖具体语言插件：

```
src/plugins/golang / golang/atlas / golang/builders / golang/atlas/builders / golang/atlas/renderers
src/plugins/cpp / cpp/builders / cpp/mappers
src/plugins/java / python / kotlin / kotlin/builders
src/plugins/shared          ← hub
```

环的两类边：
- `shared → concrete`：**全部**来自 `src/plugins/shared/plugin-factory.ts`（`await import('@/plugins/{golang,java,python,cpp,kotlin}/…')`，全仓 grep 确认 `shared/` 里只有这一个文件 import 具体插件）；
- `concrete → shared`：各插件 import `shared` 的 `mapper-utils` / `syntax-tree` / `parser-backend` / `capture-mapper` / `query-loader`（这是正当的低层依赖）。

**根因**：`plugin-factory` 是「按语言名构造插件」的接线逻辑，但它被放在 `shared/`（本意是 tree-sitter 共享底层设施）。现有 `tests/unit/architecture/plugin-construction-boundary.test.ts:12` 把 `FACTORY` 钉死为 `src/plugins/shared/plugin-factory.ts`，进一步固化了这个错误位置。接线逻辑不属于共享底层，把它放 shared 才制造了反向依赖。

**修复方向（按职责断环，不是搬家凑数）**：
1. 把 `plugin-factory.ts` 从 `src/plugins/shared/` 移到 `src/plugins/`（与 shared 及语言插件平级）；它的相对 import 相应改为 `./shared/parser-backend.js`、`./shared/parser-runtime.js`。
2. 更新两处引用：`src/cli/analyze/run-analysis.ts:42`、`src/cli/processors/arch-json-provider.ts:32` → `@/plugins/plugin-factory.js`。
3. 更新三处测试引用：`tests/plugins/plugin-factory/plugin-factory.test.ts:2`、`tests/unit/plugins/shared/plugin-factory.test.ts:11`、`tests/unit/architecture/plugin-construction-boundary.test.ts:12` 的 `FACTORY` 路径。
4. 新增一条**断环判据**（GOAL-910 式，改动前必须实跑为红）：`src/plugins/shared/**` 不得有对 `src/plugins/{golang,java,python,cpp,kotlin}/**` 的任何 import（含动态 `await import` 与相对路径）。用测试机械断言：扫描 `src/plugins/shared` 全部 `.ts`，命中 `@/plugins/(golang|java|python|cpp|kotlin)` 或相对路径指向这些目录即失败。
5. 保留「只有 factory 能构造插件」的既有边界：`plugin-construction-boundary.test.ts` 的 `FACTORY` 指向新路径，语义不变。

**明确边界**：本任务只断开 `shared ↔ 具体语言插件` 这个 hub 环。移动 factory 后残留的 golang/cpp/kotlin 各自**插件内部**小环（如 `golang ↔ golang/atlas`）是另一个问题，不在本任务范围，AC 不得要求它们消失。

## AC

- [ ] 断环判据先红后绿：新测试在改动前对当前 HEAD 运行，报告 `plugin-factory.ts` 的 5 条 concrete import 违规（红）；移动 factory 后同测试通过（绿），且不依赖 mock/跳过
- [ ] `src/plugins/shared/**` 在移动后对具体语言插件目录的 import 计数为 0（静态 import + 动态 `await import` + 相对路径三种形式都覆盖）
- [ ] `createLanguagePlugin` 的两个调用方（`run-analysis.ts`、`arch-json-provider.ts`）与三个测试文件全部改指向新路径，全仓 grep `shared/plugin-factory` 零命中
- [ ] 既有边界不变：`plugin-construction-boundary.test.ts` 仍只允许在 factory 内 `new XxxPlugin`，`FACTORY` 指向新路径后该测试保持绿
- [ ] 负对照（防搬家凑数）：把 factory 移到 `shared/` 外的任意位置后，`shared` 不得通过任何新 import 重新指回具体插件；测试明确断言的是「shared 对 concrete 的出边为 0」，而不是「factory 在某个特定路径」
- [ ] 真实数据：对 archguard 自身重跑 package 级分析，13 模块 SCC 不再包含 `src/plugins/shared`；给出修复前后的 SCC 成员清单对照（残留的 golang/cpp/kotlin 内部小环允许存在并列出，不作为失败条件）
- [ ] 明确边界：golang/cpp/kotlin 插件内部环不在本任务；不新增任何对 `core/parser` 的反向依赖
- [ ] `bash scripts/test.sh --for-task gap-break-plugin-shared-hub-cycle` 与 `npm run type-check` 通过

## DoD

不是「factory 文件挪个目录、import 改个路径」就算完成。要在改动前先跑一遍新断环判据证明它红（抓到 5 条 concrete import），改动后同判据绿；再用 archguard 分析自身，给出修复前后的 package SCC 成员清单，证明 `src/plugins/shared` 已从 13 模块环里退出；同时确认「只有 factory 能构造插件」的既有边界测试仍绿，且没有通过新增别的 shared→concrete import 来偷换。

## Touches

- tasks/gap-break-plugin-shared-hub-cycle.md
- src/plugins/plugin-factory.ts
- src/plugins/shared/plugin-factory.ts
- src/cli/analyze/run-analysis.ts
- src/cli/processors/arch-json-provider.ts
- tests/unit/architecture/plugin-construction-boundary.test.ts
- tests/plugins/plugin-factory/plugin-factory.test.ts
- tests/unit/plugins/shared/plugin-factory.test.ts
