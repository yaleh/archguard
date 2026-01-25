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

### **1.3 智脑层 (AI Intelligence)**

* **Prompt Architect**: 将 Arch-JSON 注入到预设的 System Prompt 中。  
* **AI Connector**: 封装了 Claude/Gemini 的 API 调用及重试逻辑。  
* **Puml Renderer**: (可选) 调用本地或远程 PlantUML 渲染器生成图像。

## **2\. 核心工作流**

1. **事件触发**：用户在 Claude Code 中输入 "Implement user auth"。  
2. **任务完成**：Claude Code 修改了 5 个文件。  
3. **钩子激活**：archguard 被触发，获取修改后的文件列表。  
4. **静态解析**：  
   * TS-Scanner 提取这些文件的 class definition, public methods, injected dependencies。  
   * 生成摘要：{ "class": "AuthService", "dependsOn": \["UserRepository"\], "methods": \["login", "signup"\] }。  
5. **AI 推理**：  
   * 输入：当前摘要 \+ 历史 .puml。  
   * 提示词：*"根据新摘要更新此 PlantUML 类图，保持原有风格。"*  
6. **更新同步**：  
   * 写入 docs/auth-flow.puml。  
   * 更新 README.md 中的架构版本号。

## **3\. 技术栈选择**

* **Runtime**: Node.js (TypeScript)  
* **Static Analysis**: ts-morph (封装了 TypeScript Compiler API，更易用)。  
* **AI SDK**: @anthropic-ai/sdk, @google/generative-ai。  
* **CLI Framework**: commander.js。  
* **Hooks Library**: husky (用于本地 Git 钩子管理)。

## **4\. 提示词策略 (Prompt Engineering)**

**System Prompt 示例：**

你是一个资深软件架构师。我会为你提供一组由 TypeScript 解析器提取的项目代码指纹（JSON 格式）。

你的任务是：

1. 分析模块间的依赖关系。  
2. 生成符合 PlantUML 语法的类图或组件图。  
3. 只输出 PlantUML 代码块，不要解释。  
4. 确保使用皮肤参数让图表看起来现代且专业。

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