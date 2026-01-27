# ELK Namespace 坐标问题修复总结

## 问题描述

用户反馈：`cli-module-ns-DOWN-ar1.5.png` 中**大部分类都看不见了**。

### 问题原因

在 ELK compound node 结构中：
- **Namespace 节点**的坐标是**绝对坐标**（相对于画布）
- **Namespace 内的子节点**坐标是**相对坐标**（相对于父 namespace）

例如：
```
Namespace Cache_Management: (1350, 132)  ← 绝对坐标
  - CacheManager: (20, 150)              ← 相对于 namespace
  - CacheStats: (304.5, 20)              ← 相对于 namespace
```

### 错误代码

**之前的代码** (`svg-generator-with-namespace.ts`):
```typescript
// ❌ 错误：从子节点的相对坐标计算 namespace 边界
for (const child of children) {
  const x = child.x || 0;        // 相对坐标
  const y = child.y || 0;        // 相对坐标
  minX = Math.min(minX, x);      // 导致错误的边界
  minY = Math.min(minY, y);
}
// 结果：namespace 框被放置在 y=-20，超出可视区域
```

## 解决方案

### 1. 使用 ELK 计算的 Namespace 坐标

**修复后的代码**:
```typescript
// ✅ 正确：直接使用 ELK 计算的 namespace 节点位置和大小
for (const nsNode of namespaceNodes) {
  const x = nsNode.x || 0;           // ELK 提供的绝对坐标
  const y = nsNode.y || 0;
  const width = nsNode.width || 400;  // ELK 计算的大小
  const height = nsNode.height || 300;

  namespaceBounds.set(nsNode.id, { x, y, width, height });
}
```

### 2. 计算子节点的绝对坐标

**新增辅助函数**:
```typescript
function getAbsolutePosition(
  node: ExtendedElkNode,
  namespaceNodes: ExtendedElkNode[],
  nodeHeights: Map<string, number>
): { x: number; y: number; width: number; height: number } {
  // 检查节点是否在 namespace 内
  for (const ns of namespaceNodes) {
    if (ns.children && ns.children.some(child => child.id === node.id)) {
      // 节点在 namespace 内，加上 namespace 偏移量
      return {
        x: (ns.x || 0) + (node.x || 0),      // 绝对 x 坐标
        y: (ns.y || 0) + (node.y || 0),      // 绝对 y 坐标
        width: node.width || nodeWidth,
        height: nodeHeights.get(node.id) || 100
      };
    }
  }
  // 独立节点，直接使用坐标
  return {
    x: node.x || 0,
    y: node.y || 0,
    width: node.width || nodeWidth,
    height: nodeHeights.get(node.id) || 100
  };
}
```

### 3. 渲染所有节点

```typescript
// 渲染 namespace 内的节点 + 独立节点
const allClassNodes: ExtendedElkNode[] = [];
for (const ns of namespaceNodes) {
  if (ns.children) {
    allClassNodes.push(...ns.children);  // namespace 内的节点
  }
}
allClassNodes.push(...classNodes);  // 独立节点

for (const node of allClassNodes) {
  const pos = getAbsolutePosition(node, namespaceNodes, nodeHeights);
  // 使用 pos.x, pos.y（绝对坐标）渲染节点
}
```

## 修复验证

### 修复前
```xml
<!-- Namespace 框位置错误 -->
<rect x="0" y="-20" width="663.8" height="520" .../>
<!-- ❌ y=-20 超出可视区域（viewBox 从 0 开始）-->
```

### 修复后
```xml
<!-- Namespace 框位置正确 -->
<rect x="576.7" y="625" width="663.8" height="500" .../>
<text x="908.6" y="640">Error_Handling</text>

<!-- 类节点位置正确 -->
<rect x="755.5" y="660.4" width="212.5" height="100" .../>
<text x="861.75" y="678.4">ErrorHandler</text>
<!-- ✅ 755.5 = 576.7 + 178.8（namespace + 相对坐标）-->
```

## 验证结果

### Namespace 框（6 个）
| Namespace | 坐标 | 尺寸 | 状态 |
|-----------|------|------|------|
| Error_Handling | (576.7, 625) | 663.8×500 | ✅ |
| Cache_Management | (1350, 132) | 449×473 | ✅ |
| Progress_Reporting | (476.5, 132) | 376×473 | ✅ |
| Configuration | (12, 132) | 444.5×393 | ✅ |
| Diagram_Processing | (872.5, 132) | 457.5×392 | ✅ |
| File_Operations | (12, 625) | 544.7×437 | ✅ |

### 类节点（29 个）
- **所有类节点都正确显示在可视区域内**
- **坐标计算**: namespace 绝对坐标 + 子节点相对坐标
- **示例**:
  - ErrorHandler: (755.5, 660.4) = (576.7, 625) + (178.8, 35.4) ✅
  - CacheManager: (1370, 282) = (1350, 132) + (20, 150) ✅

### 文件对比
| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| 文件大小 | 35KB | 319KB |
| 可见类数 | 7-8 个 | 29+ 个 |
| Namespace 框 | 位置错误 | 位置正确 ✅ |
| 宽高比 | 1.59:1 | 1.59:1 |

## 关键代码变更

**文件**: `src/plan-b/svg-generator-with-namespace.ts`

1. **第 129-140 行**: 简化 namespace 边界计算
2. **第 185-246 行**: 添加节点查找和坐标转换函数
3. **第 248-266 行**: 渲染所有节点（namespace 内 + 独立）

## 经验教训

### ELK Compound Node 坐标系统
1. **父节点**: 绝对坐标（相对于画布原点）
2. **子节点**: 相对坐标（相对于父节点）
3. **渲染时**: 必须将相对坐标转换为绝对坐标

### 调试方法
```javascript
// 打印 ELK layout 前后的坐标
console.log('Namespace: (ns.x, ns.y)');
console.log('  Child: (child.x, child.y) - relative');
// 绝对坐标 = ns.x + child.x
```

## 结论

✅ **坐标问题已完全修复**
- 所有 6 个 namespace 框正确显示
- 所有 29 个类节点正确显示
- 宽高比控制保持 1.59:1（偏差 6.2%）
- 文件大小合理（319KB）

✅ **最佳效果文件**: `results/cli-module-namespace-test/cli-module-ns-DOWN-ar1.5.svg/png`

---

**修复时间**: 2026-01-27 16:43
**问题状态**: ✅ 已解决
