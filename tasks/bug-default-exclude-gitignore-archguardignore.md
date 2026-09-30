---
id: bug-default-exclude-gitignore-archguardignore
title: 无 .gitignore 感知与 .archguardignore 支持,已跟踪但想排除的目录(如 archive/)只能靠手动
  --exclude(quay 项目复测发现)
status: todo
labels:
  - defect
  - mcp
  - cli
parent: null
children: []
extra:
  schema: execution
---
## Proposal

外部用户(quay 项目复测)报告:archguard 没有任何默认忽略规则或可配置的 ignore 文件机制,导致仓库里明显不该被分析的目录(比如历史归档目录)被当作正常源码扫入,污染 `summary`/`detect_duplicates` 等查询结果。经过与报告方来回核实,问题拆成两个独立、判据不同的部分,不能混为一谈:

**(3a) 被 `.gitignore` 忽略的非点目录不会被排除**

`src/cli/utils/file-discovery-service.ts` 的 `DEFAULT_EXCLUDES` 只有三条:
```
const DEFAULT_EXCLUDES = ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**'];
```
全仓库搜索 `archguardignore`/`.gitignore` 感知逻辑,零命中。用最小夹具验证:
```
$ mkdir -p /tmp/dot-test/.hidden && echo "export const x=1" > /tmp/dot-test/.hidden/foo.ts
$ node -e "globby(['/tmp/dot-test/**/*.ts'],{followSymbolicLinks:false,onlyFiles:true}).then(f=>console.log(f))"
[]
```
`.hidden` 之所以被排除,是 globby/fast-glob **默认不匹配点开头目录**(未显式传 `dot: true`)这一无关行为的副作用,不是 gitignore 感知——一个非点开头、但被 `.gitignore` 忽略的目录(例如 `gen/`)不会被这条规则挡住,会被正常扫入。quay 仓库里暂时没有"非点目录 + 被 gitignore 忽略 + 含 .ts"的真实例子可供演示(`git status --ignored` 命中的非点目录里 `dist/` 系列产物目录不含 `.ts`),需要用合成夹具验证。

**(3b) 被 git 跟踪、但用户想手动排除的目录,没有比 `--exclude` 更省心的机制**

quay 仓库的 `archive/` 目录是反例的反例——它**是** git 跟踪的正常文件(`git ls-files archive | wc -l` = 106,`git check-ignore -v archive` 无输出,不在 `.gitignore` 里),所以即使加了 `.gitignore` 感知也解决不了它。这类目录只能通过显式 `--exclude`/config 的 `exclude` 数组排除,archguard 目前没有 `.archguardignore` 这种更省心的、不用改 CLI 参数就能声明"这个项目里哪些目录不该被分析"的机制,也没有在输出里报告"本次生效的排除规则是什么"——用户没法从产物反推出为什么某个文件出现或不出现。

**修复方向**:
- (3a) 引入对 `.gitignore` 的感知(建议用 `ignore` npm 包解析仓库根 `.gitignore` 规则,应用到文件发现阶段),作为默认行为的一部分(不需要用户显式配置就生效,匹配"不该被分析的东西不该出现"这个直觉)。
- (3b) 支持项目根 `.archguardignore` 文件(gitignore 语法),与显式 `exclude` 配置项并存、取并集。
- 不论走哪条排除路径命中,analyze 的输出(verbose 模式或响应文本)里要能列出"本次生效的排除规则来源与内容"(例如:来自 `.gitignore` 的 N 条、来自 `.archguardignore` 的 M 条、来自 config `exclude` 的 K 条),让用户能验证自己的排除意图是否真的生效,而不是纯粹依赖"结果里少了什么"来倒推。

## AC

- [ ] 合成夹具:项目根有 `.gitignore` 写入 `gen/`,`gen/`(非点目录)下放一个含可提取实体的 `.ts` 文件;缺省 `analyze` 后该文件不出现在 `sourceFiles`/`summary` 里
- [ ] 同一夹具:`analyze` 的输出中能看到"因 .gitignore 排除了 gen/"或等价的、可读的排除规则说明,不是纯粹的"结果里没有"
- [ ] 在 `/data/home/yale/work/quay` 上,用 `.archguardignore` 或 config `exclude` 排除 `archive/` 后,复跑 `analyze`,`archguard_summary` 的包列表里不再出现 `archive/2026-09-07-zero-call-scripts/plugin/scripts` 这个包(quay 复测方给出的具体判据,约 17-18 个文件、89-94 个实体应消失)
- [ ] 同时验证 `.archguardignore` 与显式 `--exclude`/config `exclude` 可以叠加使用(各自排除不同目录,互不冲突、取并集)
- [ ] `npm test` 全量通过

## DoD

不是"引入了 ignore 解析库、单元测试里 mock 了一个 .gitignore 就算完成",而是要在两个真实场景各跑一次完整的 `analyze`:一个是合成夹具(证明 3a 这条纯 gitignore 场景确实生效),一个是真实的 `/data/home/yale/work/quay` 仓库(证明 3b 这条"手动声明排除已跟踪目录"确实能让 `archive/` 从产物里消失,而且是用 quay 复测方给出的具体检查手段——查 `archguard_summary` 的包列表——验证过的,不是理论上应该消失)。

## Touches

- src/cli/utils/file-discovery-service.ts
- 新增:`.archguardignore` 解析逻辑(建议独立模块,如 src/cli/utils/ignore-file-loader.ts)
- src/cli/config-loader.ts(如需支持 config 里声明 ignore 文件路径)
- CLI/MCP 的 analyze 输出格式化逻辑(用于展示生效的排除规则)
