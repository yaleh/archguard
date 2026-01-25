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

### **1.3 CLI 集成层 (CLI Integration)**

* **Claude Code CLI Wrapper**: 封装 Claude Code 命令行调用，传递 Arch-JSON 并接收 PlantUML 输出。
* **Prompt Builder**: 构建传递给 Claude Code 的提示词，包含架构指纹和生成指令。
* **Output Parser**: 解析 Claude Code CLI 的输出，提取 PlantUML 代码块。
* **Puml Renderer**: (可选) 调用本地或远程 PlantUML 渲染器生成图像。

## **2\. 核心工作流**

1. **事件触发**：用户在 Claude Code 中输入 "Implement user auth"。  
2. **任务完成**：Claude Code 修改了 5 个文件。  
3. **钩子激活**：archguard 被触发，获取修改后的文件列表。  
4. **静态解析**：  
   * TS-Scanner 提取这些文件的 class definition, public methods, injected dependencies。  
   * 生成摘要：{ "class": "AuthService", "dependsOn": \["UserRepository"\], "methods": \["login", "signup"\] }。  
5. **Claude Code CLI 调用**：
   * 输入：Arch-JSON + 历史 .puml + 生成指令。
   * 命令：`claude-code --prompt "基于以下架构指纹生成 PlantUML 类图" --input arch.json`
   * 输出：PlantUML 代码块。
6. **更新同步**：
   * 解析 Claude Code 输出，提取 PlantUML 代码。
   * 写入 docs/auth-flow.puml。
   * 更新 README.md 中的架构版本号。

## **3\. 技术栈选择**

* **Runtime**: Node.js (TypeScript)
* **Static Analysis**: ts-morph (封装了 TypeScript Compiler API，更易用)
* **CLI Integration**: Claude Code CLI (通过 child_process 调用)
* **CLI Framework**: commander.js
* **Hooks Library**: husky (用于本地 Git 钩子管理)
* **Process Management**: Node.js child_process / execa (执行 Claude Code 命令)

## **4\. Claude Code CLI 调用策略**

**通过 Claude Code CLI 生成 PlantUML**

ArchGuard 通过构建提示词并传递给 Claude Code CLI 来生成 PlantUML。

**提示词模板示例：**

```
你是一个资深软件架构师。以下是从 TypeScript 项目中提取的架构指纹（JSON 格式）：

<arch-json>
{架构指纹内容}
</arch-json>

请基于以上信息生成符合 PlantUML 语法的类图，要求：
1. 分析模块间的依赖关系
2. 生成规范的 PlantUML 代码（使用 @startuml 和 @enduml 标记）
3. 只输出 PlantUML 代码块，不要解释
4. 使用现代化皮肤参数
```

**CLI 调用方式：**
```bash
# 方式 1: 通过标准输入传递
echo "prompt + arch-json" | claude-code --format=code

# 方式 2: 通过文件传递
claude-code --input=prompt.txt --output=diagram.puml
```

## **5\. 数据结构定义 (Arch-JSON)**

{  
  "version": "1.0",  
  "entities": \[  
    {  
      "name": "OrderService",  
      "type": "class",  
      "decorators": \["@Injectable"\],  
      "methods": \["createOrder", "cancelOrder"\],  
      "dependencies": \["PaymentProvider", "OrderRepo"\]  
    }  
  \],  
  "relations": \[  
    { "from": "OrderController", "to": "OrderService", "type": "composition" }  
  \]  
}

## **6\. 后续扩展**

* **架构测试 (Architecture-as-Code)**：允许用户定义约束（如“Controller 不准直接调用 Repo”），由 AI 在生成文档时进行合规性检查。  
* **多语言支持**：通过集成 Tree-sitter 扩展到 Java, Go, Python。