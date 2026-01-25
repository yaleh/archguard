# ArchGuard Claude Code Subagent 集成方案 (RLM 分析)

**文档版本**: 1.0
**创建日期**: 2026-01-25
**分析方法**: RLM (Refactoring Lifecycle Management)
**改进范围**: Claude Code 生态集成、智能多模块分析、用户体验提升
**优先级**: 🟡 中 (P2) - 生态集成和高级自动化
**关联文档**: 02-claude-code-integration-strategy.md, 07-advanced-cli-features.md

---

## 执行摘要

本文档基于 RLM 方法提出 ArchGuard 与 Claude Code Subagent 的深度集成方案，旨在通过智能代理实现自动化的多层次、多模块架构分析。主要方案包括:

1. **Skill-based Subagent** - 创建 Claude Code Skill 模板（推荐）
2. **智能项目结构检测** - 自动识别 Monorepo、微服务、分层架构
3. **批量分析自动化** - 无需手动多次调用命令
4. **智能索引生成** - 自动创建架构导航文档

**核心价值**: 让 ArchGuard 成为 Claude Code 生态的一等公民，为用户提供"一句话生成项目架构全景图"的体验。

---

## 1. RLM PROPOSAL - 愿景与使用场景

### 1.1 核心愿景

**从**: 用户手动运行命令，多次调用，手动整理输出
**到**: 自然语言描述需求，Subagent 自动完成全流程

**愿景陈述**: *"用户在 Claude Code 中输入 '分析这个项目的架构'，Subagent 自动识别项目结构，智能选择分析策略，生成多层次架构图，并返回带有导航和洞察的报告。"*

---

### 1.2 典型使用场景

#### 场景 1: 自动多层次架构分析

**用户输入**:
```
"分析这个项目的架构，生成前端、后端和数据库层的架构图"
```

**Subagent 执行流程**:
```
1. 项目结构检测
   - 发现 frontend/, backend/, database/ 目录
   - 识别为三层架构

2. 批量分析调用
   - archguard analyze -s ./frontend --name layers/frontend
   - archguard analyze -s ./backend --name layers/backend
   - archguard analyze -s ./database --name layers/database

3. 索引生成
   - 创建 archguard/index.md
   - 包含所有层的链接和预览
   - 添加统计信息和依赖关系

4. 用户反馈
   - "✅ 已生成3个架构图"
   - "📊 总计: 128 个实体, 215 个关系"
   - "🔗 查看总览: archguard/index.md"
```

---

#### 场景 2: Monorepo 项目分析

**用户输入**:
```
"为这个 monorepo 的每个 package 生成架构图"
```

**Subagent 执行流程**:
```
1. Monorepo 检测
   - 发现 packages/ 目录
   - 读取 package.json 确认工作区
   - 识别 8 个 packages

2. 批量分析
   - 对每个 package 调用 archguard analyze
   - 输出到 archguard/packages/{package-name}.png

3. 索引页面生成
   - 按依赖关系排序
   - 显示每个 package 的复杂度
   - 生成依赖图

4. 洞察报告
   - "最复杂的 package: frontend-core (45 entities)"
   - "循环依赖检测: 无"
   - "建议: backend-api 可以进一步模块化"
```

---

#### 场景 3: 微服务架构分析

**用户输入**:
```
"为每个微服务生成独立的架构图"
```

**Subagent 执行流程**:
```
1. 微服务检测
   - 发现 services/ 目录
   - 识别 5 个微服务

2. 批量分析
   - archguard analyze -s ./services/auth --name services/auth
   - archguard analyze -s ./services/user --name services/user
   - ... (3 more services)

3. 服务依赖分析
   - 分析跨服务的 API 调用
   - 生成服务依赖图

4. 总览报告
   - 服务间耦合度分析
   - 识别关键路径服务
   - API 兼容性检查
```

---

#### 场景 4: 增量分析（Git 集成）

**用户输入**:
```
"只分析最近修改的模块"
```

