# ArchGuard MVP 实施计划 (RLM 方法)

**项目名称**: ArchGuard - 自动化架构文档生成工具
**计划版本**: 1.0
**创建日期**: 2026-01-25
**方法论**: RLM (Refactoring Lifecycle Management)
**开发方法**: TDD (Test-Driven Development)

---

## 📋 执行摘要

本计划采用 RLM 方法论，通过迭代、增量的方式实现 ArchGuard 的核心功能：**高效代码指纹提取** 和 **Claude Code 命令行驱动的 PlantUML 文档生成**。计划分为 3 个主要阶段，每个阶段都遵循 TDD 方法，以 ArchGuard 项目本身作为验证用例。

---

## 1. RLM PROPOSAL - 项目提案

### 1.1 项目背景

**问题陈述**:
- 架构文档与代码不同步是软件项目的普遍痛点
- 手动维护架构图表耗时且容易出错
- 现有工具大多侧重静态分析，缺乏 AI 驱动的智能文档生成

**机会**:
- Claude Code 提供了强大的 AI 能力和命令行集成
- PlantUML 是成熟的文本化架构图表工具
- TypeScript 项目丰富的类型信息可用于精确的代码指纹提取

### 1.2 项目目标

#### 主目标
构建一个自动化工具，能够：
1. **高效提取代码指纹** - 从 TypeScript 代码中提取结构化架构信息
2. **智能生成文档** - 使用 Claude Sonnet 模型生成高质量 PlantUML 类图
3. **命令行驱动** - 通过简单的 CLI 命令触发文档生成
4. **自我验证** - 以 ArchGuard 项目自身为测试用例

#### 成功标准
- ✅ 能够解析 ArchGuard 项目的所有 TypeScript 文件
- ✅ 生成的 PlantUML 代码语法正确率 > 95%
- ✅ 完整文档生成时间 < 10 秒
- ✅ 测试覆盖率 > 80%

### 1.3 项目范围

#### 包含范围 (In Scope)
- ✅ TypeScript 代码解析（类、接口、方法）
- ✅ 结构化数据格式（Arch-JSON）
- ✅ Claude Sonnet 集成
- ✅ PlantUML 类图生成
- ✅ CLI 命令行工具
- ✅ 基本缓存机制

#### 不包含范围 (Out of Scope)
- ❌ 多语言支持（Java、Python 等）- 留待后续阶段
- ❌ 序列图、组件图等其他图表类型
- ❌ Web UI 界面
- ❌ Git Hook 自动触发
- ❌ 语义缓存

### 1.4 关键假设与约束

**假设**:
- 用户已安装 Node.js >= 18.0
- 用户有 Anthropic API Key
- 项目使用 TypeScript

**约束**:
- 开发周期：2-3 周
- 团队规模：1-2 人
- 预算：AI 成本 < $50/月（开发期）

---

## 2. RLM PLANNING - 计划阶段

### 2.1 技术架构

```
┌─────────────────────────────────────────────────────────┐
│                    CLI Interface                        │
│                  (archguard-cli)                        │
└──────────────────┬──────────────────────────────────────┘
                   │
       ┌───────────┴───────────┐
       │                       │
┌──────▼──────┐       ┌───────▼────────┐
│   Parser    │       │  AI Generator  │
│  (ts-morph) │       │ (Claude Sonnet)│
└──────┬──────┘       └───────┬────────┘
       │                      │
       │   ┌──────────────────┘
       │   │
┌──────▼───▼──────┐
│   Arch-JSON     │
│  (Data Model)   │
└─────────────────┘
```

### 2.2 核心组件

#### 2.2.1 代码指纹提取器 (Code Fingerprint Extractor)

**职责**: 解析 TypeScript 代码，提取结构化信息

**技术栈**: ts-morph

**输入**: TypeScript 源文件
**输出**: Arch-JSON 格式

```typescript
interface ArchJSON {
  version: string;
  language: 'typescript';
  timestamp: string;
  entities: Entity[];
  relations: Relation[];
}

interface Entity {
  id: string;
  name: string;
  type: 'class' | 'interface' | 'enum';
  visibility: 'public' | 'private' | 'protected';
  members: Member[];
  sourceLocation: {
    file: string;
    startLine: number;
    endLine: number;
  };
}
```

