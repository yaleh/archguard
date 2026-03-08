# Plan 32: Default Analysis via Primary-Language Project Scopes

**Source proposal**: `docs/proposals/proposal-default-analysis-language-scopes.md`
**Related ADRs**: `docs/adr/004-single-analysis-write-path-for-cli-and-mcp.md`, `docs/adr/005-default-analysis-uses-primary-language-project-scope.md`
**Branch**: `feat/default-language-scopes`
**Status**: Draft

## Overview

本计划的目标是把缺省分析从“目录约定驱动”升级为“语言级源码 scope 驱动”。

这里的“缺省分析”特指：

- `config.diagrams` 为空
- 未显式提供 `sources`
- 未显式提供 `lang`

如果 `config.diagrams` 已配置，仍按显式配置优先；Plan 32 不改变这个总优先级。

完成后，ArchGuard 在未显式传入 `sources` 时应具备以下行为：

1. 自动探测项目中的候选语言
2. 选择主语言，而不是盲目回退到 `./src`
3. 为主语言生成项目级 primary scope
4. 允许其他语言 scope 并存
5. 缺省查询继续通过 `globalScopeKey` 读取默认视图

核心约束有 5 条：

1. `scope` 与 `lang` 必须语义分离
2. 一个 scope 只属于一种语言
3. 默认缺省分析不能混合多语言进入同一 scope
4. 多语言 scope 结果必须允许并存
5. 所有分析写盘仍必须经由共享核心 `runAnalysis()`（来源：ADR-004 `docs/adr/004-single-analysis-write-path-for-cli-and-mcp.md`）

建议按 4 个 Phase 推进（对应 Proposal 的"两步"：Phase 1 对应 Proposal 第一步"修正当前错误默认行为"；Phase 2-4 对应 Proposal 第二步"引入多语言多 scope 自动发现"）：

| Phase | Scope | Dependency |
|------|------|------------|
| Phase 1 | 修正当前 `cpp + no sources` 的错误默认行为 | Plan 30（共享 `runAnalysis()` 路径，已完成）/ Plan 31（`projectRoot` per-call 语义，已完成） |
| Phase 2 | 引入主语言探测与项目级 primary scope 发现 | Phase 1 |
| Phase 3 | 支持多语言多 scope 持久化与 merge 更新 | Phase 2 |
| Phase 4 | 收口 query/analyze 语义并补集成测试 | Phase 3 |

每个 Phase 完成后都必须至少通过：

```bash
npm run type-check
npm test
```

---

## Pre-flight

先确认当前实现事实，避免带着错误假设拆分任务：

**注意：以下脚本需要在项目根目录下运行，且需先执行 `npm run build`。**

**此脚本仅为概念示意。`normalizeToDiagrams` 的第二个参数为 `CLIOptions` 类型，此处仅传入了 `lang` 字段；实际运行时需根据 `CLIOptions` 类型定义补充其余必需字段（如 `format`、`verbose` 等），否则可能因缺少必需属性而类型报错或运行异常。**

```bash
npm run type-check
npm test
npm run build

node --input-type=module <<'EOF'
import { normalizeToDiagrams } from './dist/cli/analyze/normalize-to-diagrams.js';
const config = {
  workDir: './.archguard',
  outputDir: './.archguard/output',
  format: 'json',
  mermaid: { renderer: 'isomorphic', theme: 'default', transparentBackground: false },
  exclude: [],
  cli: { command: 'claude', args: [], timeout: 60000 },
  cache: { enabled: true, ttl: 86400, dir: './.archguard/cache' },
  concurrency: 4,
  verbose: false,
  diagrams: [],
};
// 注意：以下 CLIOptions 仅包含 lang 字段，实际需补充 format、verbose 等必需字段
console.log(JSON.stringify(await normalizeToDiagrams(config, { lang: 'cpp' }, '/home/yale/work/llama.cpp'), null, 2));
EOF
```

基线观察点：

