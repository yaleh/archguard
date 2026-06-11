# 执行预算 + 协议预注册 (Stage 67.4)

**日期**: 2026-06-11

## 被试决定

- **主实验被试**: ArchGuard (`src/mermaid` + `src/parser` 范围)
- **泄漏探针结果**: 两模型均 PASS（F1=0.000），ArchGuard 可作为评分被试
- **私有库复制臂**: 无（泄漏探针通过，无需私有库替代）
- **§0 I9 语言约束**: 被试为 TypeScript 项目，callgraph.ts 原生支持

## 边数口径 (§0 I6)

- 边集口径: `kind='call'`（375 条）
- `reference` 边（1 条）不计入 B 类任务 GT
- B 类任务答案依赖此口径（已落盘于 b-class-tasks.json 头部注释）

## FDR 策略预注册 (§0 I4)

- **B 系列**: 7 个决策相关检验，采用 Benjamini-Hochberg FDR 控制（q=0.05）
- **A 系列**: 3 个检验（A1/A2/A3），独立 α=0.05
- **Phase 0 门控**: 3 个 KW 检验，独立 α=0.05（不参与 B 系列 FDR 池）

## A1 配对单元预注册 (§0 I7)

- 配对单元 = 每道题的 F1 值（题目级 Wilcoxon）
- 与 A3 bootstrap 重采样单元一致

## 执行预算估算

| 项目 | 估算 | 说明 |
|---|---|---|
| S-lm-real 嵌入 | ~1002 次 | 6 层级 × 167 锚点（真名，无缓存命中）|
| S-code 嵌入 | ~1002 次 | 全新，无缓存 |
| S-struct 嵌入 | 0 次 API | 本地 node2vec，零 API 调用 |
| LLM 任务（全量）| ~1800-2400 次 | 68 题 × k=5 × 2 模型 × 平均 3-4 层级 |
| LLM 任务（A 类仅，Phase 0 失败时）| ~600-800 次 | 25 题 × k=5 × 2 模型 × 平均 3 层级 |
| **总 API 调用上界（全量）** | **~4400 次** | |

## S-code 可用性预确认

待 Phase 70.2 执行时验证（在线检查）。回退链: nomic-embed-text → mxbai-embed-large → text-embedding-3-small。

## § 0 I1-I9 全部处置状态

| 问题 | 状态 |
|---|---|
| I1: S-struct 节点粒度 | ✅ 已选方案 α（method 节点全集，L0 不可估计）|
| I2: node2vec 未声明 | ✅ requirements.txt 已添加 node2vec==0.4.6 |
| I3: 泄漏探针阈值 | ✅ F1≥0.5，两模型均 PASS（F1=0.000）|
| I4: FDR 预注册 | ✅ 已落盘（见上）|
| I5: 执行预算 | ✅ 已落盘（见上）|
| I6: 375 vs 376 歧义 | ✅ 已确认 375 call 边，1 reference 边不计入 |
| I7: A1 配对单元 | ✅ 题目级 Wilcoxon，已落盘 |
| I8: L4 分块策略 | ✅ 实测 14,081 tokens ≤ 32k，无需分块 |
| I9: 私有库语言约束 | ✅ ArchGuard 为 TypeScript，callgraph.ts 原生支持 |
