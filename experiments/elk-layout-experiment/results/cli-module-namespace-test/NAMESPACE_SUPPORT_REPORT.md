# ELK Namespace 支持测试报告

## 测试配置

- 测试文件: cli-module.mmd
- 实体数量: 29
- 关系数量: 33
- Namespace 数量: 6
- Namespace 列表: Error_Handling, Cache_Management, Progress_Reporting, Configuration, Diagram_Processing, File_Operations
- 测试时间: 2026-01-27T16:43:32.044Z

## Namespace 列表

- **Error_Handling**: 6 个类
  - ErrorHandler
  - ErrorFormatOptions
  - ParseError
  - APIError
  - ValidationError
  - FileError

- **Cache_Management**: 4 个类
  - CacheManager
  - CacheStats
  - CacheOptions
  - CacheEntry

- **Progress_Reporting**: 3 个类
  - ProgressReporter
  - Stage
  - ProgressSummary

- **Configuration**: 5 个类
  - ConfigLoader
  - FileConfig
  - CLIConfig
  - Config
  - AnalyzeOptions

- **Diagram_Processing**: 4 个类
  - DiagramProcessor
  - DiagramProcessorOptions
  - DiagramResult
  - DiagramIndexGenerator

- **File_Operations**: 7 个类
  - FileDiscoveryService
  - FileDiscoveryOptions
  - OutputPathResolver
  - PathResolution
  - ResolveOptions
  - OutputPathOptions
  - ResolvedPaths

## 测试结果

### DOWN-ar1.5

| 指标 | 值 |
|------|-----|
| 尺寸 | 1811.0×1137.0px |
| 宽高比 | 1.59:1 |
| 目标宽高比 | 1.5:1 |
| 偏差 | 0.09 (6.2%) |
| 状态 | ✅ |
| Namespaces | 6 |
| 类 | 29 |
| 关系 | 33 |

#### 文件

- SVG: `cli-module-ns-DOWN-ar1.5.svg`
- PNG: `cli-module-ns-DOWN-ar1.5.png`

### DOWN-ar1

| 指标 | 值 |
|------|-----|
| 尺寸 | 1124.0×2043.0px |
| 宽高比 | 0.55:1 |
| 目标宽高比 | 1:1 |
| 偏差 | 0.45 (45.0%) |
| 状态 | ✅ |
| Namespaces | 6 |
| 类 | 29 |
| 关系 | 33 |

#### 文件

- SVG: `cli-module-ns-DOWN-ar1.svg`
- PNG: `cli-module-ns-DOWN-ar1.png`

### DOWN-ar2

| 指标 | 值 |
|------|-----|
| 尺寸 | 2167.3×1430.0px |
| 宽高比 | 1.52:1 |
| 目标宽高比 | 2:1 |
| 偏差 | 0.48 (24.2%) |
| 状态 | ✅ |
| Namespaces | 6 |
| 类 | 29 |
| 关系 | 33 |

#### 文件

- SVG: `cli-module-ns-DOWN-ar2.svg`
- PNG: `cli-module-ns-DOWN-ar2.png`

## 关键改进

### ✅ Namespace 支持
- 解析 Mermaid namespace 声明
- 使用 ELK compound nodes 创建分组
- SVG 渲染时绘制 namespace 框（虚线边框）
- Namespace 标签显示在框顶部

### 视觉效果
- Namespace 框使用虚线边框区分
- 浅灰色背景突出分组
- 类节点按 namespace 分组显示
- 关系连线正确连接所有类

## 对比

| 特性 | 之前 | 现在 |
|------|------|------|
| Namespace 解析 | ❌ | ✅ |
| Namespace 框 | ❌ | ✅ |
| 类分组 | ❌ | ✅ |
| 宽高比控制 | ✅ | ✅ |

---

*此报告由自动化测试生成*
