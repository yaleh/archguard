# ArchGuard Claude Code Subagent 集成 - 实施计划 (RLM PLANNING)

**文档版本**: 1.0
**创建日期**: 2026-01-25
**RLM 阶段**: PLANNING
**关联 Proposal**: [08-claude-code-subagent-integration.md](../proposals/08-claude-code-subagent-integration.md)
**项目代号**: SKILL-INTEGRATION-v1.0
**目标版本**: ArchGuard Skill v1.0.0
**预估工期**: 4-6 个工作日

---

## 执行摘要

本文档是 RLM PLANNING 阶段的详细实施计划，将 Proposal 08 中的 Claude Code Subagent 集成建议转化为可执行的开发任务。采用 Skill-based 方案（推荐方案 A），创建完整的 Claude Code Skill 模板。

**核心交付物**:
1. Claude Code Skill 模板（完整可用）
2. 项目结构检测逻辑
3. 智能分析策略选择
4. 索引生成和洞察
5. 完整文档和示例

**关键决策**:
- 采用 Skill-based 方案（不开发 MCP Server）
- 支持 4 种项目结构自动检测
- 提供完整的安装和使用文档
- 包含故障排除指南

---

## 1. 技术架构设计

### 1.1 Skill 架构图

```
Claude Code
    │
    ├─ 用户输入: "分析这个项目的架构"
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│           archguard-analyzer Skill                      │
├─────────────────────────────────────────────────────────┤
│  skill.json (元数据 + 配置)                             │
│  instructions.md (执行逻辑)                             │
└─────────────────────────────────────────────────────────┘
    │
    ├─ Phase 1: Project Structure Detection
    │   ├─ Glob: packages/*/package.json
    │   ├─ Glob: services/*/src
    │   └─ Glob: frontend/, backend/, shared/
    │
    ├─ Phase 2: Strategy Selection
    │   ├─ Monorepo → Strategy A
    │   ├─ Microservices → Strategy B
    │   ├─ Layered → Strategy C
    │   └─ Single Module → Strategy D
    │
    ├─ Phase 3: Execute ArchGuard CLI
    │   ├─ For each module:
    │   │   └─ Bash: archguard analyze -s <path> --name <name>
    │   │
    │   └─ Collect results
    │
    ├─ Phase 4: Generate Index
    │   └─ Write: archguard/index.md
    │
    └─ Phase 5: User Feedback
        └─ Summary + Insights + Links
```

---

### 1.2 Skill 目录结构设计

```
~/.claude/skills/archguard-analyzer/
├── skill.json                      # Skill 元数据（必需）
│   └── 定义: name, version, activation, capabilities
│
├── instructions.md                 # 核心执行逻辑（必需）
│   ├── Phase 1: 项目结构检测
│   ├── Phase 2: 策略选择
│   ├── Phase 3: 命令执行
│   ├── Phase 4: 索引生成
│   └── Phase 5: 结果呈现
│
├── templates/                      # 模板文件
│   ├── index-template.md          # 索引页面模板
│   ├── summary-template.md        # 总结报告模板
│   └── insights-template.md       # 洞察分析模板
│
├── examples/                       # 使用示例
│   ├── monorepo-analysis.md       # Monorepo 示例
│   ├── microservices-analysis.md  # 微服务示例
│   ├── layered-analysis.md        # 分层架构示例
│   └── incremental-analysis.md    # 增量分析示例
│
├── docs/                           # 文档
│   ├── installation.md            # 安装指南
│   ├── usage-guide.md             # 使用指南
│   ├── troubleshooting.md         # 故障排除
│   └── faq.md                     # 常见问题
│
└── README.md                       # Skill 介绍和快速开始
```

---

## 2. 核心文件详细设计

### 2.1 skill.json 设计

