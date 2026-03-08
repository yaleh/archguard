# Proposal: Default Analysis via Language-Level Source Scopes

**状态**: Draft
**日期**: 2026-03-08
**关联**: [proposal-mcp-analyze-tool.md](./proposal-mcp-analyze-tool.md), [proposal-mcp-stateless-cross-project.md](./proposal-mcp-stateless-cross-project.md), [proposal-cpp-language-support.md](./proposal-cpp-language-support.md)

---

## 背景

当前 `archguard_analyze` 在缺省参数下的行为，与“分析整个项目”的直觉预期不一致。

以 `~/work/llama.cpp` 为例：

- 仓库主体是 C/C++
- 同时包含 Python、TypeScript、Shell、Swift 等辅助代码
- 当前默认路径会退化到 `detectProjectStructure()` 的 TypeScript/JavaScript 语义
- 最终得到 `./src` 这样的单语言默认目录，而不是“项目的主实现范围”

这会产生两个问题：

1. 缺省分析并不等于“整个项目的主架构视图”
2. 多语言项目里，少量辅助语言容易干扰主语言的默认选择

因此需要重新定义“缺省分析”的产品语义。

---

## 核心结论

缺省分析应定义为：

> 自动发现项目中的语言级源码 scope，默认展示主语言的主 scope，而不是盲目分析仓库根目录的所有文件。

这一定义包含 4 个关键点：

1. 缺省分析允许发现多个 scope，而不是强制只生成一个
2. 每个 scope 只属于一种语言，不混合多语言文件
3. 默认查询只展示一个 scope，即 `globalScopeKey`
4. 用户可以显式选择非主语言继续分析或查询

---

## 目标

1. 为缺省分析建立稳定、可解释、适用于多语言仓库的默认行为
2. 避免把“整个项目”错误简化为某个固定目录，如 `./src`
3. 在不破坏现有 query layer 基本模型的前提下，引入多语言多 scope 结果
4. 保持 `scope` 与 `lang` 语义分离，避免查询 API 混乱

---

## 非目标

- 不在本提案中定义跨语言静态依赖关系抽取
- 不要求一次性支持所有语言的完美项目结构推断
- 不在本提案中重做 ArchJSON 主体模型
- 不要求默认分析必须覆盖仓库内每一种文件类型

---

## 定义

### 1. `language`

表示语言类别，例如：

- `cpp`
- `python`
- `typescript`
- `go`

`language` 用于“按语言检测”和“按语言请求分析”。

### 2. `scope`

表示一个已持久化的、可查询的分析范围。一个 scope 只属于一种语言。

一个 scope 至少应包含：

- `key`
- `label`
- `language`
- `sources`
- `role`
- `entityCount`
- `relationCount`

### 3. `primary language`

表示项目主体实现所使用的主语言，而不是文件数最多的语言。

### 4. `primary scope`

表示主语言下最能代表项目核心实现的那个 scope。

### 5. `global scope`

表示缺省查询使用的 scope。其 key 存放于 `manifest.globalScopeKey`。

`global scope` 通常等于 `primary scope`，但它是“默认展示选择”，不是语言类别本身。

---

## 产品语义

### 1. 缺省分析不等于扫描仓库里所有文件

缺省分析的输入只有：

- `projectRoot`
- 可选 `lang`
- 可选 `sources`

当 `sources` 缺失时，系统不应直接把仓库根目录作为一个混合语言 scope 交给单语言插件解析。

正确行为应是：

1. 在 `projectRoot` 下进行语言探测
2. 为检测到的语言发现候选源码根
3. 为每种语言生成一个或多个候选 scope
4. 选择主语言的主 scope 作为 `globalScopeKey`

### 2. 缺省查询只展示一个默认 scope

即使缺省分析生成了多个 scope，query tools 在未显式指定 `scope` 时也只读取一个默认 scope。

该默认 scope 应由 `manifest.globalScopeKey` 指定。

### 3. 用户可以显式分析非主语言

用户应可通过显式参数覆盖默认主语言选择：

- `lang = "python"`：只分析 Python 相关 scope
- `sources = ["gguf-py"]`：只分析指定路径
- `lang = "python" + sources = ["gguf-py"]`：分析指定路径内的 Python scope

显式请求的优先级高于缺省语言推断。

### 4. 不同语言的 scope 结果可以并存

`.archguard/query/` 下应允许同时存在多个语言的 query scopes。

用户后续查询时可以在这些 scope 之间切换，而不要求重新分析或覆盖旧结果。

