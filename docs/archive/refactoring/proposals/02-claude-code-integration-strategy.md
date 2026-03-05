# ArchGuard Claude Code CLI 集成策略

**文档版本**: 2.0
**创建日期**: 2026-01-25
**更新日期**: 2026-01-25
**关联文档**: 01-architecture-optimization-proposal.md
**分析方法**: RLM (Refactoring Lifecycle Management)
**重大变更**: 从直接 AI API 调用改为 Claude Code CLI 集成

---

## 执行摘要

本文档阐述 ArchGuard 通过 **Claude Code 命令行工具** 生成 PlantUML 架构图的集成策略。采用此方案的核心优势是：
1. 无需管理 API Key
2. 利用 Claude Code 的现有配置和上下文能力
3. 与开发者工作流无缝集成
4. 降低集成复杂度

---

## 1. 架构变更说明

### 1.1 从 AI API 到 CLI 集成

**旧架构**（已废弃）:
```
TypeScript Parser → Arch-JSON → AI SDK (API 调用) → PlantUML
```

**新架构**（当前）:
```
TypeScript Parser → Arch-JSON → Claude Code CLI → PlantUML
```

### 1.2 核心变更点

| 方面 | 旧方案 (AI API) | 新方案 (Claude Code CLI) |
|------|----------------|-------------------------|
| **依赖** | @anthropic-ai/sdk | Claude Code CLI |
| **认证** | 需要 ANTHROPIC_API_KEY | 使用 Claude Code 配置 |
| **调用方式** | HTTP API | 子进程调用 |
| **上下文管理** | 手动构建 | Claude Code 自动管理 |
| **成本** | 按 token 计费 | 包含在 Claude Code 订阅中 |
| **配置复杂度** | 高（需管理 API key、模型选择等） | 低（复用 Claude Code 配置） |

---

## 2. Claude Code CLI 集成设计

### 2.1 CLI 调用封装

**核心组件**: `ClaudeCodeWrapper`

```typescript
import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'path';

export interface ClaudeCodeOptions {
  timeout?: number;        // 超时时间（毫秒）
  maxRetries?: number;     // 最大重试次数
  workingDir?: string;     // 工作目录
}

export class ClaudeCodeWrapper {
  constructor(private options: ClaudeCodeOptions = {}) {
    this.options.timeout = options.timeout ?? 30000; // 30s 默认超时
    this.options.maxRetries = options.maxRetries ?? 2;
  }

  /**
   * 调用 Claude Code CLI 生成 PlantUML
   * @param archJson 架构指纹 JSON
   * @param previousPuml 上一版本的 PlantUML（可选）
   * @returns 生成的 PlantUML 代码
   */
  async generatePlantUML(
    archJson: object,
    previousPuml?: string
  ): Promise<string> {
    // 构建提示词
    const prompt = this.buildPrompt(archJson, previousPuml);

    // 保存到临时文件
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-'));
    const promptFile = path.join(tempDir, 'prompt.txt');
    const outputFile = path.join(tempDir, 'output.puml');

    try {
      await fs.writeFile(promptFile, prompt);

      // 调用 Claude Code CLI
      const result = await execa('claude-code', [
        '--prompt-file', promptFile,
        '--output', outputFile,
        '--format', 'code',
        '--no-interactive'
      ], {
        timeout: this.options.timeout,
        cwd: this.options.workingDir
      });

      // 读取输出
      const plantUML = await fs.readFile(outputFile, 'utf-8');

      // 验证输出
      this.validatePlantUML(plantUML);

      return plantUML;

    } finally {
      // 清理临时文件
      await fs.remove(tempDir);
    }
  }

  /**
   * 构建传递给 Claude Code 的提示词
   */
  private buildPrompt(archJson: object, previousPuml?: string): string {
    const template = `你是一个资深软件架构师。以下是从 TypeScript 项目中提取的架构指纹：

<architecture-fingerprint>
${JSON.stringify(archJson, null, 2)}
</architecture-fingerprint>

${previousPuml ? `
<previous-diagram>
${previousPuml}
</previous-diagram>

请基于新的架构指纹**更新**上述 PlantUML 图，保持风格一致。
` : '请基于架构指纹生成 PlantUML 类图。'}

