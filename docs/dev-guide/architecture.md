# **ArchGuard: 系统架构设计文档**

## **1\. 系统组件概览**

ArchGuard 由三个主要层级组成，形成一个完整的自动化流水线：

### **1.1 触发层 (Trigger Layer)**

* **Hook Listener**: 监听本地环境事件。  
* **Config Loader**: 读取 archguard.config.json，确定扫描范围、排除目录及 AI 配置。

### **1.2 引擎层 (Core Engine)**

* **TS-Scanner**: 基于 ts-morph 构建。负责扫描 TS 文件并构建 AST。  
* **Snippet Extractor**: 核心过滤逻辑。将 AST 转换为“架构摘要 JSON”（Arch-JSON）。  
* **Relationship Resolver**: 分析 import/export，建立跨文件的依赖链接。

### **1.3 集成层 (Integration Layer)**

* **LLM Grouping Service**: 可选的 LLM 驱动的智能分组服务，优化实体组织。
* **Mermaid Generator**: 本地生成 Mermaid 语法，不依赖外部服务。
* **Validation Pipeline**: 五层验证确保生成的图表质量（语法、结构、渲染、质量、自动修复）。
* **Isomorphic Mermaid Renderer**: 使用 isomorphic-mermaid 进行本地渲染，生成 SVG 和 PNG。

## **2\. 核心工作流**

1. **事件触发**：用户运行 `archguard analyze -s ./src`。
2. **静态解析**：
   * TS-Scanner 扫描所有 TS 文件并构建 AST。
   * 提取这些文件的 class definition, public methods, injected dependencies。
   * 生成摘要：{ "class": "AuthService", "dependsOn": \["UserRepository"\], "methods": \["login", "signup"\] }。
3. **可选分组**：
   * 使用 LLM 进行智能实体分组（可选，默认启用）。
   * 或使用启发式算法进行快速分组（`--no-llm-grouping`）。
4. **Mermaid 生成**：
   * Arch-JSON → Mermaid 语法生成器。
   * 输出：Mermaid 代码块。
5. **五层验证**：
   * Parse Validation: 语法检查
   * Structural Validation: 实体引用、关系对称性
   * Render Validation: 可渲染性测试
   * Quality Analysis: 可读性、完整性、复杂度评分
   * Auto-Repair: 自动语法修复
6. **本地渲染**：
   * 使用 isomorphic-mermaid 渲染为 SVG。
   * 使用 sharp 转换为 PNG。
7. **输出**：
   * 写入 `archguard/architecture.mmd`（Mermaid 源代码）。
   * 写入 `archguard/architecture.svg`（矢量图）。
   * 写入 `archguard/architecture.png`（位图）。

## **3\. 技术栈选择**

* **Runtime**: Node.js (TypeScript)
* **Static Analysis**: ts-morph (封装了 TypeScript Compiler API，更易用)
* **Diagram Generation**: 本地 Mermaid 生成器（无需外部服务）
* **Rendering**: isomorphic-mermaid (SVG渲染) + sharp (PNG转换)
* **LLM Integration**: @anthropic-ai/sdk (可选，用于智能分组)
* **CLI Framework**: commander.js
* **Process Management**: Node.js child_process / execa (执行 Claude CLI 命令)

## **4\. LLM 智能分组（可选）**

ArchGuard v2.0 提供可选的 LLM 驱动智能分组功能，用于优化实体组织。

**启用 LLM 分组**（默认）：
```bash
archguard analyze -s ./src
# 消耗约 2000 tokens，生成更好的分组结构
```

**禁用 LLM 分组**（使用启发式算法）：
```bash
archguard analyze -s ./src --no-llm-grouping
# 免费，速度更快
```

**LLM 分组优势**：
- 语义理解：基于代码语义而非文件路径分组
- 更好的可读性：减少跨模块关系的复杂度
- 智能命名：自动生成有意义的分组名称

## **5\. 五层验证策略**

ArchGuard v2.0 实现了全面的五层验证管道：

1. **Parse Validation (语法验证)**
   * 使用 mermaid.parse() 检查语法正确性
   * 捕获并修复常见语法错误

2. **Structural Validation (结构验证)**
   * 验证所有实体引用都存在
   * 检查关系对称性
   * 验证命名空间一致性

3. **Render Validation (渲染验证)**
   * 实际尝试渲染图表
   * 检测渲染时的错误
   * 验证输出有效性

4. **Quality Analysis (质量分析)**
   * Readability Score: 可读性评分 (0-100)
   * Completeness Score: 完整性评分 (0-100)
   * Consistency Score: 一致性评分 (0-100)
   * Complexity Score: 复杂度评分 (0-100, 越低越好)

5. **Auto-Repair (自动修复)**
   * 自动修复常见语法错误
   * 修复泛型语法（`<T>` → `~T~`）
   * 修复特殊字符转义

## **6\. 数据结构定义 (Arch-JSON)**

```json
{
  "version": "1.0",
  "entities": [
    {
      "name": "OrderService",
      "type": "class",
      "decorators": ["@Injectable"],
      "methods": ["createOrder", "cancelOrder"],
      "dependencies": ["PaymentProvider", "OrderRepo"]
    }
  ],
  "relations": [
    { "from": "OrderController", "to": "OrderService", "type": "composition" }
  ]
}
```

## **7\. 后续扩展**

* **架构测试 (Architecture-as-Code)**：允许用户定义约束（如"Controller 不准直接调用 Repo"），由 LLM 在生成文档时进行合规性检查。
* **多语言支持**：通过集成 Tree-sitter 扩展到 Java, Go, Python。
* **自定义主题**：支持用户自定义 Mermaid 主题配置。