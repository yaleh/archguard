# 可视化示例 - 当前问题 vs 改进方案

## 当前布局问题示意

### 问题 1: 长距离连线

```
┌─────────────────────────────────────────────────────────┐
│  T (72, 62)                                          │
│  z_infer (212, 62)                                   │
│  _Type_ (352, 62)                                    │
└─────────────────────────────────────────────────────────┘
                         ↑
                         │ 
           1400px 跨越（混乱）
                         │
                         ↓
┌─────────────────────────────────────────────────────────┐
│  CacheManager (1476, 332)                           │
│  - 位于 Cache_Management namespace                    │
└─────────────────────────────────────────────────────────┘
```

**问题**: 连线横跨整个画布，穿过所有中间内容

---

### 问题 2: 多线汇聚

```
Configuration namespace:
  ┌─────────────┐
  │ ParseError  │ ─┐
  └─────────────┘  │
  ┌─────────────┐  │
  │ APIError    │ ─┼─→ 汇聚到同一点
  └─────────────┘  │
  ┌─────────────┐  │
  │Valid...     │ ─┤
  └─────────────┘  │
  ┌─────────────┐  │
  │ FileError   │ ─┘
  └─────────────┘
                 │
                 ↓
          ┌──────────┐
          │ z_infer │
          └──────────┘
```

**问题**: 4 条线汇聚，像蜘蛛网

---

## 改进方案 A + B 效果示意

### 改进 1: 移除泛型节点

```
之前的 37 条关系线:
  - 10-15 条连到无意义节点 (T, z_infer, _Type_ 等)
  - 22-27 条有意义的类间关系

过滤后的 20-25 条关系线:
  - 只显示有意义的类间关系
  - 布局更清晰，逻辑更合理
```

---

### 改进 2: 移除 aspectRatio 约束

```
之前 (aspectRatio=1.5):
┌──────────────────────────────────────┐
│ Namespace 框被"挤压"到满足 1.5:1    │
│ 节点位置被迫迁就形状                │
│ 连线变长、交叉增多                  │
└──────────────────────────────────────┘

改进后 (无 aspectRatio 约束):
┌──────────────────────────────────────┐
│ 节点自然排列，优先考虑最短路径     │
│ 连线更短、交叉更少                  │
│ 布局更自然、更易读                  │
└──────────────────────────────────────┘
```

---

## 效果对比

### 当前状态
```xml
<!-- 混乱的连线 -->
<line x1="1476.25" y1="332" x2="72" y2="62"/>
<line x1="1114.25" y1="935" x2="492" y2="62"/>
<line x1="1114.25" y1="1055" x2="492" y2="62"/>
<line x1="1114.25" y1="695" x2="492" y2="62"/>
<!-- 总共 37 条线，大量交叉 -->
```

### 改进后（预期）
```xml
<!-- 清晰的连线 -->
<line x1="200" y1="150" x2="200" y2="250"/>
<line x1="200" y1="150" x2="400" y2="150"/>
<!-- 只显示 20-25 条有意义的类间关系 -->
<!-- 连线更短，交叉更少 -->
```

---

## 具体代码修改

### 修改 1: 过滤节点

**文件**: `src/plan-b/archjson-elk-with-namespace.ts`

```typescript
export function parseMermaidClassDiagram(mermaidCode: string): ArchJSON {
  // ... 现有解析逻辑 ...
  
  // ✅ 新增：过滤无意义节点
  const meaninglessNodes = new Set([
    'T',
    'z_infer', 
    '_Type_',
    '_read_',
    'Ora'
  ]);
  
  const filteredEntities = entities.filter(e => 
    !meaninglessNodes.has(e.name)
  );
  
  // ✅ 新增：过滤相关的关系
  const validEntityIds = new Set(filteredEntities.map(e => e.name));
  const filteredRelations = relations.filter(r =>
    validEntityIds.has(r.from) && validEntityIds.has(r.to)
  );
  
  return {
    entities: filteredEntities,
    relations: filteredRelations,
    namespaces: Array.from(namespaces)
  };
}
```

---

### 修改 2: 移除 aspectRatio

**文件**: `src/test-namespace-support.ts`

```typescript
// 之前的配置
const layoutOptions = {
  'elk.aspectRatio': '1.5',  // ❌ 删除这一行
  'elk.direction': 'DOWN',
  'elk.algorithm': 'layered',
  // ...
};

// 改进后的配置
const layoutOptions = {
  // ✅ 不设置 aspectRatio，让 ELK 自然布局
  'elk.direction': 'DOWN',
  'elk.algorithm': 'layered',
  'elk.spacing.nodeNode': '50',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
};
```

---

## 预期结果

### 数量对比

| 指标 | 当前 | 改进后 | 改进 |
|------|------|--------|------|
| 节点数 | 36 | 25-30 | -17% |
| 关系数 | 37 | 20-25 | -32% |
| 长距离连线 | 8-10 条 | 1-2 条 | -80% |
| 交叉点 | 15-20 | 3-5 | -75% |

### 质量对比

| 指标 | 当前 | 改进后 |
|------|------|--------|
| 可读性 | ⚠️ 差 | ✅ 优 |
| 逻辑清晰度 | ⚠️ 中 | ✅ 高 |
| 宽高比 | 1.59:1 | ~2.0:1 |
| 接近 Mermaid 程度 | 60% | 90% |

---

## 总结

**立即可做的改进** (方案 A + B):
1. ✅ 过滤 5-7 个无意义节点（T, z_infer 等）
2. ✅ 删除一行代码（aspectRatio 配置）
3. ✅ 预期改进 85%

**实施成本**: 5-10 分钟代码修改 + 2 分钟测试

**是否值得**: 是！关系线会大幅改善

---

*等待您的确认和反馈*