要求：
1. 生成符合 PlantUML 语法的类图
2. 使用 @startuml 和 @enduml 标记
3. 使用现代化皮肤参数（skinparam）
4. 包含所有类、接口及其关系
5. 只输出 PlantUML 代码，不要解释

输出格式示例：
\`\`\`plantuml
@startuml
' 现代化皮肤
skinparam classAttributeIconSize 0
skinparam classFontSize 12

class UserService {
  +login()
  +register()
}
@enduml
\`\`\``;

    return template;
  }

  /**
   * 验证生成的 PlantUML 代码
   */
  private validatePlantUML(plantUML: string): void {
    if (!plantUML.includes('@startuml') || !plantUML.includes('@enduml')) {
      throw new Error('Invalid PlantUML: missing @startuml or @enduml markers');
    }

    // 可以添加更多验证逻辑
    // 例如：检查是否包含必要的实体
  }
}
```

### 2.2 提示词工程策略

**模板管理**

提示词模板存储在 `prompts/` 目录:

```
prompts/
├── class-diagram.txt          # 类图生成模板
├── component-diagram.txt      # 组件图生成模板
└── sequence-diagram.txt       # 序列图生成模板
```

**示例：class-diagram.txt**

```
你是一个资深软件架构师，专注于生成清晰、准确的 PlantUML 架构图。

## 输入

架构指纹（JSON 格式）：
{{ARCH_JSON}}

