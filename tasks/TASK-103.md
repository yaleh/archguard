---
id: TASK-103
title: "TASK-103: literal dispersion 的正则只匹配双引号，单引号代码（含本仓库）全部漏检"
status: ready
labels:
  - gap
  - defect
  - analysis
  - shape-smells
parent: null
children: []
extra: {}
---
## Proposal

`src/analysis/shape-smells/literal-dispersion.ts` 是基于正则的 v1 实现，字符串字面量的匹配全部写死双引号：`STRING_LITERAL_UNION_RE`、`STRING_LITERAL_RE`、`CASE_LITERAL_RE`，以及比较检测里的 `=== "x"` / `"x" ===`（约 145、278 行）和 `case "x":`（约 285 行）。只有 `ENUM_MEMBER_RE` 同时接受单双引号。实测（正则拷贝）：`type S = "a" | "b"` 匹配 1 次，`type S = 'a' | 'b'` 匹配 0 次。本仓库的 TS 代码用单引号（如 `src/analysis/jl/types.ts` 的 `export type ProjectionMode = 'direct' | 'jl'`），所以对这类代码，字面量联合类型根本不会被识别为判别类型，比较处也识别不到，`archguard_detect_shape_smells` 返回 0 不代表没有分散。quay 报告里 `shape_smells` 连续返回 0 且缺少正对照，很可能是这个原因（quay 侧代码的引号风格未核实，不作定论）。

方案：三处正则与比较检测统一支持单、双引号（用 `(["'])…\1` 反向引用保证引号配对，联合类型里允许成员混用引号）；不处理带插值的模板字符串，无插值的反引号字面量暂不纳入（在本文件 `## Evidence` 记录为已知边界）。`extractComparedValue` 等下游按新的捕获组编号调整。

<!-- dedup-ref -->
相关：TASK-101 的字面量分散正对照应使用单引号 fixture，才能防止本缺陷复发；`src/analysis/shape-smells/scope-filter.ts` 的跨模块过滤（单个顶层模块内的分散会被丢弃）也会让结果为 0，但那是有意行为，本任务不改。

## AC

- [x] `npx vitest run tests/unit/analysis/shape-smells/literal-dispersion.test.ts` exit 0，新增用例：单引号的字符串字面量联合类型被提取为判别类型（值集合与双引号写法一致）
- [x] 同一测试文件新增用例：`=== 'x'`、`'x' ===`、`case 'x':` 在单引号代码里被识别为比较位置；混合引号的联合类型（`'a' | "b"`）被完整提取
- [x] 同一测试文件的既有双引号用例全部保持通过（回归）
- [x] 同一测试文件新增一组成对用例：同一状态字面量分散在 3 个文件，双引号与单引号两种写法各自报出相同的 smell
- [x] `npx vitest run tests/unit/analysis/shape-smells tests/unit/cli/mcp/shape-smell-tools.test.ts` exit 0
- [x] `npm run type-check && npm run lint` exit 0

## DoD

对本仓库自身运行 `archguard_detect_shape_smells`（或直接对一段单引号 fixture 调 `detectDispersion`），修复前 0 命中、修复后能报出植入的单引号跨文件字面量分散；实测输出贴入本文件 `## Evidence`。

## Touches

- `src/analysis/shape-smells/literal-dispersion.ts`
- `tests/unit/analysis/shape-smells/literal-dispersion.test.ts`
- `tasks/TASK-103.md`

## Evidence

Implementation commit: `4e2a0809` on `task/TASK-103`.

- `npx vitest run tests/unit/analysis/shape-smells tests/unit/cli/mcp/shape-smell-tools.test.ts`: 5 files, 75 tests passed (literal-dispersion.test.ts: 30, of which 6 new single-quote cases; the 24 pre-existing double-quote cases unchanged and passing).
- `npm run type-check`: exit 0. `npm run lint`: 0 errors (warnings only, pre-existing).
- DoD before/after, fixture = single-quoted `export type ProjectionMode = 'direct' | 'jl';` in `src/a/types.ts`, `m === 'jl'` in `src/b/x.ts`, `case 'jl':` in `src/c/y.ts`, `detectDispersion(..., { srcRoot: 'src' })`, run against develop's version of the module vs. this branch:

  ```
  before types=0 smells=0 []
  after  types=1 smells=1 [["ProjectionMode","jl",3,"warning"]]
  ```

- Known boundary: template literals (including interpolation-free backtick literals) are not matched, in unions or in comparisons. Only single- and double-quoted literals are supported.
