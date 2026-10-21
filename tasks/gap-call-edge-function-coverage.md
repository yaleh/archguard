---
id: gap-call-edge-function-coverage
title: CallEdgeExtractor 只扫类方法与属性访问调用：quay 93.4% 调用点在类外，扩面实测下界 ≥5,309 条 call 边
status: ready
labels:
  - gap
  - parser
  - query
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-call-edge-dedup-collapses-method-edges
---
## Proposal

**现象（实测）**：quay scope `b4f87b21` 有 5,847 实体 / 7,616 关系，其中 `call` 只有 2 条。AST 普查（119,366 个 CallExpression）显示：
- 类方法内 **7,838（6.6%）**，类方法外 **111,528（93.4%）**；类外分布：顶层函数 77,547、箭头/函数表达式 20,303、对象方法 9,552；
- 语料实体构成是 4,323 个 function、16 个 class——当前的遍历设计对这个语料天然只能产出个位数 call 边。

**根因（设计限制，非 TypeChecker 失败）**：
- `src/parser/call-edge-extractor.ts:9-10` 注释写明「Only class methods are analyzed — standalone functions are intentionally excluded」；
- `:49` 只遍历 `sourceFile.getClasses()`，`:55` 只遍历 `cls.getMethods()`；
- `:60-62` 只接受 callee 为 `PropertyAccessExpression` 的调用，任何裸标识符 `foo()` 直接返回；
- `tests/unit/parser/call-edge-extractor.test.ts:172-187` 显式断言 plain function call 必须跳过。

已实测确认 TypeChecker 本身工作正常（夹具里 `new A().foo()` 能解析出边），所以不需要“修 TypeChecker”。

**扩面模拟（/tmp 探针，未改仓库）**：增加「顶层/导出函数覆盖 + 裸标识符按声明解析」（两端都要求命中已有实体）后：
- 可解析调用点 16,543，去重到方法级后 **≥5,309 条边**（下界）；
- 10,693 个调用点在查询 TypeChecker 时抛 ts-morph 内部 TypeError，必须逐点 try/catch；
- 3,688 个候选调用的源函数不是导出函数（当前 `FunctionExtractor` 不产实体，`src/parser/function-extractor.ts:54-104` 只收导出函数/导出箭头常量），本任务**明确不扩实体面**，这些点继续跳过；
- 2,436 个候选调用位于模块顶层，没有源函数实体，同样跳过。

**修复方向**：
1. `extractFromFile` 在 `getClasses()` 之外遍历 `sourceFile.getFunctions()` 与导出/被导出的箭头/函数表达式变量声明（复用 `FunctionExtractor` 的命名与导出判定），source 用 `${relPath}.${name}`。
2. 裸标识符 callee：`checker.getSymbolAtLocation` → `getAliasedSymbol()` → 按**声明**（文件 + 函数名）映射到实体 ID，禁止用裸名 Map（quay 实测 229 组重名覆盖 798 个实体，`main` 出现 167 次）。
3. 属性访问保留现有逻辑；新增目标方法存在性校验（当前夹具 `A.s()` 无同名方法也会成边）。
4. 每个 TypeChecker 查询包 try/catch；统计并输出被跳过/异常的调用点数（verbose）。
5. 同步更新 `src/cli/mcp/tools/call-graph-tools.ts:23-24` 的精度说明与覆盖范围。

**明确边界（防范围膨胀）**：本任务不扩 `FunctionExtractor` 的实体面；不覆盖对象字面量方法、构造函数体、类属性箭头函数（可以在实现里留 TODO，但必须有明确断言或注释说明当前不支持）。这些若要做，另立任务。

**依赖**：方法级 call 边目前会被 `deduplicateRelations` 的类级键合并（`src/parser/typescript-parser.ts:391-406`），不先修会把本任务的产量重新压回个位数，所以本任务依赖 `gap-call-edge-dedup-collapses-method-edges`。

## AC

- [x] 覆盖矩阵夹具（顶层函数调用、导出箭头函数调用、裸标识符 callee、类方法内裸调用、跨文件函数调用）均产出带正确 `sourceMethod` 的 call 边；负对照：`fs.readFile` / `console.log` 等外部 API 不产边
- [x] 按声明解析：夹具里两个同名 `main` 函数跨文件存在时，调用只连各自声明，不互相串连；实现中不得使用裸名 Map 解析目标
- [x] 目标方法存在性校验：调用不存在的方法（夹具 `A.s()` 且 A 无 s）不产边
- [x] 明确边界被机械钉住：非导出函数仍不新增实体，相关调用点计数在 verbose 输出里可见；对象字面量方法/构造函数体/类属性箭头函数的“不支持”有断言或注释
- [x] 健壮性：TypeChecker 查询逐点 try/catch；在 quay 副本上全量跑完不因 ts-morph 内部异常崩溃（实测约 10,693 次异常）
- [x] 真实数据：quay 副本复跑后 `relationCountByType.call` 从 2 升到 ≥5,000，并抽样人工核对 5 条边（source/sourceMethod/target/targetMethod）确实对应真实调用
- [x] 性能有数字：记录 quay 534 文件分析耗时与内存增量（相对修复前），给出可接受性判断
- [x] `src/cli/mcp/tools/call-graph-tools.ts` 的精度/覆盖描述与新实现一致
- [x] `bash scripts/test.sh --for-task gap-call-edge-function-coverage` 与 `npm run type-check` 通过

## DoD

不是“夹具里能出边”就算完成。要在 quay 的真实副本上全量跑一次分析，给出修复前后的 `call` 边数量、抽样边列表、耗时与内存对照，并证明边不是靠同名裸名误连出来的（至少 5 条跨文件边按声明核对通过）；同时展示外部 API 调用没有被误收进图、非导出函数相关调用点被明确跳过而不是静默丢失。

## Touches

- tasks/gap-call-edge-function-coverage.md
- src/parser/call-edge-extractor.ts
- src/parser/function-extractor.ts
- src/cli/mcp/tools/call-graph-tools.ts
- src/parser/typescript-parser.ts
- src/plugins/typescript/index.ts
- src/cli/processors/arch-json-provider.ts
- tests/unit/parser/call-edge-extractor.test.ts
- tests/unit/parser/function-extractor.test.ts
- tests/unit/cli/mcp/call-graph-tools.test.ts
