# 类大小自适应问题 - 改进方案

## 问题描述

### 当前问题

1. **固定宽度**: 所有节点宽度都是 200px，不考虑内容长度
2. **文字溢出**: 长类名（80-100字符）超出 200px 方框
3. **空白浪费**: 短类名（如 "Ora", "Error"）在 200px 方框中有很多空白
4. **高度自适应**: 高度已经根据内容计算，但宽度没有

### 问题示例

**超长的类名** (应需要 800-1000px 宽度):
```
import___home_yale_work_archguard_src_cli_cache_manager___CacheStats  (92字符)
import___home_yale_work_archguard_src_cli_error_handler___ErrorFormatOptions  (92字符)
__paths____json__string__mmd__string__png__string__svg__string______  (72字符)
```

**很短的类名** (只需要 80-100px 宽度):
```
Ora      (3字符)
Error    (5字符)
T        (1字符)
Config   (6字符)
```

**当前**: 都用 200px 宽度 ❌

---

## 改进方案

### 方案 1: 动态计算节点宽度 ⭐ **推荐**

#### 实现思路

根据内容的最大宽度动态计算每个节点的宽度：

```typescript
function calculateNodeWidth(
  className: string,
  fields: Array<{name: string; type: string}>,
  methods: Array<{name: string; params?: string}>,
  fontSize: number = 10,
  padding: number = 16
): number {
  // 1. 计算类名宽度
  const classNameWidth = className.length * fontSize * 0.6;

  // 2. 计算最长的属性宽度
  const maxFieldWidth = fields.reduce((max, field) => {
    const text = `${field.visibility} ${field.name}: ${field.type}`;
    return Math.max(max, text.length * fontSize * 0.55);
  }, 0);

  // 3. 计算最长的方法宽度
  const maxMethodWidth = methods.reduce((max, method) => {
    const text = `${method.visibility} ${method.name}(${method.params || ''})`;
    // 如果超长则截断（显示时）
    const displayText = text.length > 35 ? text.substring(0, 32) + '...' : text;
    return Math.max(max, displayText.length * fontSize * 0.55);
  }, 0);

  // 4. 取最大值
  const maxContentWidth = Math.max(classNameWidth, maxFieldWidth, maxMethodWidth);

  // 5. 加上 padding，并设置最小/最大宽度限制
  const minWidth = 120;
  const maxWidth = 600;  // 防止极端情况

  return Math.max(minWidth, Math.min(maxWidth, maxContentWidth + padding * 2));
}
```

#### 在 `archjson-elk.ts` 中使用

```typescript
children: allNodes.map((entity) => {
  // 计算节点高度（现有代码）
  const nodeHeight = calculateNodeHeight(entity);

  // ✅ 新增：动态计算节点宽度
  const nodeWidth = calculateNodeWidth(
    entity.name,
    entity.fields || [],
    entity.methods || []
  );

  return {
    id: entity.name,
    labels: [{ text: entity.name }],
    width: nodeWidth,  // ✅ 动态宽度
    height: nodeHeight,
    // ...
  };
})
```

#### 优势

- ✅ 完全适应内容
- ✅ 避免文字溢出
- ✅ 减少空白浪费
- ✅ 提升可读性

#### 劣势

- ⚠️ 节点宽度不一致，可能不如固定宽度整齐
- ⚠️ 需要额外的计算

---

### 方案 2: 文本截断 + 工具提示

#### 实现思路

对于超长的类名，在显示时截断，但提供完整信息的工具提示：

```typescript
function truncateText(text: string, maxWidth: number): string {
  // 估算：每个字符约 6-7px
  const maxChars = Math.floor(maxWidth / 7);

  if (text.length <= maxChars) {
    return text;
  }

  // 截断并添加省略号
  return text.substring(0, maxChars - 3) + '...';
}

// 在 SVG 中使用
const displayName = truncateText(entity.name, 180);  // 留 20px padding
const fullName = entity.name;  // 完整名称用于 title

<rect ... />
<text>${displayName}</text>
<title>${fullName}</title>  <!-- 鼠标悬停时显示完整名称 -->
```

#### 优势

- ✅ 保持固定宽度，布局整齐
- ✅ 避免文字溢出
- ✅ 用户可以通过悬停查看完整信息

#### 劣势

- ❌ 需要用户交互才能看到完整信息
- ❌ 不如直接显示直观

---

### 方案 3: 智能缩短类名

#### 实现思路

对于超长的类名，智能缩短显示：

```typescript
function shortenClassName(className: string): string {
  // 如果类名包含 import___路径，提取最后的实际类名
  const importMatch = className.match(/import___[^_]+(?:___([^_]+))$/);
  if (importMatch) {
    return importMatch[1];  // 返回最后的类名部分
  }

  // 如果是编码的类型（如 __paths____json__...），尝试简化
  if (className.startsWith('__') && className.endsWith('__')) {
    return '[Type]';  // 显示为通用类型标记
  }

  // 其他情况：如果超过 30 字符，截断中间部分
  if (className.length > 30) {
    return className.substring(0, 15) + '...' + className.substring(className.length - 10);
  }

  return className;
}
```