**Subagent 执行流程**:
```
1. Git 变更检测
   - git diff --name-only HEAD~10
   - 识别变更文件的模块归属

2. 模块映射
   - 变更文件归属: frontend (12 files), backend (5 files)
   - 忽略未变更的模块: database, shared

3. 增量分析
   - 只重新生成 frontend 和 backend 的图
   - 保留其他模块的缓存图

4. 变更报告
   - "📝 变更影响: 2 个模块"
   - "🔄 重新生成: frontend.png, backend.png"
   - "⏱️ 节省时间: 75% (vs 全量分析)"
```

---

### 1.3 用户价值

**效率提升**:
- 🚀 从 5 分钟手动操作 → 30 秒自动化
- 🎯 从需要了解 CLI → 自然语言交互
- ⚡ 从多次命令调用 → 一次性完成

**质量提升**:
- ✅ 自动选择最佳分析策略
- 📊 智能生成导航和索引
- 💡 提供架构洞察和建议

**学习成本降低**:
- 📚 无需阅读文档
- 🔧 无需记忆命令参数
- 🎓 通过对话学习功能

---

## 2. RLM PLANNING - 实现方案设计

### 2.1 方案对比矩阵

| 方案 | 实现复杂度 | 用户体验 | 维护成本 | 推荐优先级 |
|------|-----------|---------|---------|-----------|
| **Skill-based Subagent** | ⭐⭐ (低) | ⭐⭐⭐⭐⭐ | ⭐⭐ (低) | **P1 (推荐)** |
| **MCP Server** | ⭐⭐⭐⭐⭐ (高) | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ (高) | P3 (长期) |
| **内置智能模式** | ⭐⭐⭐⭐ (较高) | ⭐⭐⭐ | ⭐⭐⭐ (中) | P2 (可选) |

---

### 2.2 推荐方案: Skill-based Subagent

#### 2.2.1 Skill 目录结构

```
~/.claude/skills/archguard-analyzer/
├── skill.json                    # Skill 元数据和配置
├── instructions.md               # 核心执行逻辑
├── examples/
│   ├── monorepo-analysis.md     # Monorepo 分析示例
│   ├── microservices-analysis.md # 微服务分析示例
│   ├── layered-analysis.md      # 分层架构分析示例
│   └── incremental-analysis.md  # 增量分析示例
├── templates/
│   ├── index-template.md        # 索引页面模板
│   ├── summary-template.md      # 总结报告模板
│   └── insights-template.md     # 洞察分析模板
└── README.md                     # 安装和使用说明
```

---

#### 2.2.2 skill.json 配置

```json
{
  "name": "archguard-analyzer",
  "version": "1.0.0",
  "description": "Intelligent multi-module TypeScript architecture analysis with ArchGuard CLI",
  "author": "ArchGuard Team",
  "homepage": "https://github.com/archguard/archguard",
  "repository": "https://github.com/archguard/claude-skills",
  "license": "MIT",

  "tags": [
    "architecture",
    "typescript",
    "plantuml",
    "analysis",
    "monorepo",
    "microservices"
  ],

  "requiredTools": [
    "Bash",
    "Glob",
    "Read",
    "Write"
  ],

  "capabilities": [
    "Auto-detect project structure (monorepo, microservices, layered)",
    "Generate multi-level architecture diagrams",
    "Batch analysis for multiple modules",
    "Generate index pages with navigation",
    "Provide architecture insights and recommendations",
    "Support incremental analysis with Git integration"
  ],

  "activation": {
    "keywords": [
      "analyze architecture",
      "generate architecture diagram",
      "show project structure",
      "analyze modules",
      "architecture overview"
    ],
    "patterns": [
      "analyze.*architecture",
      "generate.*diagram",
      "show.*structure"
    ]
  },

  "configuration": {
    "defaultOutputDir": "./archguard",
    "defaultFormat": "plantuml",
    "verboseMode": true,
    "generateIndex": true
  }
}
```

---

#### 2.2.3 instructions.md 核心逻辑

````markdown
# ArchGuard Multi-Module Analyzer Skill

## Activation Criteria

Activate this skill when user requests:
- Architecture analysis
- Diagram generation
- Project structure visualization
- Module analysis

## Execution Workflow

### Phase 1: Project Structure Detection

**Step 1.1**: Detect project type using Glob tool