---

## 设计原则

### 1. `scope` 与 `lang` 必须语义分离

这是本提案的硬约束。

- `lang` 表示“按哪种语言分析或筛选”
- `scope` 表示“查询哪个已存在的分析范围”

因此不建议把 `scope = "cpp"` 作为正式语义。

推荐语义：

- `summary(scope = "global")`
- `summary(scope = "<scope-key>")`
- `analyze(lang = "cpp")`

如果未来需要“查某语言的默认 scope”，也应通过独立规则实现，例如：

- `summary(lang = "cpp")`

而不是复用 `scope` 参数。

### 2. 一个 scope 只属于一种语言

原因：

- 语言插件的文件发现规则不同
- 实体模型与关系抽取链路不同
- 混合语言 scope 会导致查询结果难以解释

因此不应把 C++、Python、TypeScript 文件混成一个 ArchJSON scope。

### 3. 主语言判断必须基于“项目主体实现”，而不是单纯文件计数

主语言判断应综合：

- 根级构建文件，如 `CMakeLists.txt`、`go.mod`、`package.json`
- 核心目录覆盖，如 `src/`、`include/`、`lib/`
- 源码文件体量与分布
- 是否只是工具脚本、测试或示例代码

### 4. 默认行为必须可解释

缺省分析完成后，系统应能回答：

- 检测到了哪些语言
- 为每种语言发现了哪些 scope
- 哪个 scope 被设为 `global`
- 为什么它是默认值

---

## 缺省分析流程

建议定义为 5 个阶段。

### 阶段 1：仓库探测

在 `projectRoot` 下收集有限的高价值证据：

- 根级构建文件
- 关键目录结构
- 各语言源码文件分布
- 是否只存在于 `scripts/`、`tests/`、`examples/`、`vendor/` 等低优先级目录

### 阶段 2：语言候选打分

为每个检测到的语言生成 `LanguageCandidate`：

- `language`
- `score`
- `evidence`
- `roots`

分数不应只依赖文件数，还应考虑：

- 是否有根级构建证据
- 是否覆盖主实现目录
- 是否仅存在于附属目录

### 阶段 3：scope 发现

对每个候选语言，发现 1 个或多个语言级源码 scope。

例如：

- `cpp`: `src`, `common`, `include`, `ggml`, `tools/server`
- `python`: `gguf-py`, 根级 `convert_*.py`
- `typescript`: `tools/server/webui`

### 阶段 4：scope 合并与裁剪

避免结果过碎。

建议：

- 小而附属的路径可并入同语言主 scope
- 明显独立的大子系统可保留为 secondary scope
- `vendor`、`third_party`、`build`、`.git` 默认不进入主 scope

### 阶段 5：选择 `globalScopeKey`

规则建议为：

1. 先确定主语言
2. 再选择主语言中的 primary scope
3. 将该 scope 设为 `manifest.globalScopeKey`

---

## 主语言判定建议

主语言应满足：

- 代表项目的主要实现
- 与主构建系统一致
- 覆盖核心源码目录
- 不被脚本语言或附属前端子项目抢占默认地位

### 推荐信号

高权重信号：

- 根目录 `CMakeLists.txt`、`Makefile`、`go.mod`、`pom.xml`
- 主源码目录中的文件覆盖
- 主要二进制/库的实现语言

中权重信号：

- 文件数
- 目录数
- 估算 LOC

降权信号：

- 仅存在于 `scripts/`
- 仅存在于 `tests/`
- 仅存在于 `examples/`
- 仅存在于某个附属 UI 子目录

### `llama.cpp` 的预期判断

对 `~/work/llama.cpp`：

- `cpp` 应被判定为主语言
- `python` 是辅助工具语言
- `typescript` 是附属 web UI 语言

因此默认 `global scope` 不应落到 Python 或 `tools/server/webui`。

---

## 主 scope 判定建议

主语言确定后，还需从其 scope 集合中选出主 scope。

建议标准：

- 是否覆盖核心实现目录
- 是否与项目主构建入口相关
- 是否体量更大
- 是否不是附属工具或边缘模块

对多 scope C++ 项目，可接受以下结果：

- `core-cpp`: `src`, `common`, `include`
- `ggml-cpp`: `ggml/src`, `ggml/include`
- `tools-server-cpp`: `tools/server`

默认 `global scope` 可选择 `core-cpp`，其余作为可切换 scope 保留。

---

## API 语义建议

### 1. Analyze

`analyze` 层的参数语义：

- `projectRoot`
  - 定位目标项目
