---
id: bug-symlink-file-discovery-mismatch
title: 符号链接被 ts-morph 独立 glob 重新引入且扩展名覆盖与插件声明不一致(quay 项目复测发现)
status: ready
labels:
  - defect
  - parser
  - typescript
parent: null
children: []
extra:
  schema: execution
---
## Proposal

外部用户(quay 项目,两个独立会话交叉复测)报告并经本仓库直接复现确认:对一个真实项目(`/data/home/yale/work/quay`)跑缺省 `archguard analyze`(无显式 `sources`,`projectRoot` 指向仓库根)时,最终 `arch.json` 的 `sourceFiles` 里混入了本该被排除的符号链接文件,导致实体数虚高、`detect_duplicates` 产出大量假阳性重复组、`summary` 的 `topByMethodCount` 里同一个类出现两次。

根因已定位到具体代码路径,不是猜测:

1. `src/cli/utils/file-discovery-service.ts` 的 `FileDiscoveryService.discoverFiles()` 调用 `globby()` 时**正确地**传了 `followSymbolicLinks: false`。直接单独调用它复现:
   ```
   $ cd /data/home/yale/work/quay && node --input-type=module -e "
     import { FileDiscoveryService } from '.../dist/cli/utils/file-discovery-service.js';
     const svc = new FileDiscoveryService();
     const files = await svc.discoverFiles({ sources: ['./'], exclude: [], skipMissing: false });
     console.log(files.length, files.filter(f=>require('fs').lstatSync(f).isSymbolicLink()).length);
   "
   454 0
   ```
   454 个文件、0 个符号链接——这一层是对的。

2. 但这个结果只被 `src/cli/processors/arch-json-provider.ts:226-235` 拿去算磁盘缓存的 key(`archJsonDiskCache.computeKey(tsFiles)`),**从未被传给真正的解析器**。真正解析走的是同一文件第 535 行 `plugin.parseProject(workspaceRoot, config)`,最终落到 `src/parser/typescript-parser.ts:184-197`:
   ```ts
   fsProject.addSourceFilesAtPaths([
     `${rootDir}/${pattern}`,     // pattern 默认 '**/*.ts'
     ...builtinExcludes,
     ...callerExcludes,
   ]);
   ```
   这是 **ts-morph 自己的 glob**,和 `FileDiscoveryService` 完全独立、没有传任何 symlink 相关选项,ts-morph/`@ts-morph/common` 底层默认跟随符号链接。

3. 端到端复现(与外部报告的数字精确一致):
   ```
   $ cd /data/home/yale/work/quay
   $ node /data/home/yale/work/archguard/dist/cli/index.js analyze -f json -v --output-dir /tmp/quay-repro-output
   ...
   ℹ b4f87b21  parsed/primary  5317 entities  /data/home/yale/work/quay

   $ python3 -c "import json,os; d=json.load(open('.archguard/query/b4f87b21/arch.json'));
     files=d['sourceFiles']; print(len(files), len([f for f in files if os.path.islink(f)]))"
   500 46
   ```
   454(真实文件,discoverFiles 算对的那份) + 46(符号链接,ts-morph 自己重新 glob 出来的) = 500,与两次独立复测的 quay 会话报告的数字完全对上。

附带发现的第二个、根因相同的问题:文件发现的 glob pattern 硬编码为 `**/*.ts`(`file-discovery-service.ts:105`),而 TypeScript 插件自己声明的 `metadata.fileExtensions = ['.ts', '.tsx', '.js', '.jsx']`(`src/plugins/typescript/index.ts:98`)。也就是说插件自称支持 `.tsx/.js/.jsx`,但文件发现阶段这三种扩展名的文件从一开始就不会被枚举到——声明能力与实际实现不一致。quay 仓库里 `plugin/scripts/*.mjs`(12 个)、`plugin/test` 下几乎全部 `.mjs` 测试文件因此完全不在分析范围内,且没有任何"N 个文件因扩展名被跳过"之类的提示,是静默的。

**修复方向**(不做绕过,要求两套发现逻辑合一,而不是给 ts-morph 单独打个 symlink 补丁):
- 让 `TypeScriptParser.parseProject()` 不再自己对 `rootDir` 重新 glob,而是接受一个显式的文件路径数组(`FileDiscoveryService.discoverFiles()` 已经算对的那份),通过 `fsProject.addSourceFilesAtPaths(explicitFileList)`(ts-morph 接受显式路径数组,不强制要求 glob pattern)。需要确认并同步修改所有调用 `parseProject(rootDir, pattern, ...)` 的调用点(包括 `parseWorkerPool` 走的并行解析路径,如果它是独立实现,需要同样处理)。
- `file-discovery-service.ts` 的 glob pattern 从硬编码 `**/*.ts` 改为覆盖插件声明的 `.ts/.tsx/.js/.jsx`(可以直接读 `plugin.metadata.fileExtensions`,避免未来两处再次失配)。`.mjs/.cjs/.mts/.cts` 是否纳入本任务评估决定,若不纳入,分析输出需要报告"N 个文件因扩展名不支持被跳过"而不是静默丢弃。