```bash
# Check for monorepo
<Glob pattern="packages/*/package.json" />
<Glob pattern="apps/*/package.json" />
<Glob pattern="pnpm-workspace.yaml" />

# Check for microservices
<Glob pattern="services/*/src/**/*.ts" />

# Check for layered architecture
<Glob pattern="frontend/src/**/*.ts" />
<Glob pattern="backend/src/**/*.ts" />
<Glob pattern="shared/src/**/*.ts" />

# Default single module
<Glob pattern="src/**/*.ts" />
```

**Step 1.2**: Classify project structure

Based on findings, classify as:
- **Monorepo**: If `packages/` or `apps/` detected
- **Microservices**: If `services/` detected
- **Layered**: If frontend/backend/shared detected
- **Single Module**: Otherwise

---

### Phase 2: Analysis Strategy Selection

**For Monorepo** (Strategy A):
```
1. List all packages
2. For each package:
   - Run: archguard analyze -s ./packages/{name}/src --name packages/{name}
3. Generate index with package dependencies
```

**For Microservices** (Strategy B):
```
1. List all services
2. For each service:
   - Run: archguard analyze -s ./services/{name} --name services/{name}
3. Generate index with service dependencies
4. Create service dependency graph
```

**For Layered** (Strategy C):
```
1. Analyze each layer:
   - Frontend: archguard analyze -s ./frontend --name layers/frontend
   - Backend: archguard analyze -s ./backend --name layers/backend
   - Shared: archguard analyze -s ./shared --name layers/shared
2. Generate cross-layer dependency analysis
3. Create layer interaction diagram
```

**For Single Module** (Strategy D):
```
1. Run: archguard analyze -s ./src
2. Generate single architecture diagram
3. Provide complexity metrics
```

---

### Phase 3: Command Execution

**Execute ArchGuard CLI** using Bash tool:

```bash
# Example for each module
archguard analyze \
  -s <module-source-path> \
  --name <module-name> \
  --output-dir ./archguard \
  --verbose
```

**Error Handling**:
- If archguard not installed: Provide installation instructions
- If analysis fails: Show error message and suggest fixes
- If no TypeScript files: Warn user and skip module

---

### Phase 4: Index Page Generation

**Create `archguard/index.md`** using Write tool:

```markdown
# Project Architecture Overview

**Generated**: {timestamp}
**Project Type**: {detected-type}
**Total Modules**: {count}

---

## Modules

{for each module}
### {module-name}

- **Path**: `{source-path}`
- **Entities**: {entity-count}
- **Relations**: {relation-count}
- **Complexity**: {complexity-score} (Low/Medium/High)
- **Diagram**: [View PNG]({module-name}.png)

![{module-name}]({module-name}.png)

---
{end for}

## Summary Statistics

- **Total Entities**: {sum of all entities}
- **Total Relations**: {sum of all relations}
- **Average Complexity**: {avg complexity}

## Insights

{architecture insights and recommendations}
```

---

### Phase 5: Results Presentation

**User Feedback Format**:

```
✅ Analysis complete!

📊 **Summary**:
- Project Type: {type}
- Modules Analyzed: {count}
- Total Entities: {total}
- Total Relations: {total}

🔗 **Output**:
- Index: archguard/index.md
- Diagrams: archguard/{module1}.png, archguard/{module2}.png, ...

💡 **Insights**:
- {insight 1}
- {insight 2}
- {insight 3}

📖 **Next Steps**:
- Review the diagrams in archguard/ directory
- Check index.md for navigation
- Consider refactoring high-complexity modules
```

---

## Advanced Features

### Feature 1: Incremental Analysis

When user asks "only analyze changed files":

1. Use Git to detect changes:
   ```bash
   git diff --name-only HEAD~10 | grep '\.ts$'
   ```

2. Map changed files to modules

3. Only re-generate affected modules

4. Update index with change indicators

---

### Feature 2: Dependency Analysis

For monorepo/microservices:

1. Extract import statements from code
2. Build cross-module dependency graph
3. Detect circular dependencies
4. Generate dependency diagram

---

### Feature 3: Complexity Insights