**目标**: 定义 Skill 元数据和激活条件

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
    "microservices",
    "diagram",
    "visualization"
  ],

  "requiredTools": [
    "Bash",
    "Glob",
    "Read",
    "Write"
  ],

  "requiredCommands": [
    "archguard"
  ],

  "capabilities": [
    "Auto-detect project structure (monorepo, microservices, layered, single)",
    "Generate multi-level architecture diagrams",
    "Batch analysis for multiple modules",
    "Generate navigation index pages",
    "Provide architecture insights and recommendations",
    "Support incremental analysis with Git integration"
  ],

  "activation": {
    "keywords": [
      "analyze architecture",
      "generate architecture diagram",
      "architecture diagram",
      "show project structure",
      "analyze modules",
      "architecture overview",
      "generate diagrams",
      "project architecture"
    ],
    "patterns": [
      "analyze.*architecture",
      "generate.*diagram",
      "show.*structure",
      "architecture.*analysis"
    ],
    "autoActivate": false
  },

  "configuration": {
    "defaultOutputDir": "./archguard",
    "defaultFormat": "plantuml",
    "verboseMode": true,
    "generateIndex": true,
    "autoDetectStrategy": true
  },

  "version_info": {
    "requires_archguard": ">=1.2.0",
    "requires_claude": ">=1.0.0"
  }
}
```

---

### 2.2 instructions.md 核心逻辑

**目标**: 可执行的 Skill 指令

````markdown
# ArchGuard Multi-Module Analyzer Skill - Instructions

## Activation Criteria

Activate this skill when user requests:
- Architecture analysis (e.g., "analyze architecture", "show project structure")
- Diagram generation (e.g., "generate architecture diagram")
- Module analysis (e.g., "analyze all packages")
- Project structure visualization

## Prerequisites Check

Before starting analysis:

1. **Check ArchGuard Installation**:
```bash
<Bash description="Check if ArchGuard is installed">
archguard --version
</Bash>
```

If command fails:
```
ArchGuard is not installed. Please install it first:

\`\`\`bash
npm install -g archguard
\`\`\`

After installation, try again.
```

2. **Check Claude Code CLI**:
ArchGuard requires Claude Code CLI to generate diagrams.
```bash
<Bash description="Check if Claude CLI is available">
claude --version
</Bash>
```

---

## Phase 1: Project Structure Detection

**Objective**: Automatically detect project type

### Step 1.1: Detect Monorepo

Check for common monorepo indicators:

```bash
# Lerna monorepo
<Glob pattern="packages/*/package.json" />
<Glob pattern="apps/*/package.json" />

# Pnpm workspace
<Glob pattern="pnpm-workspace.yaml" />

# Nx monorepo
<Glob pattern="nx.json" />
```

### Step 1.2: Detect Microservices

Check for services directory:

```bash
<Glob pattern="services/*/src/**/*.ts" />
<Glob pattern="services/*/package.json" />
```

### Step 1.3: Detect Layered Architecture

Check for frontend/backend/shared structure:

```bash
<Glob pattern="frontend/src/**/*.ts" />
<Glob pattern="backend/src/**/*.ts" />
<Glob pattern="shared/src/**/*.ts" />
```

### Step 1.4: Detect Single Module

Fallback: Check for src directory:

```bash
<Glob pattern="src/**/*.ts" />
```

### Step 1.5: Classification Logic

Based on findings, classify as:

- **Monorepo**: If `packages/` or `apps/` detected with multiple subdirectories
- **Microservices**: If `services/` detected with multiple services
- **Layered**: If frontend/backend/shared structure detected
- **Single Module**: Otherwise (default to `src/`)

**Decision Tree**:
```
Has packages/* or apps/* ?
  YES → Monorepo (Strategy A)
  NO  → Has services/* ?
         YES → Microservices (Strategy B)
         NO  → Has frontend/ and backend/ ?
                YES → Layered (Strategy C)
                NO  → Single Module (Strategy D)
```

---

## Phase 2: Analysis Strategy Selection

### Strategy A: Monorepo Analysis

**When**: `packages/` or `apps/` directory detected

**Steps**:
1. List all packages
2. For each package with `src/` directory:
   ```bash
   <Bash description="Analyze package: {package-name}">
   archguard analyze \
     -s ./packages/{package-name}/src \
     --name packages/{package-name} \
     --output-dir ./archguard \
     --verbose
   </Bash>
   ```
3. Collect results

**Expected Output**:
- `archguard/packages/{package-1}.png`
- `archguard/packages/{package-2}.png`
- ...
- `archguard/index.md` (with package dependencies)

---

### Strategy B: Microservices Analysis

**When**: `services/` directory detected

**Steps**:
1. List all services
2. For each service:
   ```bash
   <Bash description="Analyze service: {service-name}">
   archguard analyze \
     -s ./services/{service-name} \
     --name services/{service-name} \
     --output-dir ./archguard \
     --verbose
   </Bash>
   ```
3. Generate service dependency graph (if possible)

**Expected Output**:
- `archguard/services/{service-1}.png`
- `archguard/services/{service-2}.png`
- ...
- `archguard/index.md` (with service dependencies)

---

### Strategy C: Layered Architecture Analysis

