# ADR-005: 缺省分析自动发现主语言并使用项目级 scope

**状态**: Proposed
**日期**: 2026-03-08
**上下文**: [proposal-default-analysis-language-scopes.md](../proposals/proposal-default-analysis-language-scopes.md), [proposal-mcp-stateless-cross-project.md](../proposals/proposal-mcp-stateless-cross-project.md)
**决策者**: ArchGuard 架构团队

---

## 上下文

ArchGuard 当前的缺省分析行为，在多语言仓库上会产生明显偏差。

以 `~/work/llama.cpp` 为例：

- 项目主体是 C/C++
- 仓库中同时存在 Python、TypeScript、Shell、Swift 等辅助代码
- 当前缺省路径容易退化到单语言目录约定，例如 `./src`
- 最终并没有形成“整个项目的默认架构视图”

这暴露出两个架构问题：

1. 系统没有清晰定义“缺省分析”到底分析什么
2. 系统把“语言选择”“目录约定”“scope 选择”混在了一起

如果继续沿用当前模式，ArchGuard 在多语言项目上会持续出现以下问题：

- 把附属语言误判为默认分析对象
- 把“整个项目”错误简化为某个固定目录
- 无法稳定支持后续的多语言 scope 并存与切换

因此需要在架构层明确：缺省配置下到底如何确定默认分析对象。

---

## 决策驱动因素

- 缺省分析必须在多语言仓库上表现稳定
- 默认行为必须可解释，而不是依赖隐式目录约定
- `scope` 与 `lang` 的语义必须保持清晰分离
- Query layer 需要一个稳定的默认 scope
- 用户仍然需要显式切换到非主语言继续分析或查询
- 不同语言的分析产物应能并存，而不是互相覆盖

---

## 备选方案

### 方案 A: 缺省分析始终使用固定目录约定

例如优先使用：

- `src`
- `lib`
- `app`

**优点**

- 实现简单
- 对单语言、目录规范统一的项目有效

**缺点**

- 对多语言仓库非常脆弱
- 默认行为带有强 TypeScript/JavaScript 偏见
- 无法回答“为什么这个目录代表整个项目”
- 对 `llama.cpp` 这类项目会持续失真

### 方案 B: 缺省分析扫描仓库根目录下所有受支持语言文件

即把整个 `projectRoot` 视为一个“真正的整个项目 scope”。

**优点**

- 表面上最接近“整个项目”
- 不依赖目录命名约定

**缺点**

- 单一 scope 中混合多语言，语义不清
- 不同语言插件的实体模型和文件发现规则不兼容
- Query 结果难解释
- 无法自然支持“主语言默认视图 + 次语言可切换视图”

### 方案 C: 缺省分析自动发现主语言，并以主语言的项目级 scope 作为默认 scope

同时允许发现和持久化其他语言的附加 scope。

**优点**

- 兼顾“默认简单”和“多语言真实世界”
- 结果可解释
- 与 query layer 的 `globalScopeKey` 语义天然契合
- 为多语言 scope 并存提供清晰基础

**缺点**

- 需要新增主语言判定与项目级 scope 发现规则
- 比固定目录方案复杂
- 主语言误判时需要提供显式覆盖能力

---

## 决策

采纳**方案 C**。

在缺省配置下，ArchGuard 必须：

1. 自动探测项目中的候选语言
2. 判断哪一种语言是项目的主语言
3. 为主语言生成一个项目级 primary scope
4. 将该 scope 设为默认查询使用的 `globalScopeKey`
5. 允许其他语言的 scope 同时存在，但它们不是缺省查询目标

这里的“项目级 scope”含义明确为：

- 覆盖该语言在项目中的主要实现区域
- 不等于仓库根目录的所有文件
- 不等于某个固定目录约定
- 不混合多种语言

因此，缺省分析的正式语义是：