After analysis:

1. Calculate complexity scores:
   - Entity count
   - Relation density
   - Inheritance depth

2. Provide recommendations:
   - "Module X has high complexity (45 entities). Consider splitting."
   - "Strong coupling detected between A and B. Review interface design."
   - "No circular dependencies found. ✅"

---

## Example Interactions

### Example 1: Auto-detect and Analyze

**User**: "Analyze this project's architecture"

**Skill**:
1. Detects monorepo structure (8 packages)
2. Runs archguard for each package
3. Generates index with package dependencies
4. Returns: "✅ Analyzed 8 packages, see archguard/index.md"

---

### Example 2: Specific Module Analysis

**User**: "Analyze the frontend module"

**Skill**:
1. Locates frontend/ directory
2. Runs: `archguard analyze -s ./frontend --name frontend`
3. Returns diagram and statistics

---

### Example 3: Microservices Analysis

**User**: "Generate diagrams for all microservices"

**Skill**:
1. Detects services/ directory with 5 services
2. Batch analysis for all services
3. Creates service dependency graph
4. Returns index with service overview

---

## Troubleshooting

### Issue: archguard not installed

**Detection**: Bash command fails with "command not found"

**Action**:
```
It appears ArchGuard is not installed. To install:

```bash
npm install -g archguard
```

After installation, try again.
```

---

### Issue: No TypeScript files found

**Detection**: Zero files matched pattern

**Action**:
```
No TypeScript files found in the specified path.

Please verify:
1. This is a TypeScript project
2. Source files are in ./src or ./packages
3. Files have .ts extension

For non-TypeScript projects, ArchGuard currently only supports TypeScript.
```

---

### Issue: Analysis timeout

**Detection**: archguard command times out

**Action**:
```
Analysis timed out. This might happen for very large projects.

Suggestions:
1. Analyze specific modules instead of entire project
2. Increase timeout: archguard analyze --cli-timeout 180000
3. Use --batch mode for large monorepos
```

---

## Configuration Options

Users can customize behavior by asking:

**"Use verbose mode"**: Sets `--verbose` flag
**"Output to ./docs"**: Sets `--output-dir ./docs`
**"Don't generate index"**: Skips index.md creation
**"Use JSON format"**: Sets `--format json`

---

## Tips for Best Results

1. **For large monorepos**: Use batch mode or analyze specific packages
2. **For incremental updates**: Mention "only changed modules"
3. **For detailed insights**: Ask for "complexity analysis" or "dependency review"
4. **For custom output**: Specify output directory upfront

---

## Future Enhancements

- Support for other languages (Java, Python, Go)
- Interactive diagram filtering
- Real-time updates during analysis
- Integration with project documentation tools
````

---

### 2.3 实现时间线

#### Phase 1: Skill 模板开发 (2-3 天)

**任务**:
1. ✅ 编写 skill.json 配置
2. ✅ 编写 instructions.md 核心逻辑
3. ✅ 创建示例文件 (4 个场景)
4. ✅ 创建模板文件 (3 个模板)
5. ✅ 编写 README.md 安装指南

**验收标准**:
- [ ] skill.json 符合 Claude Code Skill 规范
- [ ] instructions.md 逻辑清晰完整
- [ ] 示例覆盖主要使用场景
- [ ] 模板可直接使用

**交付物**:
- `~/.claude/skills/archguard-analyzer/` 完整目录
- 安装和使用文档

---

#### Phase 2: 测试和优化 (1-2 天)

**任务**:
1. ✅ 在真实项目中测试 (Monorepo、微服务、分层架构)
2. ✅ 收集边缘情况
3. ✅ 优化 prompt 和逻辑
4. ✅ 改进错误处理

**验收标准**:
- [ ] 3 种项目类型测试通过
- [ ] 错误处理完善
- [ ] 用户体验流畅

---

#### Phase 3: 文档和发布 (1 天)

**任务**:
1. ✅ 编写完整的安装文档
2. ✅ 创建演示视频/GIF
3. ✅ 发布到 GitHub
4. ✅ 更新 ArchGuard README