**When**: frontend/, backend/, shared/ detected

**Steps**:
1. Analyze each layer:
   ```bash
   # Frontend
   <Bash description="Analyze frontend layer">
   archguard analyze \
     -s ./frontend/src \
     --name layers/frontend \
     --output-dir ./archguard \
     --verbose
   </Bash>

   # Backend
   <Bash description="Analyze backend layer">
   archguard analyze \
     -s ./backend/src \
     --name layers/backend \
     --output-dir ./archguard \
     --verbose
   </Bash>

   # Shared (if exists)
   <Bash description="Analyze shared layer">
   archguard analyze \
     -s ./shared/src \
     --name layers/shared \
     --output-dir ./archguard \
     --verbose
   </Bash>
   ```

**Expected Output**:
- `archguard/layers/frontend.png`
- `archguard/layers/backend.png`
- `archguard/layers/shared.png` (if exists)
- `archguard/index.md` (with cross-layer analysis)

---

### Strategy D: Single Module Analysis

**When**: Simple `src/` structure

**Steps**:
```bash
<Bash description="Analyze single module">
archguard analyze \
  -s ./src \
  --output-dir ./archguard \
  --verbose
</Bash>
```

**Expected Output**:
- `archguard/architecture.png`
- `archguard/architecture.puml`

---

## Phase 3: Command Execution

### Execution Pattern

For each module identified in Phase 2:

1. **Prepare**: Determine module name and source path
2. **Execute**: Run `archguard analyze` command
3. **Capture**: Capture stdout/stderr for progress reporting
4. **Handle Errors**: If command fails, log error and continue to next module
5. **Collect Metrics**: Track entities count, relations count, execution time

### Error Handling

**Error: Command not found**
```
Action: Inform user that ArchGuard is not installed
Provide installation instructions
```

**Error: No TypeScript files found**
```
Action: Skip module with warning
Continue to next module
```

**Error: Analysis timeout**
```
Action: Log timeout error
Suggest increasing timeout with --cli-timeout flag
Continue to next module
```

**Error: Claude CLI not available**
```
Action: Inform user that Claude Code CLI is required
Provide installation link
Exit gracefully
```

---

## Phase 4: Generate Index Page

**When**: Multiple modules analyzed (batch mode)

### Index Content Structure

```markdown
# Project Architecture Overview

**Generated**: {ISO-8601-timestamp}
**Project Type**: {Monorepo|Microservices|Layered|Single}
**Total Modules**: {count}
**Analysis Tool**: ArchGuard v{version}

---

## Modules

{for each analyzed module}
### {module-name}

- **Path**: `{source-path}`
- **Entities**: {entity-count}
- **Relations**: {relation-count}
- **Complexity**: {Low|Medium|High|Very High}
- **Diagram**: [View PNG]({relative-path-to-png})

![{module-name}]({relative-path-to-png})

---
{end for}

## Summary Statistics

- **Total Modules**: {count}
- **Total Entities**: {sum}
- **Total Relations**: {sum}
- **Average Complexity**: {avg}
- **Analysis Duration**: {duration}

## Architecture Insights

{insights based on analysis results}

---

*Generated by [ArchGuard](https://github.com/archguard/archguard) + Claude Code Skill*
```

### Insights Generation Logic

```
Insights to provide:
1. Most complex module (highest entity + relation count)
2. Least complex module
3. Average complexity
4. Recommendations:
   - If module > 50 entities: "Consider refactoring {module} - high complexity"
   - If circular dependencies detected: "Circular dependencies found between X and Y"
   - If no issues: "Architecture is well-structured ✅"
```

---

## Phase 5: User Feedback

### Feedback Format

Present results to user in this format:

```
✅ **Analysis Complete!**

📊 **Summary**:
- Project Type: {Monorepo|Microservices|Layered|Single}
- Modules Analyzed: {count}
- Total Entities: {total}
- Total Relations: {total}
- Analysis Duration: {duration}

🔗 **Output**:
- Index: `archguard/index.md`
- Diagrams:
  - `archguard/{module1}.png`
  - `archguard/{module2}.png`
  - ... ({count} total)

💡 **Insights**:
- {insight 1}
- {insight 2}
- {insight 3}

📖 **Next Steps**:
1. Review diagrams in `archguard/` directory
2. Check `index.md` for navigation and statistics
3. Consider refactoring high-complexity modules

{if errors occurred}
⚠️  **Warnings**:
- {error 1}
- {error 2}
{end if}
```

---

## Advanced Features