> 自动发现项目中的语言级源码 scope，并默认选择主语言的项目级 primary scope 作为全局默认视图。

---

## 决策细化

### 1. 主语言不是“文件数最多的语言”

主语言必须表示项目主体实现所使用的语言。

判断时应综合：

- 根级构建文件证据，如 `CMakeLists.txt`、`go.mod`、`package.json`
- 核心目录覆盖，如 `src/`、`include/`、`lib/`
- 源码体量
- 是否只是脚本、测试、示例或附属 UI

### 2. 缺省 scope 必须是项目级，而不是目录级捷径

“项目级 scope”强调的是语义覆盖，而不是路径形态。

例如对 C++ 项目，主 scope 可能由多个路径共同组成：

- `src`
- `common`
- `include`
- 视项目结构决定是否包含其他核心目录

这比“固定选择 `./src`”更接近真实项目边界。

### 3. 每个 scope 只属于一种语言

本 ADR 明确拒绝“多语言混合单一 scope”的默认模型。

原因：

- 语言插件不同
- 实体模型不同
- 依赖抽取逻辑不同
- Query 结果会失去可解释性

### 4. `scope` 与 `lang` 语义分离

- `lang` 用于分析时选择或限制语言
- `scope` 用于查询时选择一个已存在的分析范围

因此不应把 `scope = "cpp"` 作为默认接口语义。

### 5. 默认查询始终落到 `globalScopeKey`

即使一次分析生成了多个语言 scope，缺省查询也只展示一个默认 scope。

这个默认值必须是主语言的项目级 primary scope。

---

## 后果

### 正面影响

- 多语言项目的缺省分析结果更符合用户直觉
- `globalScopeKey` 的来源变得清晰
- 默认行为不再绑定到某一种语言的目录约定
- 为后续多语言 scope 并存和切换打下基础
- 用户可在默认简单体验和显式高级控制之间切换

### 负面影响

- 需要实现主语言探测和项目级 scope 发现规则
- 需要维护一套可解释但不过度复杂的评分逻辑
- 需要新增回归测试覆盖多语言仓库场景
- 某些边界项目上，主语言判定仍可能与个别用户直觉不完全一致

---

## 实施要求

### 1. 缺省分析必须先做语言探测

当用户未显式传入 `sources` 时，不得直接套用单语言目录约定。

至少需要：

- 探测候选语言
- 发现各语言候选源码根
- 选出主语言

### 2. 主语言缺省 scope 必须是项目级 primary scope

实现不得再把：

- `./src`
- `./lib`
- `./app`

这类目录约定直接等同于“整个项目”的默认 scope。

### 3. 多语言 scope 结果应允许并存

Query artifacts 应允许同时保留：

- 主语言 primary scope
- 主语言其他 secondary scopes
- 非主语言 scopes

默认查询只使用 `globalScopeKey`，但不应覆盖其他已存在 scope。

### 4. 显式参数优先于缺省推断

如果用户显式传入：

- `lang`
- `sources`

则这些参数必须覆盖缺省主语言推断。

### 5. 输出必须可解释

缺省分析完成后，应能说明：

- 检测到了哪些语言
- 哪个语言被选为主语言
- 默认 scope 包含哪些主要源码根
- 为什么它被设为全局默认

---

## 与 `llama.cpp` 相关的期望行为

对于 `~/work/llama.cpp`，本 ADR 的期望行为是：

- 主语言应判定为 `cpp`
- 缺省 scope 应是 C++ 的项目级 primary scope
- Python 和 TypeScript 可以作为附加 scope 被分析和持久化
- 缺省查询不应落到 Python 脚本或 `tools/server/webui`
- 缺省分析不应再退化为 TypeScript 风格的 `./src`

---

## 相关决策

- [ADR-004](./004-single-analysis-write-path-for-cli-and-mcp.md)
- [proposal-default-analysis-language-scopes.md](../proposals/proposal-default-analysis-language-scopes.md)