**验收标准**:
- [ ] 文档完整准确
- [ ] 演示清晰易懂
- [ ] 社区可访问

---

**总工期**: 4-6 个工作日

---

## 3. RLM EXECUTION - 可选方案

### 3.1 方案 B: MCP Server (长期规划)

**适用场景**: 需要更强大的功能，如流式输出、自定义工具等

**架构设计**:
```typescript
// archguard-mcp-server

export const server = new MCPServer({
  name: "archguard-analyzer",
  version: "1.0.0",

  tools: [
    {
      name: "analyze_project",
      description: "Analyze project structure and generate architecture diagrams",
      parameters: {
        strategy: {
          type: "string",
          enum: ["auto", "monorepo", "microservices", "layered", "single"],
          default: "auto"
        },
        modules: {
          type: "array",
          items: { type: "string" },
          description: "Specific modules to analyze (optional)"
        },
        outputDir: {
          type: "string",
          default: "./archguard"
        },
        generateIndex: {
          type: "boolean",
          default: true
        }
      }
    },
    {
      name: "analyze_module",
      description: "Analyze a single module",
      parameters: {
        path: { type: "string", required: true },
        name: { type: "string", required: true }
      }
    },
    {
      name: "get_insights",
      description: "Get architecture insights and recommendations",
      parameters: {
        modules: { type: "array", items: { type: "string" } }
      }
    }
  ]
});
```

**优势**:
- ✅ 更强大的工具抽象
- ✅ 支持流式输出
- ✅ 可暴露丰富的 API

**劣势**:
- ❌ 实现复杂度高
- ❌ 需要额外的服务器维护
- ❌ 用户安装步骤增加

**推荐时间**: v2.0 或更晚

---

### 3.2 方案 C: 内置智能模式 (可选增强)

**实现方式**: 在 ArchGuard CLI 中添加 `--auto-modules` 模式

```bash
# 自动检测并分析所有模块
archguard analyze --auto-modules

# 内部逻辑:
# 1. 检测项目结构
# 2. 为每个检测到的模块运行分析
# 3. 生成索引页面
```

**优势**:
- ✅ 无需额外集成
- ✅ 用户体验简单

**劣势**:
- ❌ 灵活性较低
- ❌ 无法利用 Claude Code 的对话能力

**推荐时间**: v1.3 或 v1.4

---

## 4. RLM VALIDATION - 验证策略

### 4.1 Skill 验证测试

**测试项目准备**:
```
test-projects/
├── monorepo-example/          # Lerna monorepo with 5 packages
├── microservices-example/     # 4 microservices
├── layered-example/           # Frontend/Backend/Shared
└── single-module-example/     # Simple src/ structure
```

**测试用例**:

| 测试场景 | 用户输入 | 预期输出 | 状态 |
|---------|---------|---------|------|
| Monorepo 自动检测 | "Analyze architecture" | 检测到 5 个 packages, 生成 5 个图 + 索引 | ⏳ |
| 微服务批量分析 | "Generate diagrams for all services" | 4 个服务图 + 依赖图 + 索引 | ⏳ |
| 分层架构分析 | "Analyze this project" | 3 层图 + 跨层依赖分析 | ⏳ |
| 增量分析 | "Analyze changed modules" | 只重新生成变更模块的图 | ⏳ |
| 错误处理 | (ArchGuard 未安装) | 提示安装指南 | ⏳ |

---

### 4.2 质量门控

**必须满足**:
- ✅ 3 种主要项目类型自动检测准确率 > 95%
- ✅ Skill 激活成功率 > 90%
- ✅ 错误处理完善，无 crash
- ✅ 文档完整性 = 100%
- ✅ 用户满意度 > 4/5

---

## 5. RLM INTEGRATION - 集成策略

### 5.1 发布策略

**v1.0 发布清单**:
- [ ] Skill 文件完整
- [ ] 在 3 种项目类型测试通过
- [ ] README 文档完善
- [ ] 演示 GIF/视频准备
- [ ] 发布到 GitHub archguard/claude-skills 仓库