### Feature 1: Incremental Analysis

**Trigger**: User mentions "only changed" or "incremental"

**Steps**:
1. Use Git to detect changes:
   ```bash
   <Bash description="Get changed TypeScript files">
   git diff --name-only HEAD~10 | grep '\.ts$'
   </Bash>
   ```

2. Map changed files to modules (heuristic: extract directory name)

3. Only analyze affected modules

4. Add change indicator in index page

---

### Feature 2: Custom Output Directory

**Trigger**: User specifies output location

**Example**: "Generate diagrams in ./docs/architecture"

**Action**: Add `--output-dir ./docs/architecture` to all commands

---

### Feature 3: Verbose Mode

**Trigger**: User asks for "detailed" or "verbose" analysis

**Action**: Add `--verbose` flag to all commands

---

## Troubleshooting Guide

### Issue 1: ArchGuard Not Installed

**Detection**: `archguard` command fails

**Response**:
```
It appears ArchGuard is not installed. To install:

\`\`\`bash
npm install -g archguard
\`\`\`

Or using Yarn:
\`\`\`bash
yarn global add archguard
\`\`\`

After installation, try again.
```

---

### Issue 2: Claude CLI Not Available

**Detection**: ArchGuard reports "Claude Code CLI not found"

**Response**:
```
ArchGuard requires Claude Code CLI to generate diagrams.

To install Claude Code:
1. Visit: https://docs.anthropic.com/claude-code
2. Follow installation instructions
3. Verify: `claude --version`

After installation, try analysis again.
```

---

### Issue 3: No TypeScript Files Found

**Detection**: "No TypeScript files found" in output

**Response**:
```
No TypeScript files detected in the specified path.

Please verify:
1. This is a TypeScript project
2. Source files are in ./src or ./packages
3. Files have .ts extension

For non-TypeScript projects:
ArchGuard currently only supports TypeScript. Support for other languages is planned.
```

---

### Issue 4: Analysis Timeout

**Detection**: Command times out

**Response**:
```
Analysis timed out. This can happen for very large projects.

Suggestions:
1. Analyze specific modules instead of entire project
2. Increase timeout: add `--cli-timeout 180000` to command
3. Use batch mode for large monorepos

Example:
\`\`\`bash
archguard analyze -s ./packages/frontend --cli-timeout 180000
\`\`\`
```

---

### Issue 5: Permission Denied

**Detection**: Permission errors in output

**Response**:
```
Permission denied when creating output directory.

Solutions:
1. Run with appropriate permissions
2. Change output directory to writable location:
   \`\`\`bash
   archguard analyze --output-dir ~/archguard-output
   \`\`\`
```

---

## Configuration Options

Users can customize behavior by mentioning:

- **"Use verbose mode"**: Adds `--verbose` flag
- **"Output to ./docs"**: Sets `--output-dir ./docs`
- **"Don't generate index"**: Skips index.md creation (single module only)
- **"Use JSON format"**: Sets `--format json` (outputs ArchJSON instead of diagrams)
- **"Analyze only {module}"**: Focuses on specific module

---

## Examples

### Example 1: Auto-detect and Analyze

**User**: "Analyze this project's architecture"

**Skill Actions**:
1. Detects monorepo (8 packages)
2. Runs `archguard analyze` for each package
3. Generates index with package list
4. Returns: "✅ Analyzed 8 packages, see `archguard/index.md`"

---

### Example 2: Specific Module

**User**: "Analyze the frontend module"

**Skill Actions**:
1. Locates `frontend/` or `packages/frontend/`
2. Runs: `archguard analyze -s ./frontend --name frontend`
3. Returns diagram and statistics

---

### Example 3: Incremental Analysis

**User**: "Analyze only changed modules"

**Skill Actions**:
1. Runs: `git diff --name-only HEAD~10 | grep '\.ts$'`
2. Maps files to modules
3. Analyzes only affected modules
4. Returns change report

---

## Tips for Best Results

1. **For large monorepos**: Skill will automatically use batch mode
2. **For incremental updates**: Mention "only changed" or "incremental"
3. **For custom output**: Specify output directory upfront
4. **For detailed analysis**: Ask for "verbose" or "detailed" analysis

---

**End of Instructions**
````

---

## 3. 实施步骤详细分解

### Phase 1: Skill 基础设施 (1 天)

#### 任务 1.1: 创建 Skill 目录结构 (2 小时)
```bash
mkdir -p ~/.claude/skills/archguard-analyzer/{templates,examples,docs}
```

