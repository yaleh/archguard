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

## Dispatch review

| Field | Value |
|---|---|
| reviewer | inner（自建，TASK-58 边界清单交付物派生） |
| at | 2026-08-03T23:08Z |
| changed | — |