- `lang`
  - 按语言限制分析范围
- `sources`
  - 按路径限制分析范围

建议优先级：

1. `sources + lang`
2. `sources`
3. `lang`
4. 全缺省

对应行为：

- `sources + lang`
  - 只分析指定路径中的指定语言
- `sources`
  - 对这些路径做语言探测；必要时生成多个 scope
- `lang`
  - 在项目内自动发现该语言的主/次级 scope
- 全缺省
  - 自动发现项目中的语言级 scope，并选择主语言主 scope 作为全局默认

### 2. Query

`query` 层的参数语义：

- `scope`
  - 只表示具体 scope 标识
- `lang`
  - 如果未来引入，应只表示“按语言选择默认 scope”

当前推荐最小语义：

- `scope = undefined`
  - 使用 `manifest.globalScopeKey`
- `scope = "global"`
  - 显式使用 `manifest.globalScopeKey`
- `scope = "<scope-key>"`
  - 使用指定 scope

不推荐：

- `scope = "cpp"`

因为这会把“语言选择”和“scope 选择”混为一谈。

---

## Query Artifact 模型建议

### 1. 多语言多 scope 并存

建议继续使用现有目录布局，但允许一个 manifest 管理多个语言的多个 scope：

```text
.archguard/
  query/
    manifest.json
    <scope-key>/
      arch.json
      arch-index.json
```

### 2. scope 元信息

建议在 `manifest.scopes[]` 中至少保留：

- `key`
- `label`
- `language`
- `sources`
- `entityCount`
- `relationCount`
- `role`（建议新增，如 `primary` / `secondary`）

### 3. `globalScopeKey`

`globalScopeKey` 的语义应保持单一：

- 它表示默认查询展示哪个 scope
- 它不等价于语言本身

---

## 更新策略建议

### 1. 默认采用 merge 语义

当用户分多次分析不同语言时，已有 scope 结果不应被无条件覆盖。

建议默认行为：

- 本次命中的 scope 被新增或刷新
- 其他未涉及的 scope 保留

这样才能支持：

1. 先默认分析 C++
2. 再显式分析 Python
3. 再切回查询 C++

### 2. 保留显式重建能力

如果用户需要全量重建，应通过显式参数触发，例如未来可考虑：

- `rebuild: true`
- `clearExisting: true`

本提案不强制立即实现这些参数，但要求默认行为不要破坏多语言并存。

---

## 用户可见输出建议

缺省分析完成后，建议输出摘要至少包含：

- 检测到的语言
- 每种语言生成的 scope
- 默认 `global scope`
- 选择理由

示例：

```text
Detected languages:
- cpp (primary)
- python
- typescript

Generated scopes:
- core-cpp (global)
- ggml-cpp
- tools-server-cpp
- gguf-py
- server-webui-ts

Default scope:
- core-cpp
Reason:
- primary language is cpp
- covers core implementation directories
- largest non-tool scope
```

---

## 实施建议

建议分两步推进。

### 第一步：修正当前错误默认行为

先修复“C++ 项目在缺省参数下回退到 TypeScript `./src`”的问题。

最低要求：

- 当 `lang = "cpp"` 且未传 `sources` 时，不能再走 `detectProjectStructure()` 的 TypeScript/JS 分支
- 缺省路径至少应能得到一个 C++ 语义正确的 primary scope

### 第二步：引入多语言多 scope 自动发现

在第一步正确性的基础上，新增：

- 语言候选探测
- 多 scope 生成
- `globalScopeKey` 选择规则
- 多语言并存的 query artifact 更新策略

---

## 风险与权衡

### 1. 自动发现规则可能过于复杂

缓解方式：

- 先实现高信号、低歧义规则
- 允许用户通过 `lang` 和 `sources` 显式覆盖

### 2. 多 scope 会增加 manifest 与缓存复杂度

但这是必要复杂度。否则多语言仓库只能不断覆盖旧结果，无法稳定交替查询。

### 3. 主语言选择可能与用户预期不完全一致

缓解方式：

- 输出选择理由
- 支持显式语言与路径覆盖

---

## 决策摘要

1. 缺省分析应基于“语言级源码 scope 自动发现”，而不是固定目录或混合语言全仓扫描
2. 默认展示主语言的主 scope，并写入 `globalScopeKey`
3. `scope` 与 `lang` 必须语义分离
4. 不同语言的分析产物与缓存应允许并存
5. 用户应可显式分析非主语言，并在后续查询中交替使用不同 scope