- [ ] 创建目录结构
- [ ] 初始化 git 仓库（用于版本控制）
- [ ] 创建 .gitignore

**验收标准**:
- 目录结构符合设计
- git 初始化完成

---

#### 任务 1.2: 编写 skill.json (2 小时)
- [ ] 定义元数据（name, version, author）
- [ ] 配置激活条件（keywords, patterns）
- [ ] 声明所需工具（Bash, Glob, Read, Write）
- [ ] 定义配置选项

**验收标准**:
- JSON 格式正确
- 激活关键词覆盖主要场景（≥ 8 个）
- 符合 Claude Code Skill 规范

---

#### 任务 1.3: 创建 README.md (2 小时)
- [ ] Skill 介绍
- [ ] 安装指南
- [ ] 快速开始
- [ ] 功能特性列表
- [ ] 许可证信息

**验收标准**:
- 文档清晰完整
- 包含安装命令
- 包含使用示例

---

#### 任务 1.4: 创建基础文档 (2 小时)
- [ ] docs/installation.md - 详细安装指南
- [ ] docs/troubleshooting.md - 故障排除指南
- [ ] docs/faq.md - 常见问题

**验收标准**:
- 文档完整覆盖基础场景
- 包含截图或示例（如果需要）

---

### Phase 2: 核心逻辑开发 (2-3 天)

#### 任务 2.1: 编写 instructions.md - 项目检测部分 (4 小时)
- [ ] Phase 1: Project Structure Detection 逻辑
- [ ] 4 种项目类型检测规则
- [ ] 决策树实现
- [ ] 错误处理

**验收标准**:
- 逻辑清晰可执行
- 覆盖 4 种项目类型
- 包含 fallback 逻辑

---

#### 任务 2.2: 编写 instructions.md - 策略选择部分 (6 小时)
- [ ] Strategy A: Monorepo
- [ ] Strategy B: Microservices
- [ ] Strategy C: Layered
- [ ] Strategy D: Single Module

**验收标准**:
- 每个策略有明确的触发条件
- 命令模板正确
- 参数使用合理

---

#### 任务 2.3: 编写 instructions.md - 索引生成部分 (3 小时)
- [ ] Index Markdown 模板
- [ ] 洞察生成逻辑
- [ ] 统计计算公式

**验收标准**:
- Markdown 格式正确
- 洞察有实际价值
- 统计准确

---

#### 任务 2.4: 编写 instructions.md - 反馈和错误处理 (3 小时)
- [ ] Phase 5: User Feedback 格式
- [ ] 错误处理流程
- [ ] Troubleshooting Guide

**验收标准**:
- 反馈格式友好清晰
- 错误消息有帮助性
- 包含可操作的建议

---

### Phase 3: 模板和示例 (1 天)

#### 任务 3.1: 创建模板文件 (3 小时)
- [ ] templates/index-template.md
- [ ] templates/summary-template.md
- [ ] templates/insights-template.md

**验收标准**:
- 模板变量清晰标注（{variable}）
- 格式美观易读
- 支持条件渲染

---

#### 任务 3.2: 创建示例文件 (4 小时)
- [ ] examples/monorepo-analysis.md
- [ ] examples/microservices-analysis.md
- [ ] examples/layered-analysis.md
- [ ] examples/incremental-analysis.md

**验收标准**:
- 示例真实可用
- 包含用户输入和 Skill 输出
- 覆盖主要使用场景

---

#### 任务 3.3: 创建使用指南 (1 小时)
- [ ] docs/usage-guide.md - 详细使用文档

**验收标准**:
- 包含多个真实示例
- 覆盖常见问题
- 包含最佳实践

---

### Phase 4: 测试和优化 (1-2 天)

#### 任务 4.1: 真实项目测试 - Monorepo (2 小时)
- [ ] 准备测试 Monorepo 项目
- [ ] 执行 Skill 测试
- [ ] 记录问题和改进点

**测试项目**: Lerna/Nx monorepo with 5+ packages

**验收标准**:
- Skill 正确检测为 Monorepo
- 所有 packages 都被分析
- 索引页面生成正确

---

#### 任务 4.2: 真实项目测试 - 微服务 (2 小时)
- [ ] 准备测试微服务项目
- [ ] 执行 Skill 测试
- [ ] 记录问题和改进点

**测试项目**: Services directory with 3+ services

**验收标准**:
- Skill 正确检测为 Microservices
- 所有 services 都被分析
- 服务依赖分析正确（如果实现）