- `normalizeToDiagrams()` 当前只有在“显式给了 `sources` 且 `lang === 'cpp'`”时才走 C++ 分支
- 无 `sources` 时当前会回退到 `detectProjectStructure()` 的 TypeScript/JavaScript 目录约定
- `query-artifacts.ts` 当前一个 manifest 可以表示多个 scope，但 `persistQueryScopes()` 每次会用本次写入的 scopes 完整替换整个 manifest 文件，不保留已有但本次未传入的 scope
- `runAnalysis()` 当前还会通过 `cleanStaleDiagrams()` 和 `writeManifest()` 维护 diagram output 的独立清理语义
- query tools 当前以 `scope` 选择具体 scope，尚未引入 `lang` 级查询语义

实施前确认项：

- Plan 30 的共享 `runAnalysis()` 已存在（状态：已完成）
- Plan 31 的 `projectRoot` per-call 语义已存在（状态：已完成）
- 当前 `llama.cpp` 可作为多语言回归样例

---

## Phase 1 — 修正 `cpp + no sources` 的错误默认行为

### Objectives

**当前状态**：未实现。虽然 `inferredLanguage` 被正确设为 `'cpp'`，但 `normalizeToDiagrams()` 只有 `go` 分支处理，`cpp` 会 fallthrough 到 TypeScript 的 `detectProjectStructure()`。

1. 修复 C++ 项目在缺省参数下退化到 TypeScript `./src` 的问题
2. 当 `lang = “cpp”` 且未传 `sources` 时，生成 C++ 语义正确的默认 diagrams
3. 为后续”主语言自动探测”建立最小正确基线

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/analyze/normalize-to-diagrams.ts` | Modify（核心修复） | 在 `lang === 'cpp' && !sources` 分支中调用 C++ 专属项目结构探测，而不是 `detectProjectStructure()` |
| `src/cli/utils/cpp-project-structure-detector.ts` | Modify | 提供适用于项目根目录的 primary scope 发现入口 |
| `tests/unit/cli/analyze/normalize-to-diagrams.test.ts` | Modify（增加 C++ 场景） | 核心修改在 `normalize-to-diagrams.ts`，测试应在对应测试文件中新增 `lang=cpp + no sources` 的单测场景 |
| `tests/integration/cli/analyze-multilang.test.ts` | Modify | 该文件已存在，但缺乏 C++ 场景覆盖；本次新增多语言仓库下 `lang=cpp` 的回归测试 |

### Required design constraints

- Phase 1 不做完整多语言自动发现
- 只解决“已经显式知道要分析 C++，但未给 `sources`”时的错误路径
- 不能再让 `lang = "cpp"` 落回 `detectProjectStructure()` 的 TypeScript/JS 逻辑
- Phase 1 不改变 query manifest、`globalScopeKey`、或 query merge 语义

建议最小行为：

- `lang = "cpp"` 且无 `sources` 时
  - 从 `projectRoot` 出发发现 C++ 项目级 primary scope
  - 至少生成 package/class 两层默认图

### Verify

```bash
npm run type-check
npm test -- normalize-to-diagrams
npm test -- analyze-multilang
```

验收点：

- `normalizeToDiagrams(config, { lang: 'cpp' }, <cpp-project-root>)` 不再返回 `./src` 的 TypeScript 风格结果
- `runAnalysis()` 在 C++ 项目上生成的 diagrams 包含 C++ 实体（package/class 层级），而非 TypeScript 风格的空结果或错误结果

---

## Phase 2 — 主语言探测与项目级 primary scope 发现

### Objectives

1. 在缺省参数下引入候选语言探测
2. 为主语言计算项目级 primary scope
3. 建立可解释的主语言选择规则
4. 将缺省分析从“目录约定”改为“主语言 + 项目级 scope”

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/analyze/normalize-to-diagrams.ts` | Modify | 在无 `sources` 且无显式 `lang` 时走自动发现链路 |
| `src/cli/utils/project-language-detector.ts` | New | 探测候选语言、证据与得分 |
| `src/cli/utils/default-scope-planner.ts` | New | 根据主语言和项目结构生成 primary/secondary scope 计划 |
| `src/cli/utils/cpp-project-structure-detector.ts` | Modify | 支持项目级 primary scope 规划 |
| `tests/unit/cli/utils/project-language-detector.test.ts` | New | 语言探测单测 |
| `tests/unit/cli/utils/default-scope-planner.test.ts` | New | scope 规划单测 |

