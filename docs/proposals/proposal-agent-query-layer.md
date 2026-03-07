# Proposal: 面向代理的精准查询层

**状态**: Draft (rev 3)
**日期**: 2026-03-06
**关联**: [proposal-file-stats-and-cycle-expansion.md](./proposal-file-stats-and-cycle-expansion.md)

---

## 背景与动机

ArchGuard 现在的主路径仍然是批处理:

1. 解析源代码
2. 生成 ArchJSON
3. 聚合并渲染图表

这个流程适合 CI 和人工阅读产物，但不适合 Claude Code / Codex 这类处于编辑循环中的代理。代理真正需要的是:

- 精确找实体
- 看直接依赖和反向依赖
- 看接口实现者或类继承关系
- 看循环依赖参与者
- 快速定位到文件和行号

ArchJSON 已经包含这些问题的大部分结构化信息，但目前它只是渲染链路中的中间产物，没有被组织成稳定、可查询、可复用的工具层。

本 Proposal 的目标是把 ArchJSON 从“仅供渲染的中间数据”升级为“可持久化的查询数据源”，并为 CLI 与 MCP 暴露稳定接口。

---

## 现状与约束

### 现有缓存层

ArchGuard 已有两层缓存:

| 缓存 | 位置 | 粒度 | 生命周期 |
|------|------|------|----------|
| `ArchJsonDiskCache` | `<workDir>/cache/archjson` | 内容哈希 | 跨 analyze 调用 |
| `ParseCache` | 进程内 | 单文件内容 hash | 单次 analyze 会话 |

现有问题:

- `ArchJsonDiskCache` 的 key 是内容哈希，外部工具不可直接发现
- 原始 ArchJSON 没有约定式、可枚举的持久化位置
- 没有反向索引，查询“谁依赖了 X”只能扫描 `relations[]`

### 当前实现中的关键事实

这次评审后，设计前提需要先和代码对齐:

1. `DiagramProcessor` 内部缓存的是“按 source group 分组”的多个 raw ArchJSON，不存在天然唯一的“项目全量 ArchJSON”
2. Go Atlas 模式不是“空实体模式”；当前实现是在标准 Go `ArchJSON` 上附加 `extensions.goAtlas`
3. `ArchJSON.relations[]` 是实体级关系，不是成员级调用图
4. 默认目录语义是 `workDir=.archguard`、`outputDir=.archguard/output`

因此，本 Proposal 不再使用“挑一个 primary arch.json 代表整个项目”的模型，也不承诺方法级调用查询。

---

## 设计目标

1. 持久化每个 source group 的 raw ArchJSON，而不是只持久化一个“最大”分组
2. 为每个持久化 scope 构建对应的 `arch-index.json`
3. 明确 scope 选择规则，避免把“部分项目”伪装成“全项目”
4. 只承诺实体级查询能力；成员级调用图不在本次范围
5. CLI 和 MCP 共用同一套查询引擎与持久化约定

---

## 不在本次范围内

- 成员级调用图
- AST 重扫式精确 `calls` 查询
- 向量检索 / embedding / 语义相似搜索
- 增量失效与单文件重建
- 历史版本对比
- HTTP 模式 MCP，仅实现 stdio

---

## 核心设计

### 一、持久化模型: 多 scope，而不是单一 `arch.json`

每个成功解析且 `entities.length > 0` 的 source group 都会持久化为一个独立查询 scope。

目录结构:

```text
.archguard/
  output/                         # 现有图表输出，保持不变
  query/
    manifest.json
    <scope-key>/
      arch.json
      arch-index.json
```

`manifest.json` 负责列出可查询的 scope:

```typescript
export interface QueryManifest {
  version: string;                // "1.0"
  generatedAt: string;
  scopes: Array<{
    key: string;                  // normalized-sources hash (见下文)
    language: string;
    sources: string[];            // 已标准化: path.resolve() + path.relative(workDir)
    entityCount: number;
    relationCount: number;
    hasAtlasExtension: boolean;
  }>;
}
```

设计意图:

- 不再假装存在天然唯一的”项目全量 ArchJSON”
- 多根目录、多 source group、混合语言都能被明确列举
- `query/search/mcp` 面向一个明确 scope 工作