#### 2.2.2 Claude Code CLI 集成层 (Claude Code CLI Integration)

**职责**: 调用 Claude Code 命令行工具生成 PlantUML

**技术栈**: Claude Code CLI (通过 child_process/execa 调用)

**输入**: Arch-JSON + 提示词模板
**输出**: PlantUML 代码字符串

**工具**: claude-code CLI

#### 2.2.3 CLI 工具

**命令**:
```bash
archguard generate [options]

选项:
  --input, -i    输入目录 (默认: src/)
  --output, -o   输出文件 (默认: docs/architecture.puml)
  --model, -m    AI 模型 (默认: claude-3-5-sonnet-20241022)
  --cache        启用缓存 (默认: true)
```

### 2.3 迭代划分

#### Phase 0: 环境准备 (1 天)
**目标**: 搭建项目骨架，配置开发环境

**任务**:
- 初始化 TypeScript 项目
- 配置测试框架 (Vitest)
- 设置 ESLint + Prettier
- 创建项目目录结构

**交付物**:
- 项目骨架代码
- `package.json` 配置完成
- CI 配置（GitHub Actions）

---

#### Phase 1: 代码指纹提取 (3-4 天)
**目标**: 实现高效的 TypeScript 代码解析和 Arch-JSON 生成

**重点**:
- ✅ TDD 驱动开发
- ✅ 高测试覆盖率
- ✅ 性能优化

**详细计划**: 参见 `01-phase1-code-fingerprint.md`

---

#### Phase 2: Claude Code CLI 集成与文档生成 (3-4 天)
**目标**: 集成 Claude Code CLI，生成高质量 PlantUML

**重点**:
- ✅ CLI 封装
- ✅ 提示词模板
- ✅ 输出解析验证

**详细计划**: 参见 `02-phase2-claude-code-integration.md`

---

#### Phase 3: CLI 与优化 (2-3 天)
**目标**: 开发命令行工具，优化性能和用户体验

**重点**:
- ✅ 用户友好的 CLI
- ✅ 缓存机制
- ✅ 错误处理

**详细计划**: 参见 `03-phase3-cli-optimization.md`

### 2.4 TDD 开发流程

本项目严格遵循 TDD 方法论：

```
红 → 绿 → 重构
(测试失败) → (测试通过) → (优化代码)
```

#### TDD 步骤

1. **写测试** (Red Phase)
   ```typescript
   describe('TypeScriptParser', () => {
     it('should extract class information', () => {
       const code = `
         export class UserService {
           private db: Database;

           async findUser(id: string): Promise<User> {
             return this.db.query(id);
           }
         }
       `;

       const result = parser.parse(code);

       expect(result.entities).toHaveLength(1);
       expect(result.entities[0].name).toBe('UserService');
       expect(result.entities[0].members).toHaveLength(2);
     });
   });
   ```

2. **实现功能** (Green Phase)
   - 编写最小可用代码让测试通过
   - 不过度设计

3. **重构** (Refactor Phase)
   - 消除代码重复
   - 改进代码结构
   - 保持测试通过

#### 测试金字塔

```
       ┌─────┐
       │ E2E │ 10%
       └─────┘
      ┌───────┐
      │ 集成  │ 30%
      └───────┘
    ┌───────────┐
    │  单元测试 │ 60%
    └───────────┘
```

**单元测试** (60%):
- 每个函数/方法的独立测试
- Mock 外部依赖
- 快速执行（< 100ms）

**集成测试** (30%):
- 组件间协作测试
- 真实依赖（如 ts-morph）
- 中等速度（< 1s）

**E2E 测试** (10%):
- 完整流程测试
- 使用真实项目
- 较慢（< 10s）

### 2.5 技术栈

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 语言 | TypeScript | ^5.3.0 | 开发语言 |
| 运行时 | Node.js | >=18.0.0 | 运行环境 |
| 解析器 | ts-morph | ^21.0.0 | TypeScript AST 解析 |
| CLI 集成 | Claude Code CLI | - | PlantUML 生成 (通过命令行) |
| 进程管理 | execa | ^8.0.0 | 子进程调用 |
| 测试框架 | Vitest | ^1.2.0 | 单元测试 |
| CLI | commander | ^11.1.0 | 命令行工具 |
| 日志 | pino | ^8.17.0 | 结构化日志 |

---

