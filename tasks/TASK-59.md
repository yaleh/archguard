---
id: TASK-59
title: "TASK-59: 边界清单 B 类逐模块稳定覆盖（分支密集纯函数）"
status: todo
labels:
  - test-coverage
parent: null
extra:
  schema: v1
---
# TASK-59: 边界清单 B 类逐模块稳定覆盖（分支密集纯函数）

status: todo

## Summary

TASK-58 按外层方向裁定关闭（coverage 百分比不是目标——全量口径 lines 44.85% 与基线持平，
29 个测试文件仅 +0.5pp；「unit-only 80%」是 scoped+exclude 的测量 artifact）。替代目标是
**边界清单**（`tasks/TASK-58.md` 交付物）：按分层判据逐模块判断哪些边界值得稳定。本任务
承接 **B 类（分支密集纯函数 → 直接 import 单测）剩余项**，逐模块补测试，**不设全局百分比目标**。

## 前置条件

**TASK-58 done**（边界清单已落盘）。参考 `tasks/TASK-58.md` 的边界清单 B 类与 Progress
（29 个测试文件已合并，哪些已覆盖、哪些剩余一目了然）。

## 任务

按边界清单 B 类剩余项逐模块（各自判断，不要为全局 % 凑数）：
1. **kotlin 插件**：`src/plugins/kotlin/*-extractor.ts`、`*-mapper.ts`、`index.ts`——分支密集
   （agent 已覆盖 java/python/cpp/typescript/golang，kotlin 未覆盖）。
2. **plugin shared / wasm-parity**：`src/plugins/shared/`、wasm 回退逻辑——可选加速器路径的
   分支判断。
3. **parser extractors**：`src/parser/*-extractor.ts`——树遍历分支密集。
4. **大体积 graph-builders**：`capability-graph-builder.ts`（2683 行）、`flow-graph-builder.ts`
   （2550 行）——分支密集，直接 import 单测。