### Design notes

推荐引入两个内部对象：

```typescript
interface LanguageCandidate {
  language: 'typescript' | 'go' | 'java' | 'python' | 'cpp';
  score: number;
  evidence: string[];
  roots: string[];
}

interface PlannedScope {
  language: string;
  label: string;
  role: 'primary' | 'secondary';
  sources: string[];
}
```

主语言判断应综合：

- 根级构建文件
- 核心目录覆盖
- 文件体量
- 是否只存在于 `scripts` / `tests` / `examples` / `vendor`

首版语言探测应优先复用现有实现已有的高信号输入：

- `PluginRegistry` 的项目标记文件
- 现有 `lang` 支持集合：`typescript | go | java | python | cpp`
- 目录与扩展名的轻量统计

不要在 Phase 2 一开始就引入一套完全独立于现有插件能力的“全新语言分类器”。

同时要避免另一种误用：不要直接调用 `PluginRegistry.detectPluginForDirectory()` 作为主语言判定结果。它当前是“单目录、首个 marker 命中即返回一个插件”的逻辑，只适合单语言路由，不适合多语言候选发现。

### Required design constraints

- 主语言不是“文件数最多的语言”
- 项目级 primary scope 不得简单等于 `./src`
- 一个 planned scope 只允许属于一种语言
- 仍然允许用户通过 `lang` 或 `sources` 显式覆盖自动推断
- Phase 2 的输出可以先只保证“选出一个默认 primary scope”，不要求同一轮自动分析立即持久化所有非主语言 scope

### Verify

```bash
npm run type-check
npm test -- project-language-detector
```

验收点：

- 对 `llama.cpp` 一类仓库，主语言应稳定判定为 `cpp`
- 缺省分析得到的是 C++ 项目级 primary scope，而不是 Python 或 web UI 子目录
- 输出链路可以解释主语言选择理由

---

## Phase 3 — 多语言多 scope 持久化与 merge 更新

### Objectives

1. 支持同一项目下多个语言 scope 并存
2. 将 query artifact 更新策略从”整体替换”收敛为”按 scope merge”
3. 保留 `globalScopeKey` 作为默认查询入口
4. 允许用户先分析主语言，再追加分析非主语言
5. 修改 `persistQueryScopes()` 从”整体替换”改为”按 scope key merge”，保留本次未触及的已有 scope

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/query/query-artifacts.ts` | Modify | scope 元信息扩展与 merge 持久化策略 |
| `src/cli/query/query-manifest.ts` | Modify | 如需要，新增 `role` 等 scope 元字段；顺手修正第 12 行注释中的路径（`query-manifest.json` → `query/manifest.json`） |
| `src/cli/analyze/run-analysis.ts` | Modify | 传递 merge 模式参数给 `persistQueryScopes()`，merge 核心逻辑在 `query-artifacts.ts` 的 `persistQueryScopes()` 中实现 |
| `tests/unit/cli/query/query-artifacts.test.ts` | Modify | 多语言 scope 并存、merge 行为测试 |
| `tests/unit/cli/analyze/run-analysis.test.ts` | Modify | `globalScopeKey` 与 merge 更新测试 |

明确不在 Phase 3 解决：

- `.archguard/output/` 的 diagram output merge
- `cache/diagram-manifest.json` 的 merge 策略
- `cleanStaleDiagrams()` 的语义重构

### Required design constraints

- 默认行为应保留未被本次分析触及的其他语言 scope
- `globalScopeKey` 应始终指向当前默认主视图
- scope key 必须稳定且避免多语言冲突
- 不允许因为新增 Python scope 就覆盖已有 C++ 主 scope
- 必须显式区分 query manifest merge 与 diagram output cleanup，两者不能共享一套隐含规则
- `role` 字段作为可选字段引入，缺失时默认视为 `'primary'`，不触发 manifest version 变更

### Suggested metadata additions

建议扩展 `manifest.scopes[]` 元信息：

- `language`
- `sources`
- `role: primary | secondary`
- `entityCount`
- `relationCount`

如需扩展 `globalScopeKey` 的选择逻辑，应在实现前先明确：

- 默认沿用”主语言 primary scope 优先”
- 不是单纯按实体数最大

`selectGlobalScopeKey()` 的行为变更应在 **Phase 3** 中完成（与 merge 持久化同步落地），而非推迟到 Phase 4。Phase 4 仅负责验证该逻辑在端到端场景中的正确性。还需显式修改当前 `selectGlobalScopeKey()` 的事实行为；不能只在文档层假设它已经如此工作。

### Verify

```bash
npm run type-check
npm test -- query-artifacts
```

验收点：

- 同一项目可同时保留 `cpp`、`python`、`typescript` 的 query scopes
- 默认 analyze 不会清空无关语言的已有 scope
- 再次查询仍可通过 `globalScopeKey` 获得稳定默认视图

---

## Phase 4 — 收口 query/analyze 语义并补集成测试

### Objectives

1. 明确 `scope` 与 `lang` 的边界
2. 保持 query tools 的默认语义简单稳定
3. 为缺省分析、多语言追加分析、交替查询建立回归护栏

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/mcp/analyze-tool.ts` | Modify | 文案与输出中增加主语言 / 默认 scope 结果说明 |
| `tests/integration/cli/analyze-multilang.test.ts` | Modify | 缺省分析、多语言追加分析集成测试 |
| `tests/integration/cli-mcp/cross-project-query.test.ts` | Modify | 补 `projectRoot + globalScopeKey + explicit scope` 的端到端测试 |
| `docs/proposals/proposal-default-analysis-language-scopes.md` | Modify | 同步 proposal 中的实施状态 |
| `docs/adr/005-default-analysis-uses-primary-language-project-scope.md` | Modify | 同步 ADR 中的实现状态与决策记录 |
| `CLAUDE.md` | Modify | 更新 CLI 用法说明中关于缺省分析行为的描述 |

