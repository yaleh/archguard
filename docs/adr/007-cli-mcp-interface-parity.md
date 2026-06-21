# ADR-007: CLI 与 MCP 接口一致性规范

**状态**: Accepted
**日期**: 2026-03-13
**决策者**: ArchGuard 架构团队

---

## 上下文

ArchGuard 同时提供两个接口层：

- **CLI** (`node dist/cli/index.js query ...`) — 供开发者直接使用
- **MCP server** (`archguard_*` 工具) — 供 AI agent 调用

随着功能增长，这两个接口出现了系统性的漂移：多个分析能力只在 MCP 中实现（`package-stats`、Atlas 层查询、测试分析、git 历史分析等），CLI 无法触达；用于验证一致性的 MCP 进程被寄宿在 Claude Code 会话中，无法独立启动；CLI 和 MCP 的产物差异没有自动检测机制。

这导致：开发者调试时无法完整复现 agent 看到的数据；新功能验证依赖 Claude Code 重启，周期长；接口一致性完全依赖人工核对，难以持续保持。

本 ADR 确立四项规范，覆盖架构分层、验证方法、输出一致性保证和接口扩展对称性。

---

## 决策驱动因素

- CLI 和 MCP 面向不同调用者，但必须提供等价的分析能力
- MCP 进程依赖 Claude Code 手动重启，不能成为验证的必要路径
- 一致性保证需要自动化，不能依赖人工对比
- 新增功能时需要明确的"双接口"检查点，防止漂移重现

---

## 决策

建立并执行以下四项规范：

---

## 规范详述

### 1. CLI 与 MCP 共用同一能力层，各自是薄包装

所有分析逻辑必须实现在 `QueryEngine`（查询）或分析管道（`run-analysis.ts`）中，**不得在接口层（`query.ts` 或 `mcp-server.ts`）中实现业务逻辑**。

CLI 和 MCP 都只做参数解析，然后调用公共能力层：

```
用户 / agent
    ↓
CLI flag  /  MCP tool        ← 薄包装（参数解析 + 格式化输出）
    ↓              ↓
    QueryEngine / AnalysisPipeline   ← 业务逻辑唯一所在
```

**实施要求**：
- `src/cli/commands/query.ts` 中每个 `--flag` handler 只调用 `QueryEngine` 方法，不内联逻辑
- `src/cli/mcp/mcp-server.ts` 中每个工具 handler 同样只调用 `QueryEngine` 方法
- 新增分析能力时，**先扩展 `QueryEngine`，再分别为 CLI 和 MCP 各加一个入口**

---

### 2. MCP 验证不依赖 Claude Code 托管的进程

Claude Code 中托管的 MCP server 在会话期间不重启，代码修改后进程缓存旧版实现。**禁止使用 Claude Code 当前会话中的 MCP 工具来验证刚修改过的代码。**

合规的验证方式：

**方式 A — 进程内（推荐，速度快）**
```typescript
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '@/cli/mcp/mcp-server.js';

const server = createMcpServer();
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
// 通过 clientTransport 按 MCP 协议调用
```

**方式 B — 独立进程（适合完整集成验证）**
```bash
node dist/cli/index.js mcp  # 独立启动，通过 stdio transport 调用
```

参见 `tests/integration/cli-mcp/analyze-equivalence.test.ts` 的完整示例。

**实施要求**：
- 涉及 `src/cli/mcp/` 的功能变更，验证步骤必须使用以上两种方式之一
- 不得在 PR 描述中写"已通过 Claude Code MCP 验证"作为等价证明

---

### 3. 输出一致性用快照测试自动保证

CLI 与 MCP 对同一项目执行 `analyze` 后，`.archguard/` 产物必须字节级等价（时间戳和哈希除外）。等价性由自动化测试持续保证，不依赖人工对比。

快照测试规范（参见 `tests/integration/cli-mcp/analyze-equivalence.test.ts`）：

1. 用相同 fixture 项目分别执行 CLI analyze 和 MCP analyze
2. 快照 `.archguard/` 的目录结构 + 所有文件内容
3. 用 `scrub()` 函数抹掉不稳定字段（`generatedAt`、`timestamp`、`lastRun`、`archJsonHash`）
4. 断言两侧快照完全相等