## 3. RLM EXECUTION - 执行阶段

### 3.1 开发工作流

#### 每日流程

1. **晨会** (9:00-9:15, 15min)
   - 昨日完成内容
   - 今日计划
   - 阻塞问题

2. **开发时段** (9:15-12:00, 2.75h)
   - TDD 循环开发
   - 每 25 分钟休息 5 分钟（番茄工作法）

3. **午休** (12:00-13:30)

4. **开发时段** (13:30-17:30, 4h)
   - 继续 TDD 开发
   - 代码审查
   - 文档更新

5. **每日总结** (17:30-18:00, 30min)
   - 提交代码
   - 更新进度
   - 记录问题

#### 每周流程

- **周一**: Sprint 计划会议（1h）
- **周三**: 技术分享（30min）
- **周五**: Sprint 回顾 + Demo（1h）

### 3.2 Git 工作流

采用 **GitHub Flow**:

```bash
# 1. 创建功能分支
git checkout -b feature/parser-class-extraction

# 2. TDD 开发
# - 写测试
# - 实现功能
# - 重构

# 3. 提交代码
git add .
git commit -m "feat: implement class extraction

- Add ClassExtractor with ts-morph
- Extract class name, members, visibility
- Test coverage: 85%

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# 4. 推送并创建 PR
git push -u origin feature/parser-class-extraction
gh pr create --title "feat: Class Extraction" --body "..."

# 5. 合并后删除分支
git branch -d feature/parser-class-extraction
```

### 3.3 代码审查检查清单

**TDD 合规性**:
- [ ] 所有新功能都有对应测试
- [ ] 测试先于实现编写
- [ ] 测试覆盖率 ≥ 80%

**代码质量**:
- [ ] 遵循 TypeScript 最佳实践
- [ ] 无 ESLint 错误
- [ ] 变量命名清晰
- [ ] 函数职责单一

**文档**:
- [ ] 公共 API 有 JSDoc 注释
- [ ] README 已更新
- [ ] CHANGELOG 已更新

---

## 4. RLM VALIDATION - 验证阶段

### 4.1 测试策略

#### 4.1.1 单元测试

**框架**: Vitest

**覆盖率目标**: ≥ 80%

**示例**:
```typescript
// __tests__/parser/class-extractor.test.ts

import { describe, it, expect } from 'vitest';
import { ClassExtractor } from '@/parser/class-extractor';

describe('ClassExtractor', () => {
  const extractor = new ClassExtractor();

  describe('extractClass', () => {
    it('should extract simple class', () => {
      const code = 'export class User {}';
      const result = extractor.extractClass(code);

      expect(result).toEqual({
        name: 'User',
        type: 'class',
        visibility: 'public',
        members: []
      });
    });

    it('should extract class with methods', () => {
      const code = `
        class UserService {
          findUser(id: string): User {
            return null;
          }
        }
      `;

      const result = extractor.extractClass(code);

      expect(result.members).toHaveLength(1);
      expect(result.members[0]).toMatchObject({
        name: 'findUser',
        type: 'method',
        parameters: [{ name: 'id', type: 'string' }],
        returnType: 'User'
      });
    });

    it('should handle decorators', () => {
      const code = `
        @Injectable()
        export class AuthService {}
      `;

      const result = extractor.extractClass(code);

      expect(result.decorators).toContainEqual({
        name: 'Injectable'
      });
    });
  });
});
```

#### 4.1.2 集成测试

**目标**: 验证组件间协作

**示例**:
```typescript
// __tests__/integration/parser.test.ts

describe('Parser Integration', () => {
  it('should parse entire ArchGuard project', async () => {
    const parser = new TypeScriptParser();
    const archJson = await parser.parseProject('.');

    // 验证基本结构
    expect(archJson.entities.length).toBeGreaterThan(0);
    expect(archJson.relations.length).toBeGreaterThan(0);

    // 验证 schema
    expect(validateArchJSON(archJson)).toBe(true);
  });

  it('should generate PlantUML from parsed code', async () => {
    const parser = new TypeScriptParser();
    const generator = new PlantUMLGenerator();

    const archJson = await parser.parseProject('./src');
    const puml = await generator.generate(archJson);

    // 验证语法
    expect(puml).toContain('@startuml');
    expect(puml).toContain('@enduml');
    expect(validatePlantUML(puml)).toBe(true);
  });
});
```

