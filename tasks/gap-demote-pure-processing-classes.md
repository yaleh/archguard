---
id: gap-demote-pure-processing-classes
title: 把 ~17 个 class-as-function 的纯处理类降级为模块函数或并入调用方
status: done
labels:
  - gap
  - refactor
parent: null
children: []
extra:
  schema: execution
---
## Proposal

64 个无状态类中约 17 个是「穿 class 外衣的函数」——validator/detector/generator/renderer/writer/calculator 一类，不持有实例状态，方法拿参数进、算完出。把它们降为模块级函数或并入调用方模块，消除伪类。extractor/mapper/builder 三族（契约实现）保留不动。

## AC

- [x] mermaid 校验器：`QualityValidator` 与 `StructuralValidator`（`src/mermaid/validator-quality.ts` / `validator-structural.ts`）降为模块函数或合并成一个 validation 模块，`grep -rn "class QualityValidator\|class StructuralValidator" src/` 返回 0；`tests/unit/mermaid/validator-quality.test.ts`、`validator-structural.test.ts`、`validation-pipeline.test.ts` 绿
- [x] `CommentGenerator` / `CppPackageFlowchartGenerator` / `TestCoverageRenderer`（`src/mermaid/*`）降为模块函数，`grep -rn "class CommentGenerator\|class CppPackageFlowchartGenerator\|class TestCoverageRenderer" src/` 返回 0；`comment-generator.test.ts`、`cpp-package-flowchart-generator.test.ts`、`test-coverage-renderer.test.ts` 绿
- [x] `TestIssueDetector` + `TestCoverageMapper`（`src/analysis/test-*.ts`）降为模块函数或并入 `test-analyzer.ts`；`test-issue-detector.test.ts`、`test-coverage-mapper.test.ts` 绿
- [x] `MetricsHistoryWriter` + `TestOutputWriter`（`src/cli/*`）降为模块函数；`metrics-history-writer.test.ts`、`test-output-writer.test.ts` 绿
- [x] `MetricsCalculator` + `ArchJSONAggregator`（`src/parser/*`）降为模块函数；`metrics-calculator.test.ts`、`archjson-aggregator.test.ts` 绿
- [x] `DriftCalculator`（`src/analysis/jl/drift-calculator.ts`）降为模块函数；`drift-calculator.test.ts` 绿
- [x] `FrameworkDetector`（`src/plugins/golang/atlas/framework-detector.ts`）降为模块函数，调用方同步更新

## DoD

上述 17 个无状态类的 `class` 定义在 `src/` 中消失（各 `grep -rn "class <Name>" src/` 返回 0），逻辑改为模块函数或并入调用方，所有列出的测试文件全绿——「穿 class 外衣的函数」不再以类形式存在。

## Touches

- src/mermaid/validator-quality.ts
- src/mermaid/validator-structural.ts
- src/mermaid/comment-generator.ts
- src/mermaid/cpp-package-flowchart-generator.ts
- src/mermaid/test-coverage-renderer.ts
- src/analysis/test-issue-detector.ts
- src/analysis/test-coverage-mapper.ts
- src/cli/metrics-history-writer.ts
- src/cli/utils/test-output-writer.ts
- src/parser/metrics-calculator.ts
- src/parser/archjson-aggregator.ts
- src/analysis/jl/drift-calculator.ts
- src/plugins/golang/atlas/framework-detector.ts
- tests/unit/mermaid/validator-quality.test.ts
- tests/unit/mermaid/validator-structural.test.ts
- tests/unit/mermaid/comment-generator.test.ts
- tests/unit/mermaid/cpp-package-flowchart-generator.test.ts
- tests/unit/mermaid/test-coverage-renderer.test.ts
- tests/unit/analysis/test-issue-detector.test.ts
- tests/unit/analysis/test-coverage-mapper.test.ts
- tests/unit/cli/metrics-history-writer.test.ts
- tests/unit/cli/utils/test-output-writer.test.ts
- tests/unit/parser/metrics-calculator.test.ts
- tests/unit/parser/archjson-aggregator.test.ts
- tests/unit/analysis/jl/drift-calculator.test.ts
- tasks/gap-demote-pure-processing-classes.md
- src/mermaid/validation-pipeline.ts
- src/mermaid/generator.ts
- src/mermaid/index.ts
- src/parser/index.ts
- src/analysis/test-analyzer.ts
- src/cli/analyze/run-analysis.ts
- src/cli/commands/analyze.ts
- src/cli/commands/query.ts
- src/cli/mcp/tools/arch-health-tools.ts
- src/cli/processors/diagram-output-router.ts
- src/cli/processors/diagram-pipeline-runner.ts
- src/cli/processors/diagram-processor.ts
- src/cli/processors/test-coverage-writer.ts
- src/plugins/golang/go-atlas-coordinator.ts
- tests/unit/mermaid/validation-pipeline.test.ts
- tests/unit/analysis/metrics-history-reader.test.ts
- tests/unit/cli/analyze/run-analysis.test.ts
- tests/unit/cli/processors/diagram-output-router.test.ts
- tests/unit/cli/processors/diagram-pipeline-runner.test.ts
- tests/unit/cli/processors/diagram-processor-query-scopes.test.ts
- tests/unit/cli/processors/diagram-processor.test.ts
- tests/unit/cli/processors/test-coverage-writer.test.ts
- tests/integration/parallel-diagrams.test.ts
- tests/plugins/golang/atlas/framework-detector.test.ts
