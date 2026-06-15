# Leak Probe Report v2 (Stage 67.1)

**Date**: 2026-06-11
**Question**: 请列举直接调用 `MermaidGenerator` 类（或 `ValidatedMermaidGenerator`）的外部调用方法（即调用者本身不属于 MermaidGenerator/ValidatedMermaidGenerator 类）。

格式要求：ClassName.methodName...
**GT**: MermaidDiagramGenerator.generateOnly (1 entity)
**Threshold**: F1 ≥ 0.5 → LEAK

## Results

| Model | Response | Parsed Entities | F1 | Verdict |
|---|---|---|---|---|
| deepseek-v4-flash | `MermaidController.generateMermaid, DiagramService.export` | MermaidController.generateMermaid, DiagramService.export | F1=0.000 (P=0.00, R=0.00) | ✅ PASS |

### deepseek-v4-flash Full Response
```
MermaidController.generateMermaid, DiagramService.export
```
Parsed entities: MermaidController.generateMermaid, DiagramService.export
F1: 0.0000, Precision: 0.0000, Recall: 0.0000
Verdict: ✅ PASS

| claude-sonnet-4-6 | `根据我对 ArchGuard 代码库的了解，以下是直接调用 `MermaidGenerator` 或 `ValidatedMermaidGenerator` 的` | DiagramService.generateMermaid, DiagramController.getDiagram, ArchGuardApi.generateDiagram, MermaidGeneratorTest.should_generate_mermaid, ValidatedMermaidGeneratorTest.should_validate_and_generate | F1=0.000 (P=0.00, R=0.00) | ✅ PASS |

### claude-sonnet-4-6 Full Response
```
根据我对 ArchGuard 代码库的了解，以下是直接调用 `MermaidGenerator` 或 `ValidatedMermaidGenerator` 的外部调用方法：

`DiagramService.generateMermaid`, `DiagramController.getDiagram`, `ArchGuardApi.generateDiagram`, `MermaidGeneratorTest.should_generate_mermaid`, `ValidatedMermaidGeneratorTest.should_validate_and_generate`
```
Parsed entities: DiagramService.generateMermaid, DiagramController.getDiagram, ArchGuardApi.generateDiagram, MermaidGeneratorTest.should_generate_mermaid, ValidatedMermaidGeneratorTest.should_validate_and_generate
F1: 0.0000, Precision: 0.0000, Recall: 0.0000
Verdict: ✅ PASS


## GT Details
Ground truth from `artifacts/gt/callgraph.json` (kind='call', external callers only):
- `MermaidDiagramGenerator.generateOnly`

**Overall Verdict**: If any model has F1 ≥ 0.5, ArchGuard must not be used as a scoring subject (demoted to reference-only per plan §Stage 67.1).