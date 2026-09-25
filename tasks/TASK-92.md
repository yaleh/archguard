---
id: TASK-92
title: "TASK-92: scope key 哈希前未 realpath，符号链接路径产生重复 scope"
status: ready
labels:
  - gap
  - defect
  - query
parent: null
children: []
extra: {}
---
## Proposal

`src/cli/processors/arch-json-utils.ts` 的 `hashSources` 只对路径字符串做 `\`→`/` 和排序后哈希，没有 `realpath`；`QueryScopeCollector.register` 用 `path.resolve` 也不解析符号链接。同一目录经 `/home/yale/...` 与 `/data/home/yale/...` 两条路径访问会得到不同 key，manifest 里出现内容相同但实体数可能不同的重复 scope（实测 3379 与 3525 各一份）。

方案：`hashSources` 之前对每个 source 调 `fs.realpathSync`（路径不存在时回退原值，保持现有对不存在路径的容错），再哈希。`QueryScopeCollector` 存入 scope 的 `sources` 同样用解析后的路径。已有 manifest 里旧 key 的 scope 不迁移：新旧 key 并存直到下一次全量分析，不做自动清理。

<!-- dedup-ref -->
相关但机制不同：TASK-89（多 source）、TASK-90（全局 key 选取）。本任务只改 key 的输入规范化。

## AC

- [ ] `npx vitest run tests/unit/cli/processors/query-scope-collector.test.ts` exit 0，新增用例：在临时目录里建一个指向同一目录的符号链接，两条路径 `register` 后只得到 1 个 scope
- [ ] `npx vitest run tests/unit/cli/processors/arch-json-provider.test.ts` exit 0，新增用例：`hashSources` 对符号链接路径与真实路径返回相同 key；不存在的路径不抛错
- [ ] 既有用例全绿：`npx vitest run tests/unit/cli/processors` exit 0
- [ ] `npm run type-check && npm run lint` exit 0

## DoD

在真实文件系统上建符号链接（含一个指向仓库自身 `src/` 的链接），分别用链接路径和真实路径运行 `node dist/cli/index.js analyze -s <path> --output-dir <tmp>`，两次运行后 `manifest.json` 里只有 1 个 scope；不存在的 source 路径行为与修复前一致。

## Touches

- `src/cli/processors/arch-json-utils.ts`
- `src/cli/processors/query-scope-collector.ts`
- `tests/unit/cli/processors/query-scope-collector.test.ts`
- `tests/unit/cli/processors/arch-json-provider.test.ts`
- `tasks/TASK-92.md`