#### 4.1.3 E2E 测试

**目标**: 验证完整工作流

**示例**:
```typescript
// __tests__/e2e/cli.test.ts

describe('CLI E2E Tests', () => {
  it('should generate architecture diagram for self', async () => {
    // 执行 CLI 命令
    const { exitCode, stdout, stderr } = await execCLI([
      'generate',
      '--input', './src',
      '--output', './tmp/test.puml'
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');

    // 验证输出文件
    const content = await fs.readFile('./tmp/test.puml', 'utf-8');
    expect(content).toContain('class TypeScriptParser');
    expect(content).toContain('class PlantUMLGenerator');

    // 验证可渲染
    const svg = await renderPlantUML(content);
    expect(svg).toContain('<svg');
  });
});
```

### 4.2 质量门控

#### 合并前检查

```yaml
# .github/workflows/quality-gates.yml

name: Quality Gates

on: [pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Type check
        run: npm run type-check

      - name: Unit tests
        run: npm test -- --coverage

      - name: Check coverage
        run: |
          COVERAGE=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
          if (( $(echo "$COVERAGE < 80" | bc -l) )); then
            echo "Coverage $COVERAGE% is below 80%"
            exit 1
          fi

      - name: Integration tests
        run: npm run test:integration

      - name: E2E tests
        run: npm run test:e2e
        # Note: Requires Claude Code CLI to be installed and configured

  quality-gate:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - name: All checks passed
        run: echo "✅ Quality gates passed"
```

### 4.3 验收标准

#### Phase 1 验收标准

- [ ] **功能完整性**
  - [ ] 能解析 TypeScript 类、接口、枚举
  - [ ] 提取方法、属性、参数
  - [ ] 识别可见性修饰符
  - [ ] 处理装饰器

- [ ] **质量指标**
  - [ ] 单元测试覆盖率 ≥ 80%
  - [ ] 0 个 critical bugs
  - [ ] 0 个 ESLint 错误

- [ ] **性能指标**
  - [ ] 解析 ArchGuard 项目 < 2s
  - [ ] 内存使用 < 200MB

#### Phase 2 验收标准

- [ ] **功能完整性**
  - [ ] 成功调用 Claude API
  - [ ] 生成有效的 PlantUML 代码
  - [ ] 语法正确率 ≥ 95%

- [ ] **质量指标**
  - [ ] AI 调用成功率 ≥ 99%
  - [ ] 输出验证通过率 100%

- [ ] **成本指标**
  - [ ] 单次生成成本 < $0.05

#### Phase 3 验收标准

- [ ] **功能完整性**
  - [ ] CLI 命令正常工作
  - [ ] 缓存功能有效
  - [ ] 错误提示友好

- [ ] **用户体验**
  - [ ] 完整流程 < 10s
  - [ ] 进度显示清晰
  - [ ] 帮助文档完整

---

## 5. RLM INTEGRATION - 集成阶段

### 5.1 集成策略

#### 5.1.1 持续集成 (CI)

**GitHub Actions 工作流**:

```yaml
# .github/workflows/ci.yml

name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20]

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v3
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Test
        run: npm test -- --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run lint
      - run: npm run type-check
```

#### 5.1.2 发布流程

**语义化版本**:

```bash
# 初始版本
npm version 0.1.0

# 后续版本
npm version patch  # 0.1.1 - bug 修复
npm version minor  # 0.2.0 - 新功能
npm version major  # 1.0.0 - 破坏性变更
```

**发布检查清单**:
- [ ] 所有测试通过
- [ ] 代码覆盖率 ≥ 80%
- [ ] CHANGELOG.md 已更新
- [ ] README.md 已更新
- [ ] 版本号已更新
- [ ] Git tag 已创建

### 5.2 部署策略

#### npm 发布