**落地时的补充发现(本轮修复)**:`detect_duplicates` 走的是**第三条**独立发现路径——`src/analysis/duplicates/group.ts` 的 `collectSourceFiles()` 用的是 `glob` 包的 `globSync()`。`glob` 没有"排除符号链接文件"的选项(`follow` 只作用于符号链接**目录**),所以即使 `analyze` 侧已修好,`query --duplicates` 仍会把 `experiments/quay-perpetual-stream/scripts/X.ts`(→ `plugin/scripts/X.ts` 的符号链接)当成第二个副本,复现出修复前的 483 组。已改为 `globbySync(..., { followSymbolicLinks: false })`,与 `FileDiscoveryService` 用同一保证。

## AC

- [x] 在 `/data/home/yale/work/quay` 缺省 `analyze`(无显式 `sources`)后,`.archguard/query/<scope-key>/arch.json` 的 `sourceFiles` 中 `fs.lstatSync(f).isSymbolicLink()` 为 true 的数量为 0,总数为 454(与本任务记录的 `FileDiscoveryService` 独立复现数字一致;若因后续代码变化导致真实文件数变化,判据是"总数等于 `FileDiscoveryService.discoverFiles` 独立调用算出的数字",而不是写死 454)
- [x] 同一次 analyze 后 `archguard_detect_duplicates`(或 CLI 等价查询)返回的重复组总数明显低于修复前的 483 组量级,且前几组不再是 `experiments/quay-perpetual-stream/scripts/X.ts` 与 `plugin/scripts/X.ts` 的符号链接对(用 `grep experiments.*plugin/scripts` 之类判断两侧路径是否互为符号链接关系)
- [x] 负对照:在一个测试夹具里同时构造 (a) 两个真实文件里完全相同的函数体(应被检出为重复)、(b) 一个指向 (a) 中某文件的文件级相对路径符号链接(不应产生第三个重复成员)、(c) 一个目录级符号链接指向另一个含 `.ts` 文件的目录(该目录下文件不应被重复解析),跑 `detect_duplicates` 后 (a) 仍然被检出、(b)(c) 不产生额外条目
- [x] 在同一夹具里放 `.tsx`/`.js`/`.jsx` 各一个含可提取实体的文件,`archguard_summary` 能看到对应实体被解析(不是 0)
- [x] 若 `.mjs`/`.cjs`/`.mts`/`.cts` 本任务决定不纳入文件发现范围,analyze 的输出(verbose 或响应文本)中需要有类似"N files skipped by extension"的统计,不能是静默丢弃
- [x] `npm test` 全量通过

## DoD

不是"改了 `parseProject` 的调用方式、类型检查通过"就算完成,而是要在 `/data/home/yale/work/quay` 这个真实存在符号链接问题的仓库上,用同一条缺省 `analyze` 命令真实跑一遍,产出的 `arch.json` 里 `sourceFiles` 的符号链接计数必须是 0(不是理论推导,是真的读取产出文件、真的用 `fs.lstatSync` 逐个判断过)。同时必须用上面描述的三段式夹具(真实重复 + 文件级 symlink + 目录级 symlink)跑一次 `detect_duplicates`,证明"该检出的仍检出、不该检出的不再检出",而不是简单地让符号链接消失但连带把真实重复检测也弄坏了。

## Evidence

全部数据取自 2026-09-30 本轮在 `/data/home/yale/work/quay` 上的真实运行(worktree dist,merge 进 develop 后重建)。

1. 独立基线 `FileDiscoveryService.discoverFiles({sources:['./']})`:**476 文件 / 0 符号链接**;`countSkippedByExtension` = **1059**。

2. `analyze -f json -v` 后,`b4f87b21`(primary scope)的 `arch.json`(`mtime 2026-09-30 20:00:23`,由本轮运行写出):**sourceFiles 476 / 符号链接 0**——与第 1 步基线逐数字相等。verbose 输出含 `ℹ 1059 files skipped by extension (.mjs/.cjs/.mts/.cts not supported)`,与 `countSkippedByExtension` 相等(AC5:非静默)。
   - ⚠️ `.archguard/query/d74f9c1e` 仍有 44 个符号链接,但它是 **2026-09-06 的陈旧产物**(路径前缀还是旧的 `/home/yale/...`),非本轮写出;判据 scope 是 primary `b4f87b21`。

