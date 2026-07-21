---
id: TASK-24
title: 'Refactor: split arch-metrics.ts by metric domain'
status: 'Basic: Backlog'
assignee: []
created_date: '2026-06-30 05:19'
updated_date: '2026-06-30 05:21'
labels:
  - 'kind:basic'
dependencies: []
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
拆分 src/core/query/arch-metrics.ts（583 行，全项目最大文件）为多个按指标域聚焦的模块（结构指标 / 质量指标 / 认知指标），防止 God Class 恶化。保持 core/query/index.ts 重导出兼容，不改变对外 API。
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: Refactor arch-metrics.ts by metric domain

## Background

`src/core/query/arch-metrics.ts` は現在 583 行で全プロジェクト最大のファイルであり、3 つの異なる指標ドメインを 1 つのクラスに同居させている：

1. **パッケージ統計**（~250 行）: `getPackageStats()` + `getKotlinPackageStats()` + プライベートヘルパー `aggregateEntityMetrics()` / `buildTestPattern()` — Go Atlas・TypeScript module graph・OO fallback・Kotlin の 4 パスを持つ最大の責務
2. **カバレッジ指標**（~100 行）: `getPackageCoverage()` + `getEntityCoverage()` — testAnalysis 拡張データを読み取るドメイン
3. **構造的結合指標**（~60 行）: `findHighCoupling()` / `findOrphans()` / `findInCycles()` + `getSummary()` — グラフ index を直接参照する軽量ドメイン

QueryEngine は `ArchMetrics` に委譲するだけの薄い調整レイヤーになっているが、`ArchMetrics` 自体は肥大化が進んでいる。新指標が追加されるたびに単一ファイルが成長し、God Class 化のリスクが高まっている。

## Goals

1. `arch-metrics.ts` を ≥3 の指標ドメイン別モジュールに分割し、各ファイルを ≤200 行に収める
2. `src/core/query/index.ts` の re-export を保持し、既存の import パスを一切変更しない
3. `npm test` が全て通過する（新規テスト失敗なし）

## Proposed Domain Split

| 新ファイル | 責務 | 移動するメソッド |
|---|---|---|
| `package-stats-metrics.ts` | パッケージ統計（4 パス） | `getPackageStats`, `getKotlinPackageStats`, `aggregateEntityMetrics`, `buildTestPattern` |
| `coverage-metrics.ts` | テストカバレッジ集計 | `getPackageCoverage`, `getEntityCoverage` |
| `arch-metrics.ts`（薄いコーディネーター） | サマリー + 構造結合 + 型定義 | `getSummary`, `findHighCoupling`, `findOrphans`, `findInCycles`, 型定義 |

`arch-metrics.ts` は削除せず薄いコーディネーターとして残す。`index.ts` の `export * from './arch-metrics.js'` は変更不要。

## Trade-offs and Risks

- 純粋な構造的リファクタリング：新機能・新指標は追加しない
- リスク: `aggregateEntityMetrics` と `buildTestPattern` は `getPackageStats` の 4 パス全てで使われるため、`package-stats-metrics.ts` 内に同梱するか、共通ヘルパーとして切り出す必要がある。循環 import を避けるため、ヘルパーの配置先を慎重に決定する
- `ArchMetrics` クラスを複数クラスに分割する場合、`QueryEngine` 内のインスタンス化コードも更新が必要（ただし public API は変わらない）

# Plan: Refactor arch-metrics.ts by metric domain

## Phase A: パッケージ統計モジュールの抽出

### Tests（先に書く）
- `tests/unit/core/query/package-stats-metrics.test.ts` を新規作成
- 既存 `arch-metrics.test.ts` の `ArchMetrics.getPackageStats` describe ブロックを新ファイルに複製・拡張
- Go Atlas / ts-module-graph / oo-fallback / kotlin の 4 パスをそれぞれ独立した it ブロックでカバー

### Implementation
- `src/core/query/package-stats-metrics.ts` を新規作成
- `getPackageStats()`, `getKotlinPackageStats()`, `aggregateEntityMetrics()`, `buildTestPattern()` を移動
- `arch-metrics.ts` から同メソッドを削除し、委譲または import に変更
- `index.ts` が引き続き `export * from './arch-metrics.js'` でカバーすることを確認

### DoD
- [ ] `npm test -- --run tests/unit/core/query/package-stats-metrics.test.ts`
- [ ] `wc -l src/core/query/package-stats-metrics.ts` が 200 行以内

## Phase B: カバレッジ指標モジュールの抽出

### Tests（先に書く）
- `tests/unit/core/query/coverage-metrics.test.ts` を新規作成
- 既存 `arch-metrics.test.ts` の `getPackageCoverage` / `getEntityCoverage` describe ブロックを新ファイルに複製・拡張

### Implementation
- `src/core/query/coverage-metrics.ts` を新規作成
- `getPackageCoverage()`, `getEntityCoverage()` を移動
- `arch-metrics.ts` からそれらを削除し import または委譲に変更

### DoD
- [ ] `npm test -- --run tests/unit/core/query/coverage-metrics.test.ts`
- [ ] `wc -l src/core/query/coverage-metrics.ts` が 150 行以内

## Phase C: arch-metrics.ts を薄いコーディネーターに整理

### Tests（先に書く）
- 既存 `arch-metrics.test.ts` がリファクタリング後も全て通過することを確認（修正のみ、新規テスト不要）

### Implementation
- `arch-metrics.ts` に残るのは: 型定義 (PackageStatEntry / PackageStatMeta / PackageStatsResult), `getSummary()`, `findHighCoupling()`, `findOrphans()`, `findInCycles()`, および Phase A/B モジュールへの委譲コード
- `arch-metrics.ts` が 200 行以内に収まることを確認
- `src/core/query/index.ts` の `export * from './arch-metrics.js'` は変更不要

### DoD
- [ ] `npm test -- --run tests/unit/core/query/`（全 core/query テスト通過）
- [ ] `wc -l src/core/query/arch-metrics.ts | awk '{if($1>200) exit 1}'`

## Constraints

- `query-engine.ts`、`arch-index-builder.ts` 等の呼び出し元コードは変更しない
- `src/core/query/index.ts` の re-export 行は変更しない（または最小限の調整）
- public API シグネチャを一切変更しない
- 新指標や新機能を追加しない

## Acceptance Gate

- [ ] `npm test`
- [ ] `npm run type-check`
- [ ] `npm run lint`
<!-- SECTION:PLAN:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npm test
- [ ] #2 npm run type-check
- [ ] #3 npm run lint
<!-- DOD:END -->