#### 示例

| 原始类名 | 缩短后 |
|---------|--------|
| `import___home_yale_work_archguard_src_cli_cache_manager___CacheStats` | `CacheStats` |
| `__paths____json__string__mmd__string__png__string__svg__string______` | `[Type]` |
| `DiagramProcessor` | `DiagramProcessor` |

#### 优势

- ✅ 大幅缩短超长类名
- ✅ 保持可读性
- ✅ 减少所需宽度

#### 劣势

- ❌ 丢失信息（用户看不到完整路径）
- ❌ 可能混淆（多个不同路径的同类名会显示相同）

---

### 方案 4: 分层显示（组合方案）

#### 实现思路

**结合方案 1 + 方案 2 + 方案 3**：

```typescript
// 1. 先智能缩短类名
const displayName = shortenClassName(entity.name);

// 2. 计算缩短后的宽度
const nodeWidth = calculateNodeWidth(
  displayName,
  entity.fields || [],
  entity.methods || []
);

// 3. 如果仍然太长，在显示时截断
const finalDisplayWidth = Math.min(nodeWidth, 400);

// 4. 添加工具提示显示完整信息
return {
  id: entity.name,
  labels: [{ text: displayName }],
  width: finalDisplayWidth,
  properties: {
    fullName: entity.name,  // 用于工具提示
    // ...
  }
};
```

#### 优势

- ✅ 结合所有方案的优点
- ✅ 最大灵活性
- ✅ 最好的用户体验

#### 劣势

- ⚠️ 实现复杂
- ⚠️ 需要更多配置选项

---

## 推荐方案

### 短期（快速改进）: 方案 1 + 方案 3

```typescript
function calculateOptimalNodeWidth(entity): number {
  // 1. 智能缩短类名
  const displayName = shortenClassName(entity.name);

  // 2. 动态计算宽度
  const width = calculateNodeWidth(
    displayName,
    entity.fields || [],
    entity.methods || []
  );

  // 3. 设置合理范围
  return Math.max(120, Math.min(500, width));
}
```

**预期效果**:
- `CacheStats`: 140px（之前 200px，节省 30%）
- `import___...CacheStats`: 180px（缩短为 `CacheStats`，节省 10%）
- `CacheManager`: 220px（方法较多，略宽于之前）

### 长期（完美方案）: 方案 4

实现完整的自适应宽度 + 工具提示 + 智能缩短。

---

## 其他改进建议

### 1. 方法签名格式化

当前方法签名单行显示，可能导致很长：

```typescript
// 当前（可能很长）
+ async computeFileHash(filePath: string): Promise<string>

// 改进：多行显示或简化
+ async computeFileHash(file: string)
  : Promise<string>
```

### 2. 字体大小自适应

对于内容很多的节点，可以适当减小字体：

```typescript
const fontSize = entity.methods.length > 15 ? 9 : 10;
```

### 3. 最小/最大宽度约束

```typescript
const minWidth = 120;   // 最小宽度（如 "Ora"）
const maxWidth = 500;   // 最大宽度（防止极端情况）
```

### 4. 分组显示

对于超多内容的节点，考虑分组或折叠：

```typescript
if (entity.methods.length > 20) {
  // 显示前 15 个方法
  // 添加 "... + 5 more methods"
}
```

---

## 实现优先级

### P0（立即修复）
1. ✅ **动态计算节点宽度**（方案 1）
2. ✅ **智能缩短类名**（方案 3）

### P1（重要改进）
3. ⚠️ **添加工具提示**（方案 2）
4. ⚠️ **设置最大宽度限制**

### P2（锦上添花）
5. 💡 **字体大小自适应**
6. 💡 **方法签名格式化**
7. 💡 **分组/折叠显示**

---

## 下一步行动

### 选项 A: 快速修复（推荐）

实现 P0 改进：
1. 添加 `calculateOptimalNodeWidth()` 函数
2. 添加 `shortenClassName()` 函数
3. 修改 `archjsonToELK()` 使用动态宽度
4. 测试并对比效果

### 选项 B: 完整实现

实现所有 P0-P2 改进，获得最佳效果。

### 选项 C: 先测试再决定

创建一个对比实验：
- 固定宽度 200px（当前）
- 动态宽度（改进）
- 缩短类名 + 动态宽度
- 让您选择哪个效果最好

---

**请问您希望我先实现哪个方案？** 我建议先实现**选项 A（快速修复）**，包含方案 1 + 方案 3，立即改善问题。