---

#### 任务 4.3: 真实项目测试 - 分层架构 (2 小时)
- [ ] 准备测试分层项目
- [ ] 执行 Skill 测试
- [ ] 记录问题和改进点

**测试项目**: Frontend/Backend/Shared structure

**验收标准**:
- Skill 正确检测为 Layered
- 3 层都被分析
- 跨层依赖分析有意义

---

#### 任务 4.4: 边缘情况测试 (2 小时)
- [ ] ArchGuard 未安装场景
- [ ] Claude CLI 未安装场景
- [ ] 无 TypeScript 文件场景
- [ ] 权限错误场景
- [ ] 超时场景

**验收标准**:
- 所有错误都有友好的提示
- 提供可操作的解决方案
- 不会 crash 或陷入死循环

---

#### 任务 4.5: Prompt 优化 (2 小时)
- [ ] 优化激活关键词
- [ ] 优化 instructions 措辞
- [ ] 简化复杂逻辑

**验收标准**:
- 激活成功率 > 90%
- 指令清晰易懂
- 执行流程顺畅

---

### Phase 5: 文档和发布 (1 天)

#### 任务 5.1: 完善文档 (3 小时)
- [ ] 完善 README.md
- [ ] 完善所有 docs/ 文档
- [ ] 添加截图/GIF（如果需要）
- [ ] Review 所有文档

**验收标准**:
- 文档完整无遗漏
- 语言清晰专业
- 示例可运行

---

#### 任务 5.2: 创建演示材料 (2 小时)
- [ ] 录制演示视频或 GIF
- [ ] 创建 before/after 对比
- [ ] 准备社区发布内容

**验收标准**:
- 演示清晰易懂（2-3 分钟）
- 展示核心价值
- 适合社交媒体分享

---

#### 任务 5.3: 发布到 GitHub (2 小时)
- [ ] 创建 archguard/claude-skills 仓库
- [ ] 推送 Skill 文件
- [ ] 创建 Release v1.0.0
- [ ] 编写 Release Notes

**验收标准**:
- 仓库结构清晰
- Release Notes 完整
- 包含安装脚本

---

#### 任务 5.4: 更新 ArchGuard 主仓库 (1 小时)
- [ ] 在 ArchGuard README 添加 "Claude Code Integration" 章节
- [ ] 链接到 Skill 仓库
- [ ] 更新 CLAUDE.md

**验收标准**:
- 主仓库文档更新
- 链接正确可访问

---

## 4. 测试策略

### 4.1 功能测试矩阵

| 场景 | 输入 | 预期检测结果 | 预期输出 | 状态 |
|------|------|------------|---------|------|
| Monorepo | Lerna 项目 | Monorepo (Strategy A) | N 个包的图 + 索引 | ⏳ |
| 微服务 | services/ 目录 | Microservices (Strategy B) | N 个服务图 + 索引 | ⏳ |
| 分层 | frontend/backend | Layered (Strategy C) | 3 层图 + 索引 | ⏳ |
| 单模块 | 简单 src/ | Single (Strategy D) | 1 个图 | ⏳ |
| 无 ArchGuard | 未安装 | - | 安装提示 | ⏳ |
| 无 TS 文件 | 空项目 | - | 友好错误消息 | ⏳ |

---

### 4.2 激活测试

测试不同的用户输入是否正确激活 Skill:

| 用户输入 | 应该激活 | 实际结果 | 状态 |
|---------|---------|---------|------|
| "analyze architecture" | ✅ Yes | - | ⏳ |
| "generate architecture diagram" | ✅ Yes | - | ⏳ |
| "show me the project structure" | ✅ Yes | - | ⏳ |
| "analyze all packages" | ✅ Yes | - | ⏳ |
| "what is the architecture" | ✅ Yes | - | ⏳ |
| "help me understand the code" | ❌ No | - | ⏳ |
| "write a function" | ❌ No | - | ⏳ |

目标: ≥ 90% 准确率（True Positive + True Negative）

---

### 4.3 端到端测试清单

- [ ] E2E 1: Monorepo 完整流程（检测 → 分析 → 索引 → 反馈）
- [ ] E2E 2: 微服务完整流程
- [ ] E2E 3: 分层架构完整流程
- [ ] E2E 4: 错误处理流程（ArchGuard 未安装）
- [ ] E2E 5: 增量分析流程（如果实现）

---

## 5. 质量门控

### 5.1 文档质量

