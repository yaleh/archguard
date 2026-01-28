# Mermaid vs ELK 布局算法分析

## 问题现状

### 当前 ELK 实验结果
- **关系线数量**: 37 条（包括无意义的泛型类型节点）
- **混乱程度**: 高
- **主要问题**:
  1. 跨长距离连线（从右下到左上）
  2. 多线汇聚到同一节点
  3. 大量交叉

### 示例混乱连线
```xml
<!-- 跨越长距离 -->
<line x1="1476.25" y1="332" x2="72" y2="62" .../>
<!-- 从 Cache_Management namespace 到顶部的泛型节点 -->

<!-- 多线汇聚 -->
<line x1="1114.25" y1="935" x2="492" y2="62" .../>
<line x1="1114.25" y1="1055" x2="492" y2="62" .../>
<line x1="1114.25" y1="695" x2="492" y2="62" .../>
<line x1="1114.25" y1="815" x2="492" y2="62" .../>
<!-- 4 条线都从 Configuration namespace 连接到同一个泛型节点 -->
```

## 根本原因分析

### 1. Mermaid 的布局策略

**算法**: Dagre（Directed Graph Layout）
- **目标**: 最小化边交叉，保持边的方向一致（从上到下）
- **特点**:
  - 使用分层算法（Layered Graph Drawing）
  - 自动处理边的方向（通过 dummy nodes 处理长边）
  - 考虑边的 rank（层级）
  - 最小化交叉点

**关键配置**:
```javascript
{
  rankdir: 'TB',        // Top to Bottom
  nodesep: 50,          // 节点间距
  ranksep: 50,          // 层级间距
  edgesep: 10,          // 边间距
  // 还有大量的启发式算法来减少交叉
}
```

### 2. 当前 ELK 实验的配置

**算法**: Layered（与 Mermaid 相同）
```typescript
{
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.aspectRatio': '1.5',      // ⚠️ 强制宽高比
  'elk.spacing.nodeNode': '50',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
}
```

### 3. 问题识别

#### A. aspectRatio 的副作用
```typescript
'elk.aspectRatio': '1.5'  // 强制宽高比 1.5:1
```

**问题**: aspectRatio 优先级高于其他布局优化
- ELK 为了达到目标宽高比，可能会牺牲：
  - 边的最小化
  - 层级的合理性
  - 节点的相对位置

**结果**: 节点被"挤压"到满足宽高比，导致边变长和交叉

#### B. 无意义节点的干扰
```mermaid
CacheManager --> T           // 泛型占位符
ConfigLoader --> z_infer     // 泛型占位符
ConfigLoader --> _Type_      // 泛型占位符
FileError *-- _read_         // 内部类型
```

**问题**: 这些节点没有实际的业务意义，但参与了布局计算
- 占据宝贵的布局空间（顶部 y=12-100）
- 吸引大量连线（33 条关系中有相当数量连到这些节点）
- 打乱了正常的类间关系层次

#### C. 缺少边路由优化

**当前**: 使用直线连接
```xml
<line x1="1476.25" y1="332" x2="72" y2="62" .../>
```

**Mermaid 的做法**: Orthogonal routing（直角路由）
```typescript
// 边经过多个中间点，避免交叉
edge: [source] -> [mid1] -> [mid2] -> [target]
```

## Mermaid 布局逻辑分析

### Mermaid Class Diagram 的布局策略

根据 Mermaid 源码和 Dagre 文档：

#### 1. 节点分组处理
```javascript
// Namespace 中的节点会被分组
if (node.namespace) {
  group = node.namespace
  // 同一 namespace 的节点会被优先放在一起
}
```

#### 2. 层级分配
```javascript
// 计算每个节点的层级（rank）
rank[node] = longest_path_rank(node)

// 考虑边的方向
for (edge in edges) {
  if (edge.source.rank >= edge.target.rank) {
    // 添加 dummy nodes 来保持方向
    edge.source.rank < edge.target.rank
  }
}
```

#### 3. 交叉最小化
```javascript
// 使用 Barycenter heuristic
for (iteration in max_iterations) {
  for (layer in layers) {
    // 计算每个节点的 barycenter
    barycenter = sum(neighbor_positions) / degree
    
    // 按 barycenter 排序
    layer.nodes.sort(by_barycenter)
  }
}
```

#### 4. 边路由
```javascript
// 使用 orthogonal routing（直角）
if (edge.long) {
  // 添加拐点
  edge.points = [
    source,
    {x: source.x, y: mid_y},
    {x: target.x, y: mid_y},
    target
  ]
}
```

### Mermaid 的优势

1. **边方向性**: 严格保持从上到下（或从左到右）
2. **Dummy nodes**: 长边会被打断，避免跨层连接
3. **边路由**: 使用正交路由，避免直线交叉
4. **启发式优化**: 多轮迭代优化节点位置

## ELK 改进建议

### 方案 A: 移除 aspectRatio 约束（优先推荐）

**原理**: 让 ELK 自然布局，不受宽高比限制

```typescript
const layoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  // ❌ 移除 'elk.aspectRatio': '1.5',
  'elk.spacing.nodeNode': '50',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  
  // ✅ 增强交叉最小化
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.crossingMinimization.semiInteractive': 'true',
  'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
  
  // ✅ 边路由优化
  'elk.edgeRouting': 'ORTHOGONAL',  // 正交路由，减少交叉
  'elk.layered.edgeRouting.orthogonalEdges': 'true',
}
```

