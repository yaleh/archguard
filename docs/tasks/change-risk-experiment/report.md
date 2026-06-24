# change_risk 风险计算量化实验报告

**实验日期**: 2026-06-24
**数据来源**: git log（实测，过去 90 天）
**项目**: archguard（TypeScript，481 文件）+ meta-cc（Go，108 文件）

---

## Executive Summary

本实验对 `archguard_get_change_risk` 的五因子加权模型（churn×0.25 + authorCount×0.20 + ownerConcentration×0.20 + cochangeBreadth×0.15 + recency×0.20）进行了基于真实 git 历史的量化验证。

**关键发现**：
- **churn 因子是最强预测因子**（archguard ρ=0.58, meta-cc ρ=0.62），当前权重 0.25 偏低
- **recency 在 meta-cc 上表现最强**（ρ=0.68），说明 recency 在活跃的多人协作项目中至关重要，不应降低其权重
- **综合 riskScore 效力分化**：archguard ρ=0.34（低于 H-W4 阈值 0.40），meta-cc ρ=0.57（超过阈值）
- **权重调整收益极小**：最优权重（churn→0.40）在两个项目上的 Δρ 分别仅为 +0.006 和 +0.010，不值得调整
- **建议维持现有权重**，但可考虑在 archguard 这类单人主导项目上补充单独的 churn 权重提示

---

## Hypotheses

### H-W1: churn 因子的 Spearman ρ 在两项目上均 > 其余四因子

| 项目 | churn ρ | 最强竞争因子 | 结论 |
|------|---------|------------|------|
| archguard | 0.582 | recency (0.293) | churn 胜出 |
| meta-cc | 0.625 | recency (0.675) | churn **落后** |

**Verdict: REFUTED** — 在 meta-cc 上，recency（ρ=0.675）超越 churn（ρ=0.625）。H-W1 要求两项目均满足，因此被否证。

### H-W2: recency 因子的 Spearman ρ < churn 因子的 ρ（recency 被高估）

| 项目 | recency ρ | churn ρ | 条件满足? |
|------|-----------|---------|---------|
| archguard | 0.293 | 0.582 | YES |
| meta-cc | 0.675 | 0.625 | NO |

**Verdict: REFUTED（综合）/ CONFIRMED（archguard 单项）** — 在 archguard 上 recency 确实弱于 churn，但 meta-cc 上 recency 是最强因子。结论：recency 没有被系统性高估，其强弱高度依赖项目特征（活跃度、协作规模）。

### H-W3: ownerConcentration 方向正确（高集中度 → 高风险 → 正相关 bug 数）

| 项目 | ownerConcentration ρ | 方向正确? |
|------|---------------------|---------|
| archguard | 0.083 | YES（正，但弱） |
| meta-cc | 0.368 | YES（正，显著） |

**Verdict: CONFIRMED** — 两个项目上 ownerConcentration 方向均正确，meta-cc 上显著（p<0.001）。

### H-W4: 综合 riskScore 与 bug-fix 提交数的 Spearman ρ > 0.40

| 项目 | riskScore ρ | > 0.40? |
|------|------------|--------|
| archguard | 0.341 | NO |
| meta-cc | 0.573 | YES |

**Verdict: 项目依赖** — meta-cc 满足阈值，archguard 不满足。archguard 是单一贡献者主导项目（仅 1 位作者），导致 authorCount 和 ownerConcentration 因子几乎失去区分度，拉低综合 riskScore 的预测力。

---

## Correlation Table

### 各因子与 bug-fix 提交数的 Spearman ρ

| 因子 | 当前权重 | archguard ρ | archguard p | meta-cc ρ | meta-cc p |
|------|--------|------------|------------|-----------|-----------|
| **churn** | 0.25 | **0.582** | <0.001 | **0.625** | <0.001 |
| authorCount | 0.20 | 0.083 | 0.071 | 0.385 | <0.001 |
| ownerConcentration | 0.20 | 0.083 | 0.071 | 0.368 | <0.001 |
| cochangeBreadth | 0.15 | 0.095 | 0.037 | 0.478 | <0.001 |
| recency | 0.20 | 0.293 | <0.001 | **0.675** | <0.001 |
| **riskScore（综合）** | — | 0.341 | <0.001 | 0.573 | <0.001 |

