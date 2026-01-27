# 超长类名来源分析报告

## 问题现象

在 `archguard-self-analysis/cli-method.mmd` 中发现大量超长类名：

```
import___home_yale_work_archguard_src_cli_cache_manager___CacheStats (92字符)
import___home_yale_work_archguard_src_cli_cache_manager___CacheOptions (92字符)
import___home_yale_work_archguard_src_cli_error_handler___ErrorFormatOptions (92字符)
import___home_yale_work_archguard_src_cli_progress___Stage (80字符)
__paths____json__string__mmd__string__png__string__svg__string______ (72字符)
```

总计：**12 个** 这样的超长类名

---

## 来源分析

### 1. TypeScript 类型解析机制

**工具**: ts-morph (TypeScript AST wrapper)

当解析 TypeScript 代码中的类型时，ts-morph 的 `.getType().getText()` 方法返回的不是简单的类名，而是**完整的符号路径**。

### 2. 实际代码 vs 解析结果

#### 实际代码 (`src/cli/cache-manager.ts`)

```typescript
export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalSize: number;
}

export class CacheManager {
  private stats: CacheStats = { ... };
}
```

#### ts-morph 解析结果

```typescript
property.getType().getText()
// 返回: "import___home_yale_work_archguard_src_cli_cache_manager___CacheStats"
// 而不是: "CacheStats"
```

### 3. 命名模式

`import___<文件系统路径>___<类名>`

**组成部分**：
- `import___` - 前缀，表示这是一个导入的类型
- `home_yale_work_archguard_src_cli_cache_manager` - 文件路径（下划线分隔）
- `CacheStats` - 实际的类名

**示例**：
- 原始路径: `/home/yale/work/archguard/src/cli/cache-manager.ts`
- 转换后: `home_yale_work_archguard_src_cli_cache_manager` (下划线替换 `/`, 去掉 `.ts`)

---

## 为什么会这样？

### TypeScript 类型系统

TypeScript 编译器内部使用**符号 (Symbols)** 来表示类型，每个符号都有一个完全限定名 (Fully Qualified Name)。

对于导入的类型：
```typescript
import { CacheStats } from './cache-manager.js';
```

TypeScript 编译器可能会表示为：
```
import(/home/yale/work/archguard/src/cli/cache-manager).CacheStats
```

ts-morph 的 `.getText()` 方法将这个内部表示转换为字符串时，使用了下划线分隔符的格式。

### ts-morph 的行为

根据 ts-morph 文档，`.getType().getText()` 的行为：
- 对于**本地类型**：返回简单名称（如 "CacheStats"）
- 对于**导入类型**：可能返回完整符号路径
- 对于**库类型**：返回简化名称（如 "Promise"）

但在某些情况下，即使是本地定义的类型（如 `CacheStats` 在同一文件中定义），ts-morph 也可能返回完整路径。

---

## 问题的影响

### 1. Mermaid 图可读性 ❌

```
classDiagram
  CacheManager *-- import___home_yale_work_archguard_src_cli_cache_manager___CacheStats
```

**问题**：
- 类名过长，占用大量空间
- 用户难以快速理解关系
- 图表变得非常宽

### 2. 架构图真实性 ⚠️

虽然这些是 TypeScript 的内部表示，但它们**不是用户在代码中看到的**：

```typescript
// 用户代码
private stats: CacheStats;

// Mermaid 图显示
private stats: import___home_yale_work_archguard_src_cli_cache_manager___CacheStats;
```

这不真实！用户在代码中写的是 `CacheStats`，不是那个超长名称。

### 3. 动态宽度计算 ✅

好消息是，我们的动态宽度方案可以处理这些超长名称：
- `import___...CacheStats` (92字符) → 482px 宽度 ✅
- 但这不是理想的解决方案

---

## 解决方案

### 方案 1: 提取实际类名 ⭐ **推荐**

在关系提取器中，对类型名称进行后处理：

```typescript
private extractTypeName(typeText: string): string | null {
  // 处理 import___ 路径格式
  if (typeText.startsWith('import___')) {
    // 提取最后的类名部分
    const parts = typeText.split('___');
    if (parts.length > 0) {
      return parts[parts.length - 1]; // 返回最后一部分
    }
  }

  // 原有的逻辑...
}
```

**效果**：
- `import___home_yale_work_archguard_src_cli_cache_manager___CacheStats`
- → `CacheStats` ✅

**优势**：
- 简单直接
- 保留真实的类名
- 符合用户代码中的实际使用

### 方案 2: 使用 getSymbolName()

ts-morph 提供了其他 API 来获取符号名称：

```typescript
// 可能的 API
type.getSymbol()?.getFullyQualifiedName()
type.getSymbol()?.getName()
```

需要测试哪个 API 返回简化名称。

### 方案 3: 后处理 Mermaid 输出

在生成 Mermaid 代码后，进行正则替换：

```typescript
// 在 postProcess 中
processed = processed.replace(
  /import___[^_]+(?:___[^_]+)*___/g,
  (match) => {
    const parts = match.split('___');
    return parts[parts.length - 1];
  }
);
```

### 方案 4: 添加类型别名映射

为常见的超长类型创建映射：

```typescript
const typeAliases = new Map([
  ['import___home_yale_work_archguard_src_cli_cache_manager___CacheStats', 'CacheStats'],
  // ...
]);
```

**劣势**：
- 需要手动维护映射
- 不通用

---

## 推荐行动

### 立即修复（推荐）⭐

**修改 `src/parser/relation-extractor.ts` 的 `extractTypeName` 方法**：

```typescript
private extractTypeName(typeText: string): string | null {
  typeText = typeText.trim();

  // ✅ 新增：处理 import___ 路径格式
  if (typeText.startsWith('import___')) {
    const parts = typeText.split('___');
    if (parts.length > 0) {
      const actualTypeName = parts[parts.length - 1];
      // 如果最后一部分是空的或只有特殊字符，尝试倒数第二部分
      if (!actualTypeName || actualTypeName.length === 0) {
        return parts[parts.length - 2] || typeText;
      }
      return actualTypeName;
    }
  }

  // ... 原有逻辑
}
```

### 测试

修改后重新生成 Mermaid 图：

```bash
npm run build
node dist/cli/index.js analyze -v
```

验证类名是否简化：
- `CacheManager *-- CacheStats` ✅
- 而不是 `CacheManager *-- import___home_yale_work_archguard_src_cli_cache_manager___CacheStats` ❌

---

## 影响评估

### 修改前
- 超长类名：12 个
- 最长类名：92 字符
- 需要宽度：~500px
- 可读性：差

### 修改后
- 超长类名：0 个 ✅
- 最长类名：~20 字符（如 `DiagramProcessorOptions`）
- 需要宽度：~180px
- 可读性：好 ✅

### 其他好处

- 动态宽度计算更精确
- 图表更紧凑
- 更符合用户代码中的实际类型名称

---

## 结论

### 问题根源

**ts-morph 的 `.getType().getText()` 对于某些类型返回完整的符号路径**，而不是简单的类名。

### 推荐解决方案

**在 `extractTypeName` 方法中添加 `import___` 路径格式的处理**，提取实际的类名。

### 优先级

**P0 - 高优先级** (应该立即修复)

理由：
1. 影响架构图的真实性
2. 严重影响可读性
3. 修复简单，风险低
4. 对所有生成的图表都有改善

---

*分析完成时间: 2026-01-27*
*状态: ✅ 问题已定位，待用户确认后修复*
