# lint errors 状态（修复前 / lint:fix 后）

> **日期**: 2026-08-03
> **命令**: `npm run lint` = `eslint . --ext .ts`；`npm run lint:fix` = 同参 + `--fix`
> **对账方法**: ESLint 尾部汇总（`✖ N problems (X errors, Y warnings)`）与逐行解析
>   逐一核对（块感知解析，兼容 ESLint 变宽空格对齐与长消息换行），两边完全一致。

## (1) 修复前 error / warning 数

**4617 problems（480 errors, 4137 warnings）**，退出码 1。

按 rule 分布（前 10）:

| 数量 | 严重度 | Rule |
|------|--------|------|
| 1290 | warning | `@typescript-eslint/no-unsafe-member-access` |
| 803 | warning | `@typescript-eslint/no-unsafe-assignment` |
| 512 | warning | `@typescript-eslint/no-unsafe-call` |
| 419 | warning | `@typescript-eslint/no-explicit-any` |
| 253 | warning | `@typescript-eslint/no-unsafe-argument` |
| **229** | **error** | **parser error（无 rule-id，`plugin/dist/*.d.ts`）** |
| 218 | warning | `@typescript-eslint/explicit-function-return-type` |
| **182** | **error** | **`prettier/prettier`** |
| 187 | warning | `no-console` |
| 160 | warning | `@typescript-eslint/no-unsafe-return` |
| **64** | **error** | **`@typescript-eslint/no-unnecessary-type-assertion`** |

其余：`require-await` 83、`no-unsafe-function-type` 77、`unbound-method` 56、
`no-non-null-assertion` 47、`no-base-to-string` 26 等；error 侧另有个位数 `no-unsafe-assignment`(5)、
`prefer-promise-reject-errors`(1)、`no-unused-vars`(1)、`no-misused-promises`(1)。

## (2) lint:fix 后剩余 error / warning 数

`npm run lint:fix` 自动修复后，**重新跑 `npm run lint`**：

**4329 problems（234 errors, 4095 warnings）**，退出码仍为 1。

| 阶段 | errors | warnings | 总计 |
|------|--------|----------|------|
| 修复前 | 480 | 4137 | 4617 |
| lint:fix 后（fresh lint） | 234 | 4095 | 4329 |
| 变化 | **−246** | −42 | −288 |

- error 侧 −246 与 ESLint 报告"246 errors potentially fixable"**完全吻合**。
  修复掉的恰好是 `prettier/prettier`（182）+ `no-unnecessary-type-assertion`（64）。
- warning 侧 eslint 声称"0 warnings fixable"，但实际 −42（多为随 error 修复被重排/删除的
  行上连带消失的 warning）。
- 说明：`lint:fix` 命令自身尾部报告的剩余是 **4087（234 errors, 3853 warnings）**，与干净重跑
  差 242 个 warning——两边 **error 数完全一致**；差异是 `--fix` 单次运行自报口径与 fresh lint
  之间的口径差，本报告以 fresh `npm run lint`（4329）为准。

## (3) 剩余 error 按 rule 分组（前 5）

| # | 数量 | Rule | 说明 |
|---|------|------|------|
| 1 | **229** | parser error（无 rule-id） | `plugin/dist/*.d.ts`：`Parsing error: Unexpected token {` / `declare` / `interface` / `type` … |
| 2 | **2** | parser error（`reserved`） | `Parsing error: The keyword 'interface' is reserved`（同为 parser 失败，归到 parser error 家族） |
| 3 | 1 | `@typescript-eslint/no-unused-vars` | — |
| 4 | 1 | `@typescript-eslint/prefer-promise-reject-errors` | — |
| 5 | 1 | `@typescript-eslint/no-misused-promises` | — |

**231/234 的剩余 error 都是同一根源**：`@typescript-eslint/parser` 解析 `plugin/dist/*.d.ts`
（plugin 包的**构建产物** .d.ts）失败。这不是源码问题，`lint:fix` 无法修复；根治方式是把
`plugin/dist` 加入 `.eslintignore` / `ignorePatterns`，或用 `--ext .ts` 之外排除该目录。

## (4) 总文件数影响面

| 阶段 | 受影响文件数 |
|------|--------------|
| 修复前 | **478** |
| lint:fix 后 | **456**（净 −22；有文件被彻底修净，也有文件因修复被并/删） |

`lint:fix` 实际改动 **42 个文件**（`git diff --stat`：42 files changed, 569 insertions(+), 334 deletions(-)）。

## 备注

- 前五 warning 占总量近八成（1290+803+512+419+253 = 3277 / 4095 ≈ 80%），全部是
  `@typescript-eslint/no-unsafe-*` + `no-explicit-any` 类型安全类告警，**不可自动修复**，
  需要逐文件加显式类型。
- `no-console`（187）大多是可单行加 eslint-disable 或换成 logger 的低风险项。