`scope-key` 生成规则:

1. 对 `sources[]` 中每个路径执行 `path.resolve()` 后再 `path.relative(workDir)`
2. 排序后拼接，计算 SHA-256，取前 8 位 hex
3. manifest 中的 `sources[]` 也存储标准化后的路径

这保证同一组源文件不论用相对路径还是绝对路径 analyze，都产生相同的 scope-key。

### 二、analyze 集成方式

`DiagramProcessor` 不再暴露 `getPrimaryArchJson()`，而是暴露所有可持久化的 source group 结果，例如:

```typescript
interface QuerySourceGroup {
  key: string;
  sources: string[];
  archJson: ArchJSON;
}

getQuerySourceGroups(): QuerySourceGroup[]
```

约束:

- 仅返回成功解析的 raw ArchJSON
- `entities.length === 0` 的 group 跳过
- Go Atlas 只要实体非空，就和其他语言一样持久化

实现注意: 当前 `DiagramProcessor` 的 `archJsonCache`（内存 Map）在 TypeScript package-level disk-cache-hit 路径上**不会被写入**（命中 `ArchJsonDiskCache` 后直接使用，不调用 `cacheArchJson()`）。`getQuerySourceGroups()` 必须同时覆盖 `archJsonCache` 和 disk-cache-hit 路径，否则这些 scope 会丢失。最简方案: 在所有 `processSourceGroup` 路径中，无论 ArchJSON 来源（解析、内存缓存、磁盘缓存），都统一写入 `archJsonCache`。

### 三、写入规则

写入位置固定在 `config.workDir/query/`，而不是 `outputDir`。

- `outputDir` 继续服务渲染产物
- `workDir/query/` 专门服务查询产物

这和当前配置模型一致:

- `workDir` 默认 `.archguard`
- `outputDir` 默认 `.archguard/output`

### 四、`arch-index.json` 数据结构

每个 scope 各自拥有一个 `arch-index.json`:

```typescript
import type { RelationType, CycleInfo } from '@/types/index.js';

export interface ArchIndex {
  version: string;
  generatedAt: string;
  archJsonHash: string;
  language: string;
  nameToIds: Record<string, string[]>;
  idToFile: Record<string, string>;
  idToName: Record<string, string>;
  dependents: Record<string, string[]>;
  dependencies: Record<string, string[]>;
  relationsByType: Partial<Record<RelationType, [string, string][]>>;
  fileToIds: Record<string, string[]>;
  cycles: CycleInfo[];
}
```

注意: 上述为可直接使用的类型定义，不是伪代码。

说明:

- 只索引 entity-level 数据
- 只保留 internal relations
- 不引入 `idToIndex`
- `cycles` 复用 `CycleInfo`

### 五、一致性策略: 原子写，不做 fire-and-forget

旧版文档中的”后台写回、失败吞掉”不适合正式索引层。新方案要求:

1. 序列化 `arch.json` 为 `Buffer`（`JSON.stringify(archJson, null, 2)`）
2. 写 `arch.json.tmp.<random>`（随机后缀，避免并发进程冲突）
3. `rename` 到 `arch.json`
4. 基于步骤 1 的 `Buffer` 计算 SHA-256（hash 基于磁盘字节，不是 re-serialized JSON）
5. 生成 `arch-index.json`，写 `arch-index.json.tmp.<random>`
6. `rename` 到 `arch-index.json`
7. 最后原子更新 `manifest.json`（同样用 `tmp.<random>` + rename）

关键约束: hash 必须基于写入磁盘的字节，不是 parsed object 再 stringify。`persistQueryScopes` 写入时保存 `Buffer` → 计算 hash → 写入 index。`QueryEngine.load()` 读 `arch.json` 的原始 `Buffer` → 计算 hash → 比对。

`QueryEngine.load()` 规则:

1. 先读 `manifest.json`
2. 确定 scope
3. 读对应 scope 的 `arch.json` 为原始 `Buffer`
4. 计算 `Buffer` 的 SHA-256，与 `arch-index.json.archJsonHash` 比对
5. 若 `arch-index.json` 缺失、损坏、version 不匹配或 hash 不匹配，则同步重建并原子写回
6. 若 `arch.json` 缺失，则报错退出

这里的关键变化是:

- 重建索引可以是回退路径
- 但索引写回必须是同步、原子的
- 查询结果与磁盘状态不能分叉
- 并发进程不会互相破坏（随机 tmp 文件名 + rename 是原子的）

### 六、scope 选择规则

`query/search/mcp` 都针对一个 scope 工作。

规则:

1. `manifest.scopes.length === 0` 时，报错: 需要先执行 analyze
2. `manifest.scopes.length === 1` 时，默认选中该 scope
3. `manifest.scopes.length > 1` 时，必须显式 `--scope <key>`

这一步是故意提高约束，避免把某个 source group 误当成全局真相。

### 七、`query` 子命令

只提供实体级查询:

```bash
archguard query --entity "CacheManager"
archguard query --deps-of "DiagramProcessor"
archguard query --used-by "ArchJSON"
archguard query --implementers-of "ILanguagePlugin"
archguard query --subclasses-of "BaseProcessor"
archguard query --file "src/cli/processors/diagram-processor.ts"
archguard query --cycles
archguard query --summary
```

说明:

- `--implementers-of` 只看 `relation.type === 'implementation'`
- `--subclasses-of` 只看 `relation.type === 'inheritance'`
- 不再用一个命令同时混合“实现者”和“子类”

深度展开:

- `--depth` 只适用于 `--deps-of` / `--used-by`
- 默认 1，硬上限 5
- depth=1 表示一跳直接邻居（不包含起始实体本身）；depth=2 表示邻居的邻居，以此类推
- 使用 BFS + visited 防环
- BFS 遍历的边: `--deps-of` 沿 `dependencies` 方向（source → target），`--used-by` 沿 `dependents` 方向（target → source），**所有 relation type 都参与遍历**（inheritance、implementation、dependency 等不做过滤）

### 八、`search` 子命令

`search` 也只做实体级结构发现:

```bash
archguard search --type interface
archguard search --high-coupling --threshold 8
archguard search --orphans
archguard search --in-cycles
```

本次明确移除 `--calls`。

原因:

- 当前模型没有成员级调用边
- `parseProject` 这类方法名不是稳定的实体索引键
- 用 entity-level dependency 去模拟 method-call，会让工具语义失真

### 九、MCP Server

MCP 暴露与 CLI 完全一致的实体级能力:

```typescript
tools: [
  { name: "archguard_find_entity" },
  { name: "archguard_get_dependents" },
  { name: "archguard_get_dependencies" },
  { name: "archguard_find_implementers" },
  { name: "archguard_find_subclasses" },
  { name: "archguard_get_file_entities" },
  { name: "archguard_detect_cycles" },
  { name: "archguard_summary" }
]
```

启动参数增加 scope:

```bash
archguard mcp --arch-dir ./.archguard --scope <scope-key>
```

如果只有一个 scope，`--scope` 可省略；多个 scope 时必须显式指定。

---

## 数据流

```text
archguard analyze 完成
  └─→ processor.processAll()
  └─→ processor.getQuerySourceGroups()
        └─→ 对每个 group:
              persistQueryScope(workDir/query/<scope-key>/, archJson)
                ├─→ 原子写 arch.json
                ├─→ 构建 arch-index.json
                └─→ 原子写 arch-index.json
        └─→ 原子写 manifest.json

archguard query --used-by "Foo" --scope abc123
  └─→ QueryEngine.load(workDir/query, scope=abc123)
        ├─→ 读 manifest.json
        ├─→ 读 abc123/arch.json
        ├─→ 校验 abc123/arch-index.json
        └─→ 必要时同步重建 index
  └─→ engine.getDependents("Foo")
```

---