5. **core generator 深层分支**：`src/mermaid/generator.ts` 及主生成路径。
6. **analysis/**：fitness rules、cognitive 分析等纯函数（按分支密度判断是否值得）。

每模块：直接 import 目标函数写单测（`tests/unit/` 对应路径），跑选中集绿后再并。**不要**为
某文件硬凑覆盖——边界清单 C 类（types.ts 系、内部 plumbing）明确不测。

## Touches

- `tests/unit/plugins/kotlin/**`
- `tests/unit/parser/**`
- `tests/unit/mermaid/**`（generator 主路径）
- `tests/unit/plugins/shared/**`
- `tests/unit/analysis/**`
- 可能 `src/**`（若测出真实缺陷需修）

## Contract

| Key | Value |
|---|---|
| measure | `npx vitest run --coverage <选中文件>` 的逐文件 % Lines；**最终以全量 CI（`npm run test:coverage`）为权威** |
| band | 边界清单 B 类剩余模块逐一有直接 import 单测（存在性 + 覆盖关键分支），**非全局 % 目标** |
| invariant | `timeout 600 npm test; echo $?` exit 0 且 0 failed；`npm run type-check; echo $?` exit 0；`npm run lint; echo $?` 0 errors |
| invoke | 每模块先跑该文件选中集（秒级），全量交 CI |
| control | 若某模块加测试后全量聚合 % 几乎不变（TASK-58 的教训：+0.5pp）——**正常**，边界稳定不以 % 衡量；不要为此改 exclude 刷数字（TASK-58 control） |
| resume | 每模块完成即落盘数字到本任务 Progress；被打断可从缺口续跑 |

## 验证

```
grep -E "tests/unit/plugins/kotlin|tests/unit/parser"  # 边界清单 B 类剩余模块有测试
timeout 600 npm test; echo $?   # 0 failed, exit 0
# 最终：CI full suite 绿（阈值 40 回归闸门不因本任务变红）
```

## Progress

- **Module 1a — atlas builders / capability-graph-builder.ts**（393 行，原 0 测试）
  - `tests/unit/plugins/golang/atlas/builders/capability-graph-builder.test.ts`（17 tests）
  - 覆盖分支：空数据；interface/struct 节点构建 + exported fieldCount；precomputed
    implementations → implements edge；last-path-segment resolveNodeId 回退；interface-centric
    过滤（drop unreferenced struct）；uses edge（unqualified / import-map module-relative /
    external skip / no-import qualifier fallback / pointer/slice/map/qualified normalize）；
    edge 去重；full-mode hotspot（methodCount≥11 加 isHotspotAdded）；已引用高 fanIn 不重复
    flag；complex-package hotspot pass（minPackageStructs 触发）；interface-mode 不跑 hotspot；
    concrete usage risks（跨包收集 / 同包不报）。
  - 选中集绿（17/17）；对抗自查 2 轮：改 `mc >= 11`→12 抓到 1 fail、改 filter 条件抓到 3 fail。
  - 注：fi>5 分支对「已引用 struct」实际不可达（isHotspotAdded 只标记新加入节点），已按真实行为钉住。

- **Module 1b — atlas builders / flow-graph-builder.ts**（597 行，原 0 测试）
  - `tests/unit/plugins/golang/atlas/builders/flow-graph-builder.test.ts`（23 tests）
  - 覆盖分支：空图；net/http HandleFunc；gin GET/Any（httpMethod 映射）；gorilla/mux
    receiverContains（absent-skip 与 present-mismatch 两向）；grpc methodSuffix（含负例
    RegisterClient 不匹配）；main() 注入；method body 入口；generic-heuristic 回退
    （AddTool）；manual entry points；entryPointPattern 扫描 + 无效正则 never-match；
    protocol 过滤；direct call chain 追踪；interface 分类（receiver 变量解析 + * 剥前缀 +
    shortName）；无 packageName → direct；noisy 过滤（builtin/stdlib/w./ctx./r.URL）；
    BFS followIndirectCalls（maxDepth/visited 去重）；空 handler → 空 calls；method handler 追踪。
  - 选中集绿（23/23）；对抗自查 2 轮：methodSuffix 破坏抓到负例 fail、stdlib noisy 破坏抓到 fail。

- **Module 1c — atlas builders / goroutine-topology-builder.ts + package-graph-builder.ts**
  （387/138 行，原 0 测试）
  - `tests/unit/plugins/golang/atlas/builders/goroutine-topology-builder.test.ts`（13 tests）
    - 覆盖：空图；main 节点注入；named/anonymous spawned 节点 + go-stmt/go-func 边；
      method body 里的 goroutine；channel make 提取；make+recv channel edges；lifecycle
      （anonymous→orphan、cross-package not-found→orphan、context.Context 参数 + ctx.Done
      →mechanism=context、stop-channel receive→mechanism=channel、无检查→orphan、
      body 未提取→cancellationCheckAvailable=false）。
  - `tests/unit/plugins/golang/atlas/builders/package-graph-builder.test.ts`（7 tests）
    - 覆盖：节点构建 + stats；package 类型分类（tests/examples/testutil/cmd/vendor/internal）；
      边构建跳过 std + 重复 import 聚合 strength；外部依赖 edge 丢弃；DFS 环检测
      （两包环 / 自环 / 无环）。
  - 选中集绿（20/20）；对抗自查 2 轮：环检测破坏抓到 2 fail、tests/ 分类破坏抓到 1 fail。

- **Module 2 — plugin shared / wasm-parity**（原 0 测试的 native-parser-backend + plugin-factory + parser-backend env 分支）
  - `tests/unit/plugins/shared/native-parser-backend.test.ts`（20 tests）
    - 覆盖：nativeGrammarModule 映射；readNativeModuleRootEnv（unset/empty/configured）；
      real Go/Python 解析走 ParserSession facade；重复 parse/dispose 幂等；dispose 后 parse
      抛 disposed；loader 失败 → ParserInitializationError；grammar 失败 → error 且 parser.delete()
      被调；tree.dispose → tree.delete()；session.dispose → parser.delete()（幂等）；
      defaultNativeLoaders 可注入。
  - `tests/unit/plugins/shared/plugin-factory.test.ts`（5 tests）
    - 覆盖：createLanguagePlugin 各语言 switch（go/java/python/cpp/kotlin）构造正确 plugin
      类 + selectParserBackendFor 调用透传（mock backend 注入，不依赖 native probe）。
  - `tests/unit/plugins/shared/native-parser-backend.test.ts` 内 `resolveParserBackend`（legacy 全局 API）
    分支补齐：默认 native；RUNTIME=native/wasm/auto(忽略)/invalid 抛错；BACKEND 别名仅当
    RUNTIME unset 时生效；invalid BACKEND 抛错。
  - 选中集绿（25/25）；对抗自查：dispose guard 破坏抓到 1 fail。
  - 注：wasm-parser-backend.ts 已有 TASK-38/39 测试（真实 WASM 解析、assets 缺失错误、缓存、
    cwd 无关）；syntax-tree.ts 为纯类型（C 类不测）。

- **Module 3 — parser extractors**（已覆盖 94-100% stmts；补齐 call-edge-extractor 分支缺口）
  - 现状：`src/parser/` 19 个测试文件 315 tests 全绿。extractor 们 stmts 94-100%、branch
    71-100%（call-edge 71% 为最低）。`index.ts` 纯 re-export（C 类）、`parse-worker.ts` 仅 worker
    线程内运行（内部 plumbing，worker-pool 测试已覆盖调用路径）、`parse.ts` 是 experiments fixture。
  - `tests/unit/parser/call-edge-extractor.test.ts` +5 tests（9 total）
    - 覆盖缺口分支：interface-typed receiver → callType='interface' confidence=0.6；abstract
      （无 body）method 跳过；非 property-access 调用跳过；anonymous class 跳过。
    - 注：`nameToEntityId.get(targetClass) ?? targetClass` 回退分支实际不可达（两 map 由同一
      entities 数组构建，name 在 Set 必在 Map）——死代码，不硬测（与 capability fanIn>5 同理）。
  - 选中集绿（9/9）；对抗自查：interface callType 破坏抓到 1 fail。

## Dispatch review

| Field | Value |
|---|---|
| reviewer | inner（自建，TASK-58 边界清单交付物派生） |
| at | 2026-08-03T23:08Z |
| changed | — |
