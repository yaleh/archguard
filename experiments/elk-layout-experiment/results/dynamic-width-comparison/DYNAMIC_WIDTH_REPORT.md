# 动态宽度实验报告

## 测试配置

- 测试文件: cli-method.mmd
- 测试时间: 2026-01-27T15:03:46.887Z
- 节点数: 29

## 生成的文件

- 动态宽度: `cli-method-DOWN-ar1.5-dynamic.svg` (3597.492307692308×2249px, 1.60:1)

## 宽度分析详情

### 统计摘要

| 分类 | 数量 | 百分比 |
|------|------|--------|
| 🔴 溢出 (>20%) | 0 | 0.0% |
| 🟢 节省 (>20%) | 15 | 51.7% |
| ⚪ 合适 (±20%) | 14 | 48.3% |

### 平均宽度

- 固定宽度: 200px
- 动态宽度: 166px
- 平均差异: -34px (-17.0%)

### Top 20 差异最大的节点

| 类名 | 字段 | 方法 | 固定 | 动态 | 差异 | 分类 |
|------|------|------|------|------|------|------|
| DiagramProcessor | 5 | 4 | 200px | 224px | +24px (12%) | ⚪ 合适 |
| CacheManager | 3 | 13 | 200px | 213px | +13px (6%) | ⚪ 合适 |
| ErrorHandler | 0 | 8 | 200px | 213px | +13px (6%) | ⚪ 合适 |
| ProgressReporter | 3 | 12 | 200px | 213px | +13px (6%) | ⚪ 合适 |
| ParseError | 0 | 1 | 200px | 213px | +13px (6%) | ⚪ 合适 |
| APIError | 0 | 1 | 200px | 213px | +13px (6%) | ⚪ 合适 |
| ValidationError | 0 | 1 | 200px | 213px | +13px (6%) | ⚪ 合适 |
| FileError | 0 | 1 | 200px | 213px | +13px (6%) | ⚪ 合适 |
| ConfigLoader | 1 | 8 | 200px | 213px | +13px (6%) | ⚪ 合适 |
| DiagramIndexGenerator | 0 | 6 | 200px | 213px | +13px (6%) | ⚪ 合适 |
| FileDiscoveryService | 0 | 2 | 200px | 213px | +13px (6%) | ⚪ 合适 |
| OutputPathResolver | 0 | 7 | 200px | 213px | +13px (6%) | ⚪ 合适 |
| ProgressSummary | 5 | 0 | 200px | 196px | -4px (-2%) | ⚪ 合适 |
| DiagramProcessorOptions | 3 | 0 | 200px | 174px | -26px (-13%) | ⚪ 合适 |
| FileDiscoveryOptions | 0 | 0 | 200px | 152px | -48px (-24%) | 🟢 节省 |
| ErrorFormatOptions | 0 | 0 | 200px | 139px | -61px (-31%) | 🟢 节省 |
| OutputPathOptions | 0 | 0 | 200px | 132px | -68px (-34%) | 🟢 节省 |
| CacheStats | 4 | 0 | 200px | 125px | -75px (-38%) | 🟢 节省 |
| CacheEntry | 3 | 0 | 200px | 125px | -75px (-38%) | 🟢 节省 |
| Config | 6 | 0 | 200px | 125px | -75px (-38%) | 🟢 节省 |

## 关键发现

### 可以缩小的节点 (15个)

这些节点的固定宽度 200px 浪费了大量空间，使用动态宽度可以节省空间。

示例：
- `FileDiscoveryOptions`: 200px → 152px (节省 24%)
- `ErrorFormatOptions`: 200px → 139px (节省 31%)
- `OutputPathOptions`: 200px → 132px (节省 34%)
- `CacheStats`: 200px → 125px (节省 38%)
- `CacheEntry`: 200px → 125px (节省 38%)

## 结论

✅ **动态宽度节省了空间**

15 个节点缩小了宽度，平均节省 37.3%。

总体而言，动态宽度提供了更精确的节点尺寸，改善了可读性和空间利用效率。

---

*此报告由自动化测试生成*