{{#if PREVIOUS_PUML}}
上一版本的 PlantUML 图：
{{PREVIOUS_PUML}}

请基于新的架构指纹**增量更新**上述图表，保持风格一致。
{{else}}
请基于架构指纹生成全新的 PlantUML 类图。
{{/if}}

## 要求

1. **语法正确性**：必须包含 @startuml 和 @enduml
2. **完整性**：包含架构指纹中的所有实体
3. **关系准确**：正确表示继承、组合、依赖关系
4. **现代化**：使用 skinparam 提升视觉效果
5. **简洁性**：只输出代码，不要解释

## 输出格式

\`\`\`plantuml
@startuml Architecture
!theme cerulean-outline

skinparam classAttributeIconSize 0
skinparam classFontSize 12

[您的 PlantUML 代码]

@enduml
\`\`\`
```

### 2.3 错误处理与重试

```typescript
export class ClaudeCodeWrapper {
  async generatePlantUMLWithRetry(
    archJson: object,
    previousPuml?: string
  ): Promise<string> {
    let lastError: Error;

    for (let i = 0; i < (this.options.maxRetries ?? 2); i++) {
      try {
        return await this.generatePlantUML(archJson, previousPuml);
      } catch (error) {
        lastError = error as Error;
        console.warn(`Attempt ${i + 1} failed:`, error.message);

        // 如果是超时错误，增加超时时间重试
        if (error.message.includes('timeout')) {
          this.options.timeout! *= 1.5;
        }

        // 等待后重试
        await this.delay(1000 * (i + 1));
      }
    }

    throw new Error(`Failed after ${this.options.maxRetries} retries: ${lastError.message}`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

---

## 3. 集成优势

### 3.1 开发者体验优势

✅ **零配置负担**
- 无需单独配置 API Key
- 复用 Claude Code 的认证和配置

✅ **工作流一致性**
- 与开发者日常使用的 Claude Code 保持一致
- 减少认知负担

✅ **上下文共享**
- Claude Code 了解项目上下文
- 生成的 PlantUML 更贴合项目风格

### 3.2 技术优势

✅ **简化架构**
- 移除 AI SDK 依赖
- 减少代码复杂度
- 降低维护成本

✅ **成本优化**
- 无需单独支付 API 费用
- 包含在 Claude Code 订阅中

✅ **可靠性**
- Claude Code CLI 更稳定
- 有成熟的错误处理机制

---

## 4. 实施计划

### 4.1 Phase 1: 基础集成 (Week 1-2)

**任务清单**:
- [ ] 实现 `ClaudeCodeWrapper` 类
- [ ] 设计提示词模板系统
- [ ] 实现 PlantUML 输出解析
- [ ] 添加基础错误处理
- [ ] 编写单元测试（Mock CLI 调用）

**验收标准**:
- ✅ 能够成功调用 Claude Code CLI
- ✅ 正确解析 PlantUML 输出
- ✅ 测试覆盖率 ≥ 80%

### 4.2 Phase 2: 提示词优化 (Week 3)

**任务清单**:
- [ ] 创建提示词模板库
- [ ] 实现模板变量替换
- [ ] 支持增量更新（传递历史 PlantUML）
- [ ] A/B 测试不同提示词效果

**验收标准**:
- ✅ 提示词模板化且易于修改
- ✅ 增量更新能保持风格一致

### 4.3 Phase 3: 质量保证 (Week 4)

**任务清单**:
- [ ] 实现 PlantUML 语法验证
- [ ] 实现完整性检查（确保所有实体都包含）
- [ ] 添加重试机制
- [ ] 实现超时处理

**验收标准**:
- ✅ 生成的 PlantUML 语法正确率 > 95%
- ✅ 超时和错误能够优雅处理

---

## 5. 风险与缓解

### 5.1 依赖 Claude Code CLI

**风险**: Claude Code CLI 接口变更可能导致集成失败

**缓解措施**:
- 封装 CLI 调用逻辑，集中管理
- 版本锁定 Claude Code
- 添加集成测试，及时发现兼容性问题
- 保留降级方案（记录原始 Arch-JSON）

### 5.2 输出质量不稳定

**风险**: Claude Code 输出格式可能不一致

**缓解措施**:
- 严格的输出验证
- 多次重试机制
- 提示词明确要求输出格式
- 提取代码块的鲁棒解析器

### 5.3 性能考虑

**风险**: CLI 调用开销较大

**缓解措施**:
- 实现智能缓存（基于 Arch-JSON hash）
- 增量更新而非全量重新生成
- 异步处理，不阻塞主流程

---

## 6. 监控与度量

### 6.1 关键指标

| 指标 | 目标 | 测量方法 |
|------|------|---------|
| CLI 调用成功率 | > 95% | 成功次数 / 总调用次数 |
| 平均响应时间 | < 10s | 记录每次调用时长 |
| PlantUML 语法正确率 | > 95% | 验证通过次数 / 总生成次数 |
| 缓存命中率 | > 70% | 缓存命中 / 总请求 |

### 6.2 日志记录

```typescript
class ClaudeCodeWrapper {
  private logger: Logger;

  async generatePlantUML(...): Promise<string> {
    const startTime = Date.now();

    try {
      this.logger.info('Calling Claude Code CLI', {
        archJsonSize: JSON.stringify(archJson).length,
        hasPreviousPuml: !!previousPuml
      });

      const result = await this.callCLI(...);

      this.logger.info('Claude Code CLI success', {
        duration: Date.now() - startTime,
        outputSize: result.length
      });

      return result;

    } catch (error) {
      this.logger.error('Claude Code CLI failed', {
        duration: Date.now() - startTime,
        error: error.message
      });
      throw error;
    }
  }
}
```

---

## 7. 后续优化方向

### 7.1 智能缓存策略

基于 Arch-JSON 的内容哈希：
- 如果架构指纹未变化，直接返回缓存的 PlantUML
- 如果只有小改动，传递历史 PlantUML 做增量更新

### 7.2 批处理优化

如果一次提交涉及多个模块：
- 并行调用 Claude Code CLI
- 最后合并多个 PlantUML 图

### 7.3 多格式支持

除了 PlantUML，还可以生成：
- Mermaid 图表
- GraphViz DOT 格式
- SVG/PNG 图片（调用渲染器）

---

## 8. 总结

通过集成 Claude Code CLI，ArchGuard 实现了：
1. **简化架构**：移除了复杂的 AI SDK 依赖
2. **降低成本**：无需单独的 API 费用
3. **提升体验**：与开发者工作流无缝集成
4. **增强可靠性**：利用 Claude Code 成熟的基础设施

这一架构调整使 ArchGuard 更易于部署、维护和扩展。

---

**文档版本**: 2.0
**更新日期**: 2026-01-25
**状态**: ✅ 已完成