```yaml
# .github/workflows/publish.yml

name: Publish to npm

on:
  release:
    types: [created]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          registry-url: 'https://registry.npmjs.org'

      - run: npm ci
      - run: npm test
      - run: npm run build

      - name: Publish
        run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## 6. RLM MONITORING - 监控阶段

### 6.1 关键指标

#### 开发指标

| 指标 | 目标 | 监控方式 |
|------|------|---------|
| 测试覆盖率 | ≥ 80% | Codecov |
| 构建时间 | < 1min | GitHub Actions |
| 测试执行时间 | < 10s | CI logs |
| 代码重复率 | < 3% | SonarQube |

#### 性能指标

| 指标 | 目标 | 监控方式 |
|------|------|---------|
| 解析时间 | < 2s/100文件 | 性能测试 |
| 内存使用 | < 200MB | 负载测试 |
| AI 调用延迟 | < 3s (P95) | 日志分析 |
| 缓存命中率 | > 70% | 内置统计 |

#### 质量指标

| 指标 | 目标 | 监控方式 |
|------|------|---------|
| PlantUML 语法正确率 | ≥ 95% | 自动验证 |
| AI 调用成功率 | ≥ 99% | 错误日志 |
| 用户报告 Bug | < 5/月 | GitHub Issues |

### 6.2 日志策略

**结构化日志**:

```typescript
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true
    }
  }
});

// 使用示例
logger.info({
  event: 'parsing.started',
  fileCount: 42,
  timestamp: Date.now()
});

logger.warn({
  event: 'ai.call.slow',
  duration: 5234,
  model: 'claude-3-5-sonnet'
});

logger.error({
  event: 'validation.failed',
  error: err.message,
  file: 'UserService.ts'
});
```

### 6.3 持续改进

#### 每周回顾

**模板**:
```markdown
## Week X Retrospective

### 完成的工作
- ✅ [TASK-123] 实现 ClassExtractor
- ✅ [TASK-124] 添加装饰器支持

### 指标回顾
- 测试覆盖率: 82% (↑2%)
- 解析性能: 1.2s/100文件 (✅ 达标)
- AI 成功率: 98.5% (⚠️ 低于目标)

### 问题与阻塞
- ⚠️ AI 偶尔超时，需要添加重试机制
- 📝 文档需要补充更多示例

### 下周计划
- [ ] 实现 AI 调用重试
- [ ] 补充文档和示例
- [ ] 开始 Phase 2 开发
```

---

## 7. 附录

### 7.1 参考文档

**提案文档**:
- [01-architecture-optimization-proposal.md](../proposals/01-architecture-optimization-proposal.md)
- [02-claude-code-integration-strategy.md](../proposals/02-claude-code-integration-strategy.md)
- [03-multi-language-support.md](../proposals/03-multi-language-support.md)

**外部资源**:
- [ts-morph Documentation](https://ts-morph.com/)
- [Anthropic API Reference](https://docs.anthropic.com/en/api)
- [PlantUML Guide](https://plantuml.com/class-diagram)
- [Vitest Documentation](https://vitest.dev/)

### 7.2 模板文件

**测试模板**:
```typescript
// __tests__/template.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('ModuleName', () => {
  beforeEach(() => {
    // Setup
  });

  afterEach(() => {
    // Cleanup
  });

  describe('functionName', () => {
    it('should handle normal case', () => {
      // Arrange
      const input = ...;

      // Act
      const result = functionName(input);

      // Assert
      expect(result).toBe(expected);
    });

    it('should handle edge case', () => {
      // Test edge case
    });

    it('should throw on invalid input', () => {
      expect(() => functionName(null)).toThrow();
    });
  });
});
```

### 7.3 快速开始

```bash
# 1. 克隆项目
git clone https://github.com/your-org/archguard.git
cd archguard

# 2. 安装依赖
npm install

# 3. 运行测试
npm test

# 4. 启动开发
npm run dev

# 5. 生成自己的架构图
npm run generate
```

---

## 8. 时间表总览

```
Week 1
├─ Day 1: Phase 0 - 环境准备
├─ Day 2-4: Phase 1 Part 1 - 基础解析
└─ Day 5: Phase 1 Part 2 - 高级特性

Week 2
├─ Day 1-3: Phase 2 - Claude Code CLI 集成
├─ Day 4-5: Phase 3 Part 1 - CLI 开发

Week 3
├─ Day 1-2: Phase 3 Part 2 - 优化
├─ Day 3: 集成测试与修复
├─ Day 4: 文档完善
└─ Day 5: 发布准备
```

---

**版本历史**

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|----------|------|
| 1.0 | 2026-01-25 | 初始版本 | Claude Code |

---

**审批签名**

- [ ] 项目负责人: _________________ 日期: _______
- [ ] 技术负责人: _________________ 日期: _______