### Query semantics

本 Phase 建议收口为以下最小规则：

- `scope = undefined`
  - 使用 `globalScopeKey`
- `scope = "global"`
  - 显式使用 `globalScopeKey`
- `scope = "<scope-key>"`
  - 使用指定 scope

本 Phase 不引入 query 层的 `lang` 参数。

不推荐：

- `scope = “cpp”`

如果未来需要”按语言查询默认 scope”，应另开提案，而不是在本计划中顺手扩展 query 契约。如果需要”查询某语言的默认 scope”，应通过读取 manifest 中该语言的 primary scope key 实现，而不是将语言名直接作为 scope 参数。可考虑在未来 helper 函数中封装这一逻辑（如 `getScopeByLanguage(lang)`），但不在本计划范围内。

### Integration scenarios

至少覆盖这些端到端场景：

1. 缺省分析多语言项目
   - 自动识别主语言
   - 设置 `globalScopeKey`
2. 显式追加分析非主语言
   - 不破坏已有主语言 scope
3. 默认查询与显式 scope 查询交替进行
   - 结果稳定
4. 再次运行缺省分析
   - 不丢失无关语言 scope
5. diagram output 继续按当前 manifest 语义清理
   - 不与 query scope merge 相互污染

### Verify

```bash
npm run type-check
npm test
```

验收点：

- 用户可以“默认分析 -> 追加分析 Python -> 切回查询 C++”
- `scope` 与 `lang` 没有出现语义混淆
- 多语言仓库的默认行为可解释、可复现、可测试

---

## Release notes checklist

如果 Plan 32 落地，需要在发布说明中明确：

1. 缺省分析的语义已改变
2. 默认不再简单依赖 `./src` / `./lib` / `./app`
3. 多语言项目会产生多个语言级 scope
4. 默认查询继续使用 `globalScopeKey`
5. 显式 `lang` / `sources` 仍可覆盖自动发现
6. 多语言 scope 并存：同一项目现在可以并存多个语言的分析结果，不会互相覆盖
7. Scope 切换方式：通过 `globalScopeKey` 获取默认视图，或通过 `--scope <key>` 指定任意已存在的 scope
