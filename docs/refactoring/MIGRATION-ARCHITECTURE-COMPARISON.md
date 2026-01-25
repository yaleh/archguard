# 架构对比：API SDK vs Claude Code CLI

## 当前架构 (使用 @anthropic-ai/sdk)

```
┌──────────────────────────────────────────────────────────────┐
│                      用户执行命令                              │
│              archguard analyze -s ./src                      │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                   CLI 命令层                                  │
│                (src/cli/commands/analyze.ts)                 │
│                                                              │
│   ❌ 需要: process.env.ANTHROPIC_API_KEY                     │
└────────────────────────┬─────────────────────────────────────┘
                         │
            ┌────────────┴───────────┐
            │                        │
            ▼                        ▼
┌─────────────────────┐   ┌──────────────────────┐
│   TypeScript Parser │   │  PlantUML Generator  │
│    (ts-morph)       │   │                      │
│                     │   │ ❌ 需要 API Key      │
│  ✅ 保持不变        │   │ 🔄 需要重构          │
└──────────┬──────────┘   └──────────┬───────────┘
           │                         │
           ▼                         │
┌─────────────────────┐             │
│     Arch-JSON       │◄────────────┘
│  (架构指纹数据)      │
└──────────┬──────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────┐
│              AI 集成层 (src/ai/)                              │
│                                                              │
│  ┌──────────────────┐    ┌─────────────────┐               │
│  │ ClaudeConnector  │    │  PromptBuilder  │               │
│  │                  │    │                 │               │
│  │ ❌ 使用 SDK      │    │ 🔄 硬编码提示词  │               │
│  │ ❌ 需要 API Key  │    │                 │               │
│  └────────┬─────────┘    └────────┬────────┘               │
│           │                       │                         │
│           ▼                       ▼                         │
│  ┌────────────────────────────────────────┐                │
│  │   @anthropic-ai/sdk (12.8 MB)         │                │
│  │                                        │                │
│  │   client.messages.create({            │                │
│  │     model: "claude-3-5-sonnet...",    │                │
│  │     messages: [{ role, content }]     │                │
│  │   })                                   │                │
│  │                                        │                │
│  │   ❌ HTTP 直接调用 API                 │                │
│  └────────────────┬───────────────────────┘                │
│                   │                                         │
│                   ▼                                         │
│  ┌──────────────────┐   ┌────────────────┐                │
│  │   CostTracker    │   │ PlantUMLValidator│              │
│  │                  │   │                  │              │
│  │ ❌ 追踪成本      │   │ ✅ 保持不变      │              │
│  └──────────────────┘   └────────────────┘                │
└──────────────────────────────────────────────────────────────┘
           │
           ▼
   ┌──────────────────┐
   │  Anthropic API   │
   │  (云服务)        │
   └──────────────────┘
           │
           ▼
      返回 PlantUML
```

---

## 目标架构 (使用 Claude Code CLI)

```
┌──────────────────────────────────────────────────────────────┐
│                      用户执行命令                              │
│              archguard analyze -s ./src                      │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                   CLI 命令层                                  │
│                (src/cli/commands/analyze.ts)                 │
│                                                              │
│   ✅ 无需 API Key                                            │
│   ✅ 检测 Claude Code CLI 可用性                             │
└────────────────────────┬─────────────────────────────────────┘
                         │
            ┌────────────┴───────────┐
            │                        │
            ▼                        ▼
┌─────────────────────┐   ┌──────────────────────┐
│   TypeScript Parser │   │  PlantUML Generator  │
│    (ts-morph)       │   │                      │
│                     │   │ ✅ 无需 API Key      │
│  ✅ 保持不变        │   │ ✅ 使用 Wrapper      │
└──────────┬──────────┘   └──────────┬───────────┘
           │                         │
           ▼                         │
┌─────────────────────┐             │
│     Arch-JSON       │◄────────────┘
│  (架构指纹数据)      │
└──────────┬──────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────┐
│              AI 集成层 (src/ai/) - 重构后                      │
│                                                              │
│  ┌──────────────────────┐    ┌─────────────────────┐       │
│  │ ClaudeCodeWrapper    │    │ PromptTemplateManager│      │
│  │ (新增)               │    │ (新增)               │      │
│  │                      │    │                      │      │
│  │ ✅ CLI 子进程封装    │    │ ✅ 模板文件系统      │      │
│  │ ✅ 临时文件管理      │    │                      │      │
│  │ ✅ 输出解析          │    │ prompts/             │      │
│  └────────┬─────────────┘    │ ├─ class-diagram.txt │      │
│           │                  │ └─ ...               │      │
│           │                  └──────────┬───────────┘       │
│           │                             │                   │
│           ▼                             ▼                   │
│  ┌────────────────────────────────────────────┐            │
│  │        execa (轻量级, ~500KB)              │            │
│  │                                            │            │
│  │   await execa('claude-code', [            │            │
│  │     '--prompt-file', promptFile,          │            │
│  │     '--output', outputFile,               │            │
│  │     '--format', 'code',                   │            │
│  │     '--no-interactive'                    │            │
│  │   ])                                       │            │
│  │                                            │            │
│  │   ✅ 子进程调用 CLI                        │            │
│  └────────────────┬───────────────────────────┘            │
│                   │                                         │
│                   ▼                                         │
│  ┌──────────────────┐   ┌────────────────┐                │
│  │   OutputParser   │   │ PlantUMLValidator│              │
│  │   (新增)         │   │                  │              │
│  │                  │   │ ✅ 保持不变      │              │
│  │ ✅ 解析 CLI 输出 │   │                  │              │
│  └──────────────────┘   └────────────────┘                │
└──────────────────────────────────────────────────────────────┘
           │
           ▼
   ┌──────────────────┐
   │ Claude Code CLI  │
   │  (本地工具)      │
   │                  │
   │ ✅ 使用已配置认证 │
   │ ✅ 理解项目上下文 │
   └──────────────────┘
           │
           ▼
      返回 PlantUML
```

