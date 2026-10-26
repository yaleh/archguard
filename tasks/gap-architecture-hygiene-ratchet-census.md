---
id: gap-architecture-hygiene-ratchet-census
title: 普查型 ratchet census：超大文件 / 模块级可变状态 / 单语句 helper 副本，只降不升
status: todo
labels:
  - gap
  - architecture
parent: null
children: []
extra:
  schema: execution
---
## Proposal

archguard 没有 standing 的代码卫生普查基线。加一个确定性 census 判据（新测试文件 + 基线 JSON，参考 claudecodeui 的 `architecture-ratchet.test.ts`），对 archguard 自身 `src/**` 非测试 .ts 算三项：`oversizeFiles`（>800 行）、`moduleMutableState`（模块级 `let ` / `const X = new Map|Set|WeakMap`）、`smallHelperCopies`（同名函数声明计数）。基线只降不升：读数下降仍绿、只打印「可下调基线」；读数上升判红并点名维度+文件+基线值+实测值；带 false-form 用例证明能区分。

## AC

- [ ] 新增 `tests/unit/architecture/hygiene-ratchet-census.test.ts` 与基线 `tests/fixtures/architecture/hygiene-ratchet-census.baseline.json`；`npx vitest run tests/unit/architecture/hygiene-ratchet-census.test.ts` exit 0，输出逐维度实测总数
- [ ] 基线由判据同一套读法生成、写入当前树真实读数；基线头部写明「只许下调，上调需 RECORDED CHANGE」；`package.json` 加 `census` script 指向该测试
- [ ] false-form 用例：对内存读数做篡改（基线外 +1 处模块级 `let`、基线内文件行数 +1、多 1 份同名 helper），每种判红且错误信息含维度名与文件路径
- [ ] 下降不红：读数低于基线时判绿，输出含「可下调基线」
- [ ] 扫描集正确：`__*` 前缀、`tests/`、`*.test.ts`、`node_modules` 不在扫描集；根 `src/` 在扫描集
- [ ] `npm run type-check` 通过

## DoD

在真实文件上做漂移演练：临时新建一个含一行模块级 `let` 的非测试文件 → 判据点名该文件与 moduleMutableState 判红；还原 → 全绿——census 机械可判，且不阻塞同批其它重构任务（下降只提示）。

## Touches

- tasks/gap-architecture-hygiene-ratchet-census.md
- tests/unit/architecture/hygiene-ratchet-census.test.ts (new)
- tests/fixtures/architecture/hygiene-ratchet-census.baseline.json (new)
- package.json