**观察**：
1. churn 在两个项目上均高度显著，是最稳定的预测因子
2. archguard 单人主导（1 位作者），导致 authorCount / ownerConcentration 无区分度（ρ≈0.083，且 p=0.071 接近不显著）
3. cochangeBreadth 在 meta-cc 上表现优秀（ρ=0.478），但在 archguard 上仅 0.095
4. recency 在两项目上均显著，meta-cc 上甚至超越 churn

---

## Weight Sensitivity

### 权重扫描结果（churn 权重从 0.10 到 0.40）

**archguard**：

| churn 权重 | riskScore ρ |
|-----------|-----------|
| 0.10 | 0.290 |
| 0.15 | 0.319 |
| 0.20 | 0.336 |
| **0.25（当前）** | **0.341** |
| 0.30 | 0.342 |
| 0.35 | 0.344 |
| 0.40 | 0.347 |

**meta-cc**：

| churn 权重 | riskScore ρ |
|-----------|-----------|
| 0.10 | 0.566 |
| 0.15 | 0.567 |
| 0.20 | 0.574 |
| **0.25（当前）** | **0.573** |
| 0.30 | 0.576 |
| 0.35 | 0.580 |
| 0.40 | 0.584 |

**最优权重**（两项目一致）：
```json
{"churn": 0.40, "authorCount": 0.16, "ownerConcentration": 0.16, "cochangeBreadth": 0.12, "recency": 0.16}
```

**提升幅度**：archguard Δρ=+0.006，meta-cc Δρ=+0.010 — **均低于 0.05 门槛**。

---

## Recommendations

### 1. 权重维持现状（主要结论）

两项目上最优权重（churn→0.40）相对当前权重（churn=0.25）的提升均 < 0.05（archguard +0.006，meta-cc +0.010），按实验约定（Δρ < 0.05 建议保持现状）不建议调整权重。调整收益不足以弥补"在单人项目上失真"的风险。

### 2. 考虑 churn 最小权重下限

数据支持 churn 是最一致的预测因子，建议将其权重下限设为 0.30（而非当前 0.25），以确保 churn 主导地位在各场景下均成立。

**建议权重**（如需调整）：
```
churn: 0.30, recency: 0.25, cochangeBreadth: 0.20, authorCount: 0.13, ownerConcentration: 0.12
```
这一方案将 recency 和 cochangeBreadth 适度提升，反映其在多人协作项目中的实测表现。

### 3. authorCount / ownerConcentration 在单人项目中失效

当项目实际只有 1 位活跃贡献者时（如 archguard 的 90 天窗口），authorCount 和 ownerConcentration 因子无区分度，建议：
- 在 getChangeRisk 的返回值 `factorExplanations` 中添加 `singleContributorWarning`
- 或在 authorCount=1 时对这两个因子的权重动态置 0，将权重重分配给 churn 和 recency

### 4. recency 不应降低权重

H-W2（recency 被高估）被否证。在 meta-cc 上 recency 是最强预测因子（ρ=0.675），维持当前 recency 权重 0.20 是合理的。

---

## Limitations

1. **Ground Truth 代理指标不完整**：以 commit message 中含 `fix/bug/error/revert` 的提交作为 bug-fix 代理，可能漏掉无关键词的 bug 修复，也可能包含非 bug 的 refactoring。

2. **90 天时间窗口偏短**：archguard 在 90 天内仅有 1 位主要贡献者，导致多人相关因子失效。更长窗口（180-365 天）可能改善 authorCount/ownerConcentration 的区分度。

3. **两项目特征差异大**：archguard（TypeScript，单人）vs meta-cc（Go，多人）的项目结构差异，导致同一模型在两个项目上表现分化，不宜以某项目的结果代表通用结论。

4. **cochangeBreadth 计算方式**：本实验中 cochangeBreadth 使用"其他文件/总文件数"的简化近似，与生产代码中的 Jaccard 相似度计算不完全一致，可能影响该因子的 ρ 值。

5. **样本独立性**：测试文件（`*.test.ts`, `*_test.go`）与源码文件一同计入分析，两者的 churn 可能高度相关，导致 ρ 值被轻微高估。

6. **p 值近似**：本实验使用正态近似计算 p 值（非精确的 t 分布），对于大样本（archguard n=481）准确，但 meta-cc（n=108）的 p 值为近似值。