---

## 核心差异对比

### 1. 依赖管理

| 方面 | 当前 (API SDK) | 目标 (CLI) |
|------|---------------|-----------|
| **npm 依赖** | `@anthropic-ai/sdk` (12.8 MB) | `execa` (~500 KB) |
| **外部工具** | 无 | Claude Code CLI (需预装) |
| **安装复杂度** | 简单 (`npm install`) | 中等 (需安装 CLI) |
| **更新维护** | 需追踪 SDK 版本 | Claude Code 自动更新 |

### 2. 认证机制

| 方面 | 当前 (API SDK) | 目标 (CLI) |
|------|---------------|-----------|
| **配置方式** | `ANTHROPIC_API_KEY` 环境变量 | Claude Code 配置 |
| **用户操作** | 需要获取和配置 API Key | 无需操作 (已有 Claude Code) |
| **安全性** | 需妥善保管 API Key | CLI 自动管理 |
| **多项目支持** | 每个项目需配置 | 全局配置，所有项目共享 |

### 3. 调用流程

**当前 (API SDK):**
```typescript
// 1. 创建客户端 (需要 API Key)
const client = new Anthropic({ apiKey });

// 2. 构建请求
const response = await client.messages.create({
  model: 'claude-3-5-sonnet-20241022',
  messages: [{ role: 'user', content: prompt }],
  max_tokens: 4096
});

// 3. 提取结果
const text = response.content[0].text;

// 4. 解析 PlantUML
const puml = extractPlantUML(text);
```

**目标 (CLI):**
```typescript
// 1. 准备提示词和临时文件
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-'));
const promptFile = path.join(tempDir, 'prompt.txt');
const outputFile = path.join(tempDir, 'output.puml');

await fs.writeFile(promptFile, prompt);

// 2. 调用 CLI (无需 API Key)
const result = await execa('claude-code', [
  '--prompt-file', promptFile,
  '--output', outputFile,
  '--format', 'code',
  '--no-interactive'
]);

// 3. 读取结果
const puml = await fs.readFile(outputFile, 'utf-8');

// 4. 清理临时文件
await fs.remove(tempDir);
```

### 4. 错误处理

| 错误类型 | 当前 (API SDK) | 目标 (CLI) |
|---------|---------------|-----------|
| **认证失败** | `APIError(401)` | CLI 配置问题提示 |
| **速率限制** | `APIError(429)` + 重试 | CLI 内部处理 |
| **超时** | SDK 超时配置 | `execa` timeout 选项 |
| **网络错误** | SDK 抛出网络异常 | CLI 进程错误 |
| **输出解析** | 提取 JSON 响应 | 解析 CLI 文本输出 |

### 5. 成本与监控

| 方面 | 当前 (API SDK) | 目标 (CLI) |
|------|---------------|-----------|
| **成本追踪** | ✅ `CostTracker` 类 | ❌ CLI 无 token 信息 |
| **Token 统计** | ✅ 输入/输出 token 数 | ❌ 不可见 |
| **计费方式** | 按 token 付费 ($3/$15 per M) | 包含在 Claude Code 订阅 |
| **成本可见性** | 精确到 $0.0001 | 订阅制，不需追踪 |

---

## 文件变更清单

### 新增文件 ✨

```
src/ai/
├── claude-code-wrapper.ts      # CLI 封装核心
├── output-parser.ts            # 输出解析器
└── prompt-template-manager.ts  # 模板管理器

prompts/
├── class-diagram.txt           # 类图模板
└── README.md                   # 模板文档

tests/unit/ai/
├── claude-code-wrapper.test.ts
├── output-parser.test.ts
└── prompt-template-manager.test.ts
```

### 修改文件 🔄

```
src/ai/
├── plantuml-generator.ts       # 使用 ClaudeCodeWrapper
└── prompt-builder.ts           # 重构为模板系统

src/cli/commands/
└── analyze.ts                  # 移除 API Key，添加 CLI 检测

package.json                    # 依赖更新
```