- [ ] 所有 Markdown 文件格式正确
- [ ] 所有代码示例可运行
- [ ] 所有链接有效
- [ ] 拼写检查通过
- [ ] 语法检查通过

---

### 5.2 功能验收

**Skill 元数据**:
- [ ] skill.json 格式正确
- [ ] 激活关键词 ≥ 8 个
- [ ] 所需工具声明完整

**核心逻辑**:
- [ ] 4 种项目类型都能正确检测
- [ ] 命令模板正确
- [ ] 错误处理完善
- [ ] 反馈格式友好

**文档**:
- [ ] README 清晰完整
- [ ] 安装指南准确
- [ ] 使用示例可运行
- [ ] 故障排除有帮助

---

### 5.3 用户体验

- [ ] Skill 激活成功率 > 90%
- [ ] 首次使用无需阅读文档
- [ ] 错误消息有帮助性
- [ ] 输出格式美观清晰

---

## 6. 风险管理

### 6.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| Claude Code Skill API 限制 | 中 | 中 | 详细测试，准备备选方案 |
| 项目检测不准确 | 中 | 中 | 提供手动指定模式选项 |
| Skill 激活失败 | 低 | 高 | 多个激活关键词，宽泛的模式匹配 |

---

### 6.2 用户采用风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 用户不知道 Skill 存在 | 高 | 高 | 文档、视频、社区推广 |
| 安装复杂 | 中 | 中 | 提供一键安装脚本 |
| 功能不够强大 | 低 | 中 | 持续迭代，收集反馈 |

---

## 7. 里程碑

| 里程碑 | 目标日期 | 交付物 | 状态 |
|--------|---------|--------|------|
| M1: 基础设施 | Day 1 | 目录结构 + skill.json + README | ⏳ |
| M2: 核心逻辑 | Day 3 | instructions.md 完整 | ⏳ |
| M3: 模板示例 | Day 4 | 所有模板和示例文件 | ⏳ |
| M4: 测试完成 | Day 5 | 3 种项目类型测试通过 | ⏳ |
| M5: 文档完善 | Day 6 | 所有文档 + 演示材料 | ⏳ |
| M6: 正式发布 | Day 6 | GitHub Release v1.0.0 | ⏳ |

---

## 8. 发布计划

### 8.1 发布检查清单

**代码质量**:
- [ ] 所有 Markdown 文件格式验证通过
- [ ] 所有 JSON 文件格式验证通过
- [ ] 链接检查通过
- [ ] 拼写检查通过

**功能**:
- [ ] 3 种主要项目类型测试通过
- [ ] 错误处理测试通过
- [ ] Skill 激活测试通过

**文档**:
- [ ] README.md 完整
- [ ] Installation guide 准确
- [ ] Usage guide 清晰
- [ ] Troubleshooting guide 有帮助
- [ ] Examples 可运行

**发布材料**:
- [ ] Release Notes 编写
- [ ] 演示视频/GIF 准备
- [ ] 社区发布内容准备

---

### 8.2 安装脚本

创建一键安装脚本：

```bash
#!/bin/bash
# install-archguard-skill.sh

set -e

SKILL_NAME="archguard-analyzer"
SKILL_DIR="$HOME/.claude/skills/$SKILL_NAME"
REPO_URL="https://github.com/archguard/claude-skills.git"

echo "🚀 Installing ArchGuard Analyzer Skill..."

# 1. 检查 Claude Code
if ! command -v claude &> /dev/null; then
    echo "❌ Claude Code not found. Please install Claude Code first."
    echo "Visit: https://docs.anthropic.com/claude-code"
    exit 1
fi

echo "✅ Claude Code found: $(claude --version)"

# 2. 检查 ArchGuard
if ! command -v archguard &> /dev/null; then
    echo "⚠️  ArchGuard not found. Installing..."
    npm install -g archguard
fi

echo "✅ ArchGuard found: $(archguard --version)"

# 3. 创建 skills 目录
mkdir -p "$HOME/.claude/skills"

# 4. 克隆或更新
if [ -d "$SKILL_DIR" ]; then
    echo "📦 Updating existing skill..."
    cd "$SKILL_DIR" && git pull
else
    echo "📥 Downloading skill..."
    git clone "$REPO_URL" /tmp/claude-skills-temp
    cp -r "/tmp/claude-skills-temp/$SKILL_NAME" "$SKILL_DIR"
    rm -rf /tmp/claude-skills-temp
fi

# 5. 验证安装
if [ -f "$SKILL_DIR/skill.json" ]; then
    echo "✅ Installation complete!"
    echo ""
    echo "📖 To use the skill:"
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

## 9. 社区推广计划

### 9.1 发布渠道

1. **GitHub**:
   - archguard/claude-skills 仓库
   - archguard/archguard 仓库（主项目）README 更新

2. **文档**:
   - 在 ArchGuard 官方文档添加 "Claude Code Integration" 页面

3. **社交媒体**:
   - Twitter/X 发布（带演示 GIF）
   - LinkedIn 分享

4. **社区**:
   - Claude Code 官方论坛（如果有）
   - Reddit r/ClaudeAI
   - Hacker News（Show HN）

5. **博客**:
   - Medium 文章："Intelligent Architecture Analysis with Claude Code"
   - Dev.to 文章

---

### 9.2 发布内容模板

**Twitter/X 帖子**:
```
🚀 Introducing ArchGuard Analyzer Skill for Claude Code!