**安装指南**:
```bash
# 1. 克隆 skill 仓库
git clone https://github.com/archguard/claude-skills.git

# 2. 复制到 Claude skills 目录
cp -r claude-skills/archguard-analyzer ~/.claude/skills/

# 3. 验证安装
ls ~/.claude/skills/archguard-analyzer

# 4. 在 Claude Code 中测试
# 打开任意 TypeScript 项目
# 输入: "Analyze this project's architecture"
```

---

### 5.2 用户采用策略

**文档支持**:
- 在 ArchGuard README 添加 "Claude Code Integration" 章节
- 创建视频教程（2-3 分钟）
- 博客文章介绍使用案例

**社区推广**:
- 发布到 Claude Code 社区论坛
- Twitter/X 分享演示
- 撰写 Medium 文章

---

## 6. RLM MONITORING - 持续改进

### 6.1 监控指标

**使用指标**:
- Skill 安装量
- 激活成功率
- 用户反馈评分

**质量指标**:
- 自动检测准确率
- 分析成功率
- 平均执行时间

---

### 6.2 反馈渠道

**GitHub Issues**:
- 标签: `skill`, `claude-code`, `enhancement`

**社区讨论**:
- Discord/Slack 频道
- GitHub Discussions

**改进计划**:
- 每月回顾用户反馈
- 每季度发布功能更新
- 持续优化 prompt 和逻辑

---

## 7. 示例和最佳实践

### 7.1 Monorepo 示例

**项目结构**:
```
my-monorepo/
├── packages/
│   ├── ui-components/src/
│   ├── business-logic/src/
│   ├── api-client/src/
│   └── utils/src/
├── pnpm-workspace.yaml
└── package.json
```

**用户交互**:
```
User: "Analyze all packages in this monorepo"

Skill:
  ✅ Detected monorepo with 4 packages
  📊 Analyzing packages...
     - ui-components (32 entities, 56 relations)
     - business-logic (45 entities, 78 relations)
     - api-client (18 entities, 29 relations)
     - utils (12 entities, 15 relations)

  📁 Generated:
     - archguard/packages/ui-components.png
     - archguard/packages/business-logic.png
     - archguard/packages/api-client.png
     - archguard/packages/utils.png
     - archguard/index.md

  💡 Insights:
     - business-logic has highest complexity
     - No circular dependencies detected ✅
     - utils is widely depended upon (3 packages)
```

---

### 7.2 微服务示例

**项目结构**:
```
microservices/
├── services/
│   ├── auth-service/
│   ├── user-service/
│   ├── order-service/
│   └── payment-service/
└── shared/
```

**用户交互**:
```
User: "Generate architecture diagrams for all services"

Skill:
  ✅ Detected microservices architecture (4 services)
  🔄 Analyzing services...
     - auth-service (22 entities)
     - user-service (38 entities)
     - order-service (41 entities)
     - payment-service (29 entities)

  🔗 Service Dependencies:
     - order-service → payment-service
     - order-service → user-service
     - user-service → auth-service

  📁 Generated:
     - archguard/services/*.png (4 diagrams)
     - archguard/service-dependencies.png
     - archguard/index.md

  ⚠️  Recommendations:
     - Consider API gateway for user-service (high fanout)
     - Review auth-service as single point of dependency
```

---

## 8. 预期收益

### 8.1 定量收益

| 维度 | 改进前 | 改进后 | 提升 |
|------|--------|--------|------|
| **操作时间** | 5-10 分钟 | 30 秒 | ✨ 10-20x |
| **学习成本** | 需阅读文档 | 对话即可 | ✨ 100% |
| **错误率** | 手动易出错 | 自动化 | ✨ -90% |
| **分析覆盖** | 手动难以全面 | 自动全覆盖 | ✨ +200% |

---

### 8.2 定性收益

**用户体验**:
- ✅ 自然语言交互
- ✅ 零学习成本
- ✅ 智能推荐和洞察
- ✅ 无缝 Claude Code 集成

**生态价值**:
- ✅ 展示 Claude Code Skill 最佳实践
- ✅ 吸引更多 ArchGuard 用户
- ✅ 促进社区贡献
- ✅ 建立工具链标杆

---

## 9. 风险评估