## 实现范围

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/cli/query/query-manifest.ts` | `QueryManifest` 类型 |
| `src/cli/query/arch-index.ts` | `ArchIndex` 类型 |
| `src/cli/query/arch-index-builder.ts` | `ArchJSON -> ArchIndex` |
| `src/cli/query/query-artifacts.ts` | scope 持久化、manifest 持久化、原子写 |
| `src/cli/query/query-engine.ts` | 读取 manifest/scope，校验并查询 |
| `src/cli/query/engine-loader.ts` | 共享 `resolveArchDir()` / `resolveScope()` / `loadEngine()` |
| `src/cli/commands/query.ts` | `query` 子命令 |
| `src/cli/commands/search.ts` | `search` 子命令 |
| `src/cli/commands/mcp.ts` | `mcp` 子命令 |
| `src/cli/mcp/mcp-server.ts` | MCP server |

### 修改文件

| 文件 | 变更说明 |
|------|---------|
| `src/cli/processors/diagram-processor.ts` | 暴露 `getQuerySourceGroups()`; 修复 disk-cache-hit 路径不写 `archJsonCache` 的问题; 不再暴露 `getPrimaryArchJson()` |
| `src/cli/commands/analyze.ts` | `processAll()` 后持久化 query scopes + manifest |
| `src/cli/index.ts` | 注册 `query`、`search`、`mcp` |
| `package.json` | 新增 `@modelcontextprotocol/sdk` |

---

## 向后兼容性

- 现有图表产物目录不变，仍在 `outputDir`
- 查询产物是新增目录 `.archguard/query/`
- 不影响 `analyze` / `init` / `cache` 现有用法
- 多 scope 项目新增 `--scope` 约束，是刻意引入的显式性，不视为兼容性问题

---

## 验收标准

### 持久化

1. `archguard analyze` 成功后，`.archguard/query/manifest.json` 存在且为有效 JSON
2. 每个成功解析且 `entities.length > 0` 的 source group 都有独立 `<scope-key>/arch.json`
3. 每个 `<scope-key>/arch.json` 都有对应 `<scope-key>/arch-index.json`
4. Go Atlas 模式下，只要实体非空，也会持久化 query scope
5. 部分 source group 失败时，成功的 scope 仍然持久化（不因部分失败而跳过全部）
6. 所有 source group 都失败或实体都为空时，不生成 scope 文件，但不报错

### 一致性

7. `arch-index.json.archJsonHash` 等于对应 `arch.json` **磁盘字节**的 SHA-256（不是 re-serialized JSON）
8. index 缺失、损坏、version 不匹配或 hash 不匹配时，`QueryEngine.load()` 会同步重建并原子写回
9. `arch.json` 缺失时，`QueryEngine.load()` 抛出错误并退出码 1
10. manifest 存在多个 scope 且未提供 `--scope` 时，CLI 与 MCP 都应报错并列出可选 scope

### 查询语义

11. `--used-by` / `--deps-of` 结果仅基于 entity-level relations
12. `--implementers-of` 仅返回 `implementation` 边
13. `--subclasses-of` 仅返回 `inheritance` 边
14. `--type abstract_class` 同时覆盖 `type === 'abstract_class'` 与 `isAbstract === true && type === 'class'`
15. `--orphans` / `--high-coupling` / `--in-cycles` 都以实体为计算粒度，展示时可投影为文件
16. 不提供 `--calls`，也不对方法级调用图做任何能力承诺

### 回归

17. 现有测试通过
18. `npm run type-check` 零错误

---

## 开放问题

| 问题 | 说明 | 建议时机 |
|------|------|----------|
| 是否需要”跨 scope 聚合查询” | 当前版本显式按 scope 查询，避免语义欺骗。后续若要做全局查询，需要定义跨 scope 去重、命名冲突和结果排序规则 | 后续独立提案 |
| `scope-key` 的人类可读性 | 当前 key 是 8 位 hex hash，稳定但不直观。后续可增加 `label` 字段用于展示 | 实现阶段 |
| 成员级查询模型 | 若后续要支持 `calls`、方法实现、符号级引用，必须先扩展 ArchJSON / index 模型 | 后续独立提案 |
| `arch.json` 与 `ArchJsonDiskCache` 的重叠 | 两者职责不同: 一个是可发现持久化工件，一个是内容缓存 | 暂不合并 |
| `@modelcontextprotocol/sdk` 可行性 | 需验证: ESM 兼容性（项目 `”type”: “module”`）、stdio transport 支持、bundle size、是否应设为 optional dependency | Phase 5 前置 spike |
| `query` 与 `search` 是否合并 | 两个命令共享 `--arch-dir` + `--scope` + `--format` + 同一个 `QueryEngine`。对 agent 增加工具选择认知负担。MCP 层已是扁平工具集不受影响 | 实现阶段评估 |