**预期效果**:
- ✅ 边长更短
- ✅ 交叉更少
- ⚠️ 宽高比可能不受控（但可以后续裁剪）

### 方案 B: 过滤无意义节点

**原理**: 移除泛型占位符节点，只保留有业务意义的类

```typescript
// 在解析阶段过滤
function filterMeaningfulNodes(entities: Entity[]): Entity[] {
  const meaninglessPatterns = [
    /^T$/,                   // 泛型 T
    /^_.*_$/,               // 内部类型 _read_, _Type_
    /^z_infer$/,            // Zod 内部类型
    /^.+~.+~$/,            // Promise~T~ 这种
  ];
  
  return entities.filter(e => 
    !meaninglessPatterns.some(p => p.test(e.name))
  );
}

// 同时过滤相关的关系
function filterMeaningfulRelations(relations: Relation[]): Relation[] {
  const meaningfulNodes = new Set(meaningfulEntities.map(e => e.id));
  
  return relations.filter(r =>
    meaningfulNodes.has(r.source) && meaningfulNodes.has(r.target)
  );
}
```

**预期效果**:
- ✅ 节点数从 29 → 20-25
- ✅ 关系数从 33 → 20-25
- ✅ 布局更清晰，无干扰节点

### 方案 C: 改进边路由（高级）

**原理**: 使用 ELK 的高级边路由功能

```typescript
const layoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  
  // ✅ 边路由策略
  'elk.edgeRouting': 'SPLINES',         // 使用曲线而非直线
  // 或 'elk.edgeRouting': 'ORTHOGONAL', // 使用正交线
  
  // ✅ 边的优先级
  'elk.separateConnectedComponents': 'true',
  
  // ✅ 减少交叉
  'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
  'elk.layered.cycleBreaking.strategy': 'GREEDY',
}
```

**预期效果**:
- ✅ 边使用曲线或正交线，视觉上更清晰
- ✅ 交叉更容易识别（曲线不会重叠）
- ⚠️ 计算时间增加

### 方案 D: 分层布局策略（推荐）

**原理**: 分别在每个 namespace 内部布局，然后排列 namespace

```typescript
// 1. 先在每个 namespace 内部布局
for (const ns of namespaces) {
  const nsLayout = await layoutELK(ns.entities, {
    'elk.algorithm': 'layered',
    'elk.direction': 'DOWN',
    // 不使用 aspectRatio
  });
  
  // 2. 提取 namespace 的边界框
  ns.boundingBox = calculateBoundingBox(nsLayout);
}

// 3. 使用另一个 layouter 排列 namespace
const namespaceLayout = await layoutELK(namespaces, {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.aspectRatio': '1.5',  // 只在这个层面使用
});

// 4. 合并坐标
for (const ns of namespaces) {
  ns.children.forEach(child => {
    child.x = ns.x + child.localX;
    child.y = ns.y + child.localY;
  });
}
```

**预期效果**:
- ✅ Namespace 内部布局最优
- ✅ Namespace 之间布局合理
- ✅ 整体宽高比可控
- ⚠️ 实现复杂度高

## 推荐方案

### 短期（立即实施）

**组合方案**: 方案 A + 方案 B

```typescript
// 1. 过滤无意义节点
const meaningfulData = filterMeaningfulNodes(archjson);

// 2. 移除 aspectRatio，使用自然布局
const layoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  // ❌ 不设置 aspectRatio
  
  'elk.spacing.nodeNode': '50',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  
  // 边路由优化
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.edgeRouting.orthogonalEdges': 'true',
  
  // 交叉最小化
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.crossingMinimization.semiInteractive': 'true',
};
```

### 中期（实验验证）

**方案 D 的简化版本**: 双层布局

1. **第一层**: Namespace 内部布局（不受 aspectRatio 约束）
2. **第二层**: Namespace 之间布局（应用 aspectRatio）

### 长期（生产级）

**完整实现**: 
1. 方案 D（双层布局）
2. 方案 C（高级边路由）
3. 智能节点过滤（配置化）
4. 交互式边路由编辑

## 对比表

| 方案 | 实现难度 | 预期效果 | 计算时间 | 推荐度 |
|------|---------|---------|---------|--------|
| A: 移除 aspectRatio | ⭐ | ⭐⭐⭐ | 快 | ⭐⭐⭐⭐⭐ |
| B: 过滤无意义节点 | ⭐⭐ | ⭐⭐⭐⭐ | 快 | ⭐⭐⭐⭐⭐ |
| C: 改进边路由 | ⭐⭐⭐ | ⭐⭐⭐ | 中等 | ⭐⭐⭐ |
| D: 分层布局 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 慢 | ⭐⭐⭐⭐ |

## 结论

**当前问题的根本原因**:
1. **aspectRatio 约束过强** - 牺牲了布局质量
2. **无意义节点干扰** - 占据空间，吸引连线
3. **直线边路由** - 容易交叉，视觉混乱

**立即可行的改进**:
1. ✅ 移除 `elk.aspectRatio` 约束
2. ✅ 过滤泛型占位符节点（T, z_infer, _Type_ 等）
3. ✅ 启用正交边路由 `elk.edgeRouting: 'ORTHOGONAL'`

**最佳方案**:
- 先实施方案 A + B（简单，效果好）
- 如果需要，再实施方案 D（复杂，效果最好）

---

*分析完成，等待确认后再实施修改*