需要 scrub 的字段：
```typescript
const SCRUB_KEYS = ['generatedAt', 'createdAt', 'timestamp', 'lastRun', 'archJsonHash'];
```

**实施要求**：
- 修改分析管道或输出写盘逻辑时，必须运行 `tests/integration/cli-mcp/` 套件
- 若快照出现预期外的差异，必须先修复而不是更新快照

---

### 4. 接口扩展遵循功能分组对称原则

每个 MCP 工具必须有对应的 CLI flag，命名保持一一映射；反之亦然。

| MCP 工具 | CLI flag | 状态 |
|---|---|---|
| `archguard_summary` | `query --summary` | ✅ |
| `archguard_find_entity` | `query --entity <name>` | ✅ |
| `archguard_get_file_entities` | `query --file <path>` | ✅ |
| `archguard_get_package_stats` | `query --package-stats` | ✅ |
| `archguard_get_dependencies` | `query --deps-of <name>` | ✅ |
| `archguard_get_dependents` | `query --used-by <name>` | ✅ |
| `archguard_find_implementers` | `query --implementers-of <name>` | ✅ |
| `archguard_find_subclasses` | `query --subclasses-of <name>` | ✅ |
| `archguard_detect_cycles` | `query --cycles` | ✅ |
| `archguard_get_atlas_layer` | `query --atlas-layer <layer>` | ✅ |
| `archguard_detect_test_patterns` | `query --test-patterns` | ✅ |
| `archguard_get_test_issues` | `query --test-issues [--severity warning\|info]` | ✅ |
| `archguard_get_test_metrics` | `query --test-metrics` | ✅ |
| `archguard_get_entity_coverage` | `query --entity-coverage <id>` | ✅ |
| `archguard_get_package_fanin` | `query --package-fanin` | ✅ |
| `archguard_get_package_fanout` | `query --package-fanout` | ✅ |
| `archguard_detect_god_packages` | `query --god-packages` | ✅ |
| `archguard_find_callers` | `query --callers <entity>` | ✅ |
| `archguard_get_change_context` | `query --change-context <path> [--target-type file\|package]` | ✅ |
| `archguard_get_cochange` | `query --cochange <path> [--target-type file\|package]` | ✅ |
| `archguard_get_change_risk` | `query --change-risk <path> [--target-type file\|package]` | ✅ |
| `archguard_get_ownership` | `query --ownership <path> [--target-type file\|package]` | ✅ |

> 最后更新：2026-06-21。所有 22 个查询类 MCP 工具均有对应 CLI flag。`archguard_analyze` 和 `archguard_analyze_git` 是触发分析的写操作工具，对应 `archguard analyze` 和 `archguard analyze --include-git`，不在此对称表范围内。CLI/MCP parity 元数据的当前事实源是 `src/cli/metadata/registry.ts`，并由 CLI/MCP/docs drift tests 校验。

**新增工具检查清单**（PR 必须满足）：

- [ ] 已在 `QueryEngine` 中实现业务逻辑
- [ ] CLI `query` 命令有对应 `--flag`，命名与 MCP 工具名对称
- [ ] MCP 工具有对应 CLI flag
- [ ] 两侧 handler 均调用同一 `QueryEngine` 方法
- [ ] 已更新 `src/cli/metadata/registry.ts` 的 `queryMappings`
- [ ] 已运行 `npm run docs:check` 和 metadata surface E2E
- [ ] 补充了 CLI flag 的单元测试（happy path + 缺数据 exit 1 + 无效参数拒绝）

---

## 后果

### 正面影响

- 开发者和 agent 看到相同的数据，调试路径统一
- MCP 验证不再依赖 Claude Code 重启，可在 CI 中自动执行
- 接口漂移有快照测试兜底，不会无声积累
- 新增功能有明确的双接口检查清单，防止遗漏

### 负面影响

- 每次新增分析能力需要维护两个入口（CLI + MCP），有少量额外工作
- 快照测试在分析管道改动时可能需要更新（应谨慎评估是否预期变更）

---

## 相关决策

- [ADR-004: CLI 与 MCP 必须共享单一分析写盘路径](./004-single-analysis-write-path-for-cli-and-mcp.md)
- [ADR-006: MCP Tool 设计规范](./006-mcp-tool-design-standards.md)
- `tests/integration/cli-mcp/analyze-equivalence.test.ts` — 一致性快照测试实现
