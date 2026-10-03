---
id: gap-verify-module-graph-edge-completeness
title: 阶段 0/1 验收补回：moduleGraph 边集合完整性 + type-only/值拆分 的真实对照
status: ready
labels:
  - gap
  - verification
  - typescript
  - architecture
parent: null
children: []
extra:
  schema: execution
---
## Proposal

A4 层检查提案（`docs/proposals/proposal-architecture-layer-check.md`）的正确性整体依赖"moduleGraph 边集合完整"（重导出、动态 `import()`、裸 `@/` 别名解析）与"type-only/值依赖拆分正确"。对应两个 gap 任务已 done，但其 AC 是修前树写的、只验证了各自缺口。在把检查器内核（阶段 2）建在其上之前，补一组独立的真实对照：(a) 用独立的位置判定扫描（按行首 `import/export … from` 语句，含 `export * from`、动态 `import()`、裸 `@/` 别名按 tsconfig paths 解析）与 `extensions.tsAnalysis.moduleGraph.edges` 对账，统计 moduleGraph 漏边与多报边，目标漏边=0（或逐条归因）；(b) 对每条边校验 `strength === typeOnlyStrength + valueStrength`，并用独立扫描的 isTypeOnly 判定与边的拆分对账。范围限 TS、限 archguard 自身与 quay 两个真实项目。

## AC

- [ ] 新增独立对账脚本（不读 moduleGraph，自己按位置扫描源文件），对 archguard 自身输出漏边/多报边清单
- [ ] (a) archguard 自身：moduleGraph 相对独立扫描漏边为 0；若有偏差逐条给出归因（可接受的有明确理由，如外部包边）
- [ ] (b) 每条边满足 `strength === typeOnlyStrength + valueStrength`，且 type-only 判定与独立扫描一致
- [ ] 在 quay 项目上重复 (a)(b) 并留档结果
- [ ] 结论写入 proposal 的阶段 0/1 行或单独验证记录，供阶段 2 引用

## DoD

不是脚本跑通就算完成：必须在 archguard 自身与 quay 两个真实项目上产出可复读的对账结果（漏边数、多报数、不一致边清单），并据此明确回答"阶段 0/1 的产物是否足以支撑阶段 2 的检查器"；若发现新的漏边，须立新 gap 任务而不是本任务内顺手修。

## Touches

- docs/experiments/layer-map/verify-edge-completeness.mjs
- docs/proposals/proposal-architecture-layer-check.md
- tasks/gap-verify-module-graph-edge-completeness.md