Analyze TypeScript architecture with natural language:
"Analyze this project's architecture" → Complete diagrams + insights

✨ Auto-detects: Monorepo, Microservices, Layered architectures
📊 Generates: PlantUML diagrams + Navigation index
💡 Provides: Architecture insights & recommendations

Install: [link]
Demo: [gif]

#ClaudeCode #Architecture #TypeScript
```

**GitHub Release Notes**:
```markdown
# ArchGuard Analyzer Skill v1.0.0

## 🎉 Initial Release

Intelligent multi-module TypeScript architecture analysis for Claude Code.

### Features

- 🔍 **Auto-Detection**: Automatically detects Monorepo, Microservices, Layered, and Single module structures
- 📊 **Batch Analysis**: Analyzes all modules in one command
- 🗂️ **Smart Indexing**: Generates navigation index with statistics
- 💡 **Architecture Insights**: Provides complexity analysis and recommendations
- ⚡ **Natural Language**: Just say "analyze architecture" - no commands to memorize

### Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/archguard/claude-skills/main/install.sh | bash
```

### Usage

1. Open a TypeScript project in Claude Code
2. Say: "Analyze this project's architecture"
3. Review diagrams in `archguard/` directory

### What's Included

- ✅ Support for 4 project types
- ✅ Complete documentation
- ✅ Error handling and troubleshooting
- ✅ Real-world examples
- ✅ Installation script

### Requirements

- Claude Code ≥ 1.0.0
- ArchGuard ≥ 1.2.0 (auto-installed if missing)

See [README.md](README.md) for full documentation.
```

---

## 10. 成功度量

### 10.1 定量指标

- ✅ Skill 安装量 > 100 (3 个月内)
- ✅ GitHub Stars > 50 (3 个月内)
- ✅ 用户反馈评分 > 4.5/5
- ✅ Skill 激活成功率 > 90%
- ✅ 错误率 < 5%

---

### 10.2 定性指标

- ✅ 用户证言收集 > 5 条
- ✅ 社区文章/博客 > 3 篇
- ✅ 成为 Claude Code Skill 推荐案例
- ✅ 社区贡献 PR > 2 个

---

## 附录 A: 文件清单

```
~/.claude/skills/archguard-analyzer/
├── skill.json                          # Skill 元数据
├── instructions.md                     # 核心执行逻辑
├── README.md                           # Skill 介绍
│
├── templates/                          # 模板文件
│   ├── index-template.md
│   ├── summary-template.md
│   └── insights-template.md
│
├── examples/                           # 使用示例
│   ├── monorepo-analysis.md
│   ├── microservices-analysis.md
│   ├── layered-analysis.md
│   └── incremental-analysis.md
│
├── docs/                               # 文档
│   ├── installation.md
│   ├── usage-guide.md
│   ├── troubleshooting.md
│   └── faq.md
│
├── scripts/                            # 辅助脚本
│   └── install.sh                      # 一键安装脚本
│
└── LICENSE                             # MIT 许可证
```

---

## 附录 B: 参考资料

- [Proposal 08: Claude Code Subagent Integration](../proposals/08-claude-code-subagent-integration.md)
- [Claude Code Skills Documentation](https://docs.anthropic.com/claude-code/skills)
- [ArchGuard CLI Documentation](../../CLAUDE.md)
- [RLM 方法论](../proposals/README.md#rlm-方法论说明)

---

**文档作者**: Claude Code (AI Assistant)
**最后更新**: 2026-01-25
**文档状态**: ✅ 完成
**下一步**: 开始 Phase 1 实施，创建 Skill 基础设施