### 删除/废弃文件 ❌

```
src/ai/
├── claude-connector.ts         # → deprecated
└── cost-tracker.ts             # → deleted

tests/unit/ai/
├── claude-connector.test.ts    # → deleted
└── cost-tracker.test.ts        # → deleted
```

---

## 测试策略对比

### 当前测试

```typescript
// 需要真实 API Key 的集成测试
describe('PlantUML Generation', () => {
  beforeAll(() => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY required');
    }
  });

  it('should generate PlantUML', async () => {
    const generator = new PlantUMLGenerator({
      apiKey: process.env.ANTHROPIC_API_KEY!
    });

    const puml = await generator.generate(archJson);
    expect(puml).toContain('@startuml');
  });
});
```

### 目标测试

```typescript
// Mock CLI 调用，无需真实 API Key
describe('PlantUML Generation', () => {
  beforeAll(() => {
    // Mock execa
    vi.mock('execa', () => ({
      execa: vi.fn().mockResolvedValue({
        stdout: '@startuml\nclass User\n@enduml'
      })
    }));
  });

  it('should generate PlantUML', async () => {
    const generator = new PlantUMLGenerator(); // 无需 API Key!

    const puml = await generator.generate(archJson);
    expect(puml).toContain('@startuml');
  });
});

// 可选: 跳过需要 CLI 的集成测试
describe('Integration Tests', skipIfNoClaudeCode(), () => {
  it('should work with real CLI', async () => {
    // 仅在 CLI 可用时运行
  });
});
```

---

## 性能影响分析

### 理论分析

| 操作 | 当前 (API SDK) | 目标 (CLI) | 差异 |
|------|---------------|-----------|------|
| **初始化** | SDK 客户端实例化 (~1ms) | 无初始化成本 (0ms) | ✅ 更快 |
| **请求准备** | 构建 JSON payload (~5ms) | 写入临时文件 (~10ms) | ⚠️ 稍慢 |
| **网络调用** | HTTP 请求 (~2-5s) | CLI 进程 + HTTP (~2-5s) | ≈ 相当 |
| **响应解析** | JSON 解析 (~2ms) | 文件读取 + 文本解析 (~5ms) | ⚠️ 稍慢 |
| **清理** | 无需清理 (0ms) | 删除临时文件 (~5ms) | ⚠️ 稍慢 |
| **总开销** | ~7ms | ~20ms | +13ms |

### 实际预期

- **网络耗时** (~2-5s) 占主导，开销增加 (13ms) 可忽略
- **缓存命中** 时，两者性能相当
- **大规模生成** 时，CLI 进程启动开销可被优化

### 优化策略

1. **复用临时目录**: 避免频繁创建/删除
2. **批处理**: 多个请求合并到一次 CLI 调用
3. **缓存策略**: Arch-JSON hash 缓存 (已有)

---

## 用户体验对比

### 安装配置体验

**当前 (API SDK):**
```bash
# 1. 安装 ArchGuard
npm install -g archguard

# 2. 获取 API Key (需要注册 Anthropic)
# 3. 配置环境变量
export ANTHROPIC_API_KEY=sk-ant-...

# 4. 使用
archguard analyze -s ./src
```

**目标 (CLI):**
```bash
# 1. 安装 Claude Code (一次性)
# (假设用户已安装)

# 2. 安装 ArchGuard
npm install -g archguard

# 3. 直接使用 (无需额外配置!)
archguard analyze -s ./src
```

### 错误处理体验

**当前 (API SDK):**
```
❌ Error: API key is required for PlantUMLGenerator
Please set ANTHROPIC_API_KEY environment variable

export ANTHROPIC_API_KEY=your-key-here
```

**目标 (CLI):**
```
❌ Error: Claude Code CLI not found

Please install Claude Code:
  https://docs.anthropic.com/claude-code

To verify installation:
  claude-code --version

If installed, ensure it's in your PATH.
```

---

## 总结

### 关键优势 ✅

1. **用户友好**: 无需管理 API Key
2. **依赖更轻**: execa (500KB) vs @anthropic-ai/sdk (12.8MB)
3. **上下文共享**: Claude Code 理解项目
4. **成本透明**: 包含在订阅中
5. **维护简化**: CLI 自动更新

### 主要权衡 ⚠️

1. **外部依赖**: 需要预装 Claude Code CLI
2. **成本可见性**: 无法精确追踪单次调用成本
3. **测试复杂度**: 需要 Mock CLI 调用
4. **进程开销**: 额外 ~13ms (可忽略)

### 迁移建议 ✅

**推荐迁移**，因为:
- 用户体验提升显著 (零配置)
- 技术债务减少 (轻量级依赖)
- 长期维护成本降低
- 性能影响可忽略

---

**文档版本**: 1.0
**创建日期**: 2026-01-25