3. `query --duplicates`(CLI 等价于 `archguard_detect_duplicates`):
   - 修复 `group.ts` **之前**:`scannedFiles 500`,`totalGroups 483`,前 6 组全是 `experiments/quay-perpetual-stream/scripts/X.ts` ↔ `plugin/scripts/X.ts` 符号链接对——即 Proposal 记录的修复前数字,说明单靠 `analyze` 侧修复**不足以**满足 AC2。
   - 修复 **之后**:`scannedFiles 454`,`totalGroups 49`;返回的 20 组共 47 个成员中 `os.path.islink` 为真者 **0**;含 `experiments`+`plugin/scripts` 组合的组 **0**(AC2)。
   - 仍被检出的对照组是真实重复(如 `experiments/quay-perpetual-stream/scripts/drain-scheduler.ts` 与 `plugin/gate-scripts/drain-scheduler.ts`,两侧均非符号链接、inode 不同),证明没有把真实重复检测一并弄坏。

4. 夹具负对照:`tests/unit/parser/symlink-file-discovery.test.ts` 第三例直接调用 `detectDuplicates`——(a) `a/one.ts` 与 `b/two.ts` 仍成组;(b) `b/link.ts`(文件级符号链接)、(c) `linkdir/`(目录级符号链接)均不出现在任何成员里。把 `group.ts` 的修复 stash 掉后该用例**转红**(`expected true to be false`),恢复后转绿——是真正的回归闸,不是恒真断言。

5. `npx tsc --noEmit` 通过;`bash scripts/test.sh` 全量 **366 passed / 5353 tests passed**,0 failed。

## Touches

- src/parser/typescript-parser.ts
- src/cli/processors/arch-json-provider.ts
- src/cli/utils/file-discovery-service.ts
- src/analysis/duplicates/group.ts
- src/plugins/typescript/index.ts
- src/parser/parse-worker-pool.ts
- src/parser/parse-worker.ts
- tests/unit/parser/symlink-file-discovery.test.ts
- tasks/bug-symlink-file-discovery-mismatch.md

## Needs-Human

**执行 2026-09-30T10:22:13.429Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=anti-drift: BASELINE-MISMATCH: merge target 'develop' is not a continuation of the project's default branch 'master' — 'develop' (d959e8db) is NOT a continuation of the project's default branch 'master' (dd1a3d47) — it is 4 commit(s) behind and shares only an old merge base, so a task diff against it is meaningless.
  The develop...HEAD diff is therefore the mainline's divergence, NOT task bug-symlink-file-discovery-mismatch's own work; no declaration of ## Touches can satisfy it. This is a BASELINE defect, not an out-of-declared write by the task.
  Remedy: `quay init --force --adopt-branch-model` (preserves the old tip as 'develop-pre-quay-init-<sha>' and re-points 'develop' at 'master'), then re-dispatch the task.
- run_id：wk-prod-anchor
- session_id：a9f7e065-2f05-4069-936f-46ba291c1f12
- fan-in 日志：/data/home/yale/work/archguard/.quay/fan-in-bug-symlink-file-discovery-mismatch-wk-prod-anchor.log

## Needs-Human

**执行 2026-09-30T11:37:12.422Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 <60000ms 快速死亡（退避上限）；快速死亡分类：ordinary
- 失败步/判词：step=anti-drift: BASELINE-MISMATCH: merge target 'develop' is not a continuation of the project's default branch 'master' — 'develop' (d959e8db) is NOT a continuation of the project's default branch 'master' (dd1a3d47) — it is 4 commit(s) behind and shares only an old merge base, so a task diff against it is meaningless.
  The develop...HEAD diff is therefore the mainline's divergence, NOT task bug-symlink-file-discovery-mismatch's own work; no declaration of ## Touches can satisfy it. This is a BASELINE defect, not an out-of-declared write by the task.
  Remedy: `quay init --force --adopt-branch-model` (preserves the old tip as 'develop-pre-quay-init-<sha>' and re-points 'develop' at 'master'), then re-dispatch the task.
- run_id：wk-prod-anchor
- session_id：a9f7e065-2f05-4069-936f-46ba291c1f12
- fan-in 日志：/data/home/yale/work/archguard/.quay/fan-in-bug-symlink-file-discovery-mismatch-wk-prod-anchor.log