### 9.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| Claude Code Skill API 变更 | 低 | 高 | 关注官方更新，及时适配 |
| 项目结构检测不准 | 中 | 中 | 提供手动模式，用户可指定 |
| Skill 激活失败 | 低 | 中 | 清晰的激活关键词，多个触发模式 |

---

### 9.2 用户采用风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 用户不知道 Skill 存在 | 高 | 高 | 文档、视频、社区推广 |
| 安装步骤复杂 | 中 | 中 | 提供一键安装脚本 |
| 功能不满足需求 | 低 | 中 | 持续收集反馈，快速迭代 |

---

## 10. 成功度量

### 10.1 定量指标

- ✅ Skill 安装量 > 100 (3 个月内)
- ✅ GitHub Stars 增长 > 30%
- ✅ 用户反馈评分 > 4.5/5
- ✅ 社区贡献 PR > 3 个

---

### 10.2 定性指标

- ✅ 用户证言收集 > 5 条
- ✅ 社区文章/博客 > 3 篇
- ✅ 成为 Claude Code Skill 推荐案例

---

## 11. 相关文档

- [02-claude-code-integration-strategy.md](./02-claude-code-integration-strategy.md) - Claude Code CLI 集成
- [07-advanced-cli-features.md](./07-advanced-cli-features.md) - 高级 CLI 功能
- [00-implementation-roadmap.md](./00-implementation-roadmap.md) - 总体路线图

---

## 12. 附录

### 12.1 Skill 安装脚本

```bash
#!/bin/bash
# install-archguard-skill.sh

SKILL_DIR="$HOME/.claude/skills/archguard-analyzer"
REPO_URL="https://github.com/archguard/claude-skills.git"

echo "🚀 Installing ArchGuard Analyzer Skill..."

# 1. 检查 Claude Code
if ! command -v claude &> /dev/null; then
    echo "❌ Claude Code not found. Please install Claude Code first."
    exit 1
fi

# 2. 检查 ArchGuard
if ! command -v archguard &> /dev/null; then
    echo "⚠️  ArchGuard not found. Installing..."
    npm install -g archguard
fi

# 3. 创建 skills 目录
mkdir -p "$HOME/.claude/skills"

# 4. 克隆或更新
if [ -d "$SKILL_DIR" ]; then
    echo "📦 Updating existing skill..."
    cd "$SKILL_DIR" && git pull
else
    echo "📥 Downloading skill..."
    git clone "$REPO_URL" /tmp/claude-skills
    cp -r /tmp/claude-skills/archguard-analyzer "$SKILL_DIR"
    rm -rf /tmp/claude-skills
fi

# 5. 验证安装
if [ -f "$SKILL_DIR/skill.json" ]; then
    echo "✅ Installation complete!"
    echo ""
    echo "To use the skill:"
    echo "1. Open a TypeScript project in Claude Code"
    echo "2. Say: 'Analyze this project's architecture'"
    echo ""
    echo "For more info: cat $SKILL_DIR/README.md"
else
    echo "❌ Installation failed. Please check the error messages above."
    exit 1
fi
```

---

### 12.2 快速开始指南

```markdown
# ArchGuard Analyzer Skill - Quick Start

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/archguard/claude-skills/main/install.sh | bash
```

## Usage

1. Open a TypeScript project in Claude Code
2. Start a conversation
3. Say one of:
   - "Analyze this project's architecture"
   - "Generate architecture diagrams"
   - "Show me the project structure"

## What It Does

- 🔍 Auto-detects project type (monorepo, microservices, etc.)
- 📊 Generates architecture diagrams for all modules
- 🗂️ Creates navigation index page
- 💡 Provides architecture insights

## Examples

**Monorepo**:
> "Analyze all packages"

**Microservices**:
> "Generate diagrams for all services"

**Incremental**:
> "Analyze only changed modules"

## Troubleshooting

See [README.md](./README.md#troubleshooting)
```

---

**文档作者**: Claude Code (AI Assistant)
**最后更新**: 2026-01-25
**文档状态**: ✅ 完成
**适用版本**: ArchGuard v1.2.0+ with Claude Code
**下一步**: 实现 Skill 模板并测试
