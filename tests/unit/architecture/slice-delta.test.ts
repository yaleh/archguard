/**
 * slice-delta.mjs — Refactor Slice / Expected Delta 原型的契约测试。
 *
 * 测试通过 **spawn 真实 CLI** 来断言退出码与产物结构（不是 import 内部函数），因为"退出码 + JSON 报告"
 * 就是这个原型的对外契约。核心的机械证据是「防倒灌」（AC 第 4 项）：换掉 --observed，computedDelta 与
 * negativeControl 两段必须逐字节不变——这条反向测试是 DoD「computedDelta 是被算出来的，不是被喂出来的」
 * 的机械保证，不是它的替代品。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'docs', 'experiments', 'layer-map', 'slice-delta.mjs');
const FIX = path.join(REPO_ROOT, 'tests', 'fixtures', 'slice-delta');
const GOAL_ARCH = path.join(FIX, 'goal-033-fork-point.arch.json');
const GOAL_SLICE = path.join(FIX, 'goal-033-slice.json');
const GOAL_OBSERVED = path.join(FIX, 'goal-033-observed.json');
const SYNTH_ARCH = path.join(FIX, 'synthetic-small.arch.json');

let TMP = '';
beforeAll(() => {
  // /tmp 里可能有别的用户留下的同名文件；mkdtemp 建唯一新目录。退路是 node_modules/.cache（不在 git 里）。
  for (const base of [os.tmpdir(), path.join(REPO_ROOT, 'node_modules', '.cache')]) {
    try {
      fs.mkdirSync(base, { recursive: true });
      TMP = fs.mkdtempSync(path.join(base, 'slice-delta-test-'));
      return;
    } catch {
      /* 试下一个 */
    }
  }
  throw new Error('测试无法找到可写临时目录');
});
afterAll(() => {
  if (TMP) fs.rmSync(TMP, { recursive: true, force: true });
});

const readJson = (p: string): any => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (name: string, obj: unknown): string => {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
};

interface RunResult {
  status: number | null;
  report: any;
  stdout: string;
}
function run(args: string[]): RunResult {
  const out = path.join(TMP, `report-${Math.random().toString(36).slice(2)}.json`);
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--json', out], { encoding: 'utf8' });
  let report: any = null;
  try {
    report = JSON.parse(fs.readFileSync(out, 'utf8'));
  } catch {
    report = null;
  }
  return { status: r.status, report, stdout: r.stdout ?? '' };
}

const SYN_MOVES = [
  { file: 'alpha-main.ts', from: 'alpha', to: '', symbols: ['alphaMain', 'alphaHelper'] },
];
const synSlice = (over: Record<string, unknown> = {}) => ({
  subject: '',
  concern: 'synthetic-small',
  proposedCut: { moves: SYN_MOVES, consumers: [] },
  negativeControl: {
    description: 'restore the only cycle edge',
    restoreEdges: [{ from: '', to: 'alpha' }],
  },
  ...over,
});

const goalRun = (extra: string[] = []) => run([GOAL_ARCH, '--slice', GOAL_SLICE, ...extra]);

describe('slice-delta.mjs — CLI 契约与输入校验', () => {
  it('无参数时打印用法并以退出码 2 结束（不是抛异常）', () => {
    const r = run([]);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('用法');
    expect(r.stdout).toContain('退出码');
    expect(r.report.status).toBe('not-evaluated');
  });

  it('给了 current 但没给 --slice 时同样打印用法、退出码 2', () => {
    const r = run([GOAL_ARCH]);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('用法');
  });
});

describe('slice-delta.mjs — GOAL-033 dogfood（唯一真实用例）', () => {
  it('从 before 图 + 显式切法算出 6 → 4，且 fan-in 随 cli 一起离开', () => {
    const r = goalRun(['--observed', GOAL_OBSERVED]);
    expect(r.status).toBe(0);
    expect(r.report.status).toBe('evaluated');

    // before：6 员环，含 ""、cli、fan-in
    expect(r.report.current.sccSize).toBe(6);
    expect(r.report.current.sccMembers).toEqual(expect.arrayContaining(['', 'cli', 'fan-in']));

    // after：恰为 4 员，不含 cli、不含 fan-in
    expect(r.report.computedDelta.sccAfter).toEqual(['', 'gate', 'gate/config', 'gate/factories']);
    expect(r.report.computedDelta.sccAfter).not.toContain('cli');
    expect(r.report.computedDelta.sccAfter).not.toContain('fan-in');
    expect(r.report.computedDelta.sccLeft.sort()).toEqual(['cli', 'fan-in']);

    // 恰好一条边消失："" -> cli；没有新增任何 -> fan-in 的边
    expect(r.report.computedDelta.removedEdges).toHaveLength(1);
    expect(r.report.computedDelta.removedEdges[0].from).toBe('');
    expect(r.report.computedDelta.removedEdges[0].to).toBe('cli');
    expect(r.report.computedDelta.addedEdges.filter((a: any) => a.to === 'fan-in')).toEqual([]);

    expect(r.report.guards.clean).toBe(true);
  });

  it('fan-in 的离开原因来自重算可达性（其唯一入边来源是 cli）', () => {
    const r = goalRun(['--observed', GOAL_OBSERVED]);
    const fanIn = r.report.computedDelta.whyLeft.find((w: any) => w.dir === 'fan-in');
    const cli = r.report.computedDelta.whyLeft.find((w: any) => w.dir === 'cli');
    expect(fanIn).toBeDefined();
    expect(fanIn.inEdgeSourcesBefore).toEqual(['cli']);
    expect(fanIn.inEdgeSourcesAfter).toEqual(['cli']);
    expect(fanIn.inCycleAfter).toBe(false);
    expect(fanIn.reason).toContain('cli');
    expect(cli.inEdgeSourcesAfter).toEqual([]);
  });

  it('declared(6→5) / computed(6→4) / observed(6→4) 是三个独立读数，互不改写', () => {
    const r = goalRun(['--observed', GOAL_OBSERVED]);
    // declared 原样保留（没有被 computed 的 4 "修正"）
    expect(r.report.declaredPrediction.sccSize).toBe(5);
    expect(r.report.declaredPrediction.sccMembers).toContain('fan-in');
    expect(r.report.predictionComparison.declaredVsComputed.declaredSccSize).toBe(5);
    expect(r.report.predictionComparison.declaredVsComputed.computedSccSize).toBe(4);
    expect(r.report.predictionComparison.declaredVsComputed.relation).toBe('diverges');

    // observed 原样保留，且与 computed 一致
    expect(r.report.observedDelta.sccSize).toBe(4);
    expect(r.report.observedDelta.sccMembers).toEqual([
      '',
      'gate',
      'gate/config',
      'gate/factories',
    ]);
    expect(r.report.predictionComparison.observedVsComputed.relation).toBe('agrees');
  });

  it('防倒灌：换掉 --observed，computedDelta 与 negativeControl 逐字节不变', () => {
    const tampered = writeJson('observed-tampered.json', {
      sccSize: 999,
      sccMembers: ['nope'],
      note: 'tampered',
    });
    const withReal = goalRun(['--observed', GOAL_OBSERVED]);
    const withTampered = goalRun(['--observed', tampered]);
    const without = goalRun();

    const sections = (r: RunResult) => [
      JSON.stringify(r.report.computedDelta),
      JSON.stringify(r.report.negativeControl),
    ];
    const [realComputed, realNeg] = sections(withReal);
    const [tamComputed, tamNeg] = sections(withTampered);
    const [noneComputed, noneNeg] = sections(without);

    expect(tamComputed).toBe(realComputed);
    expect(noneComputed).toBe(realComputed);
    expect(tamNeg).toBe(realNeg);
    expect(noneNeg).toBe(realNeg);

    // 反证：被篡改的读数确实进了报告（否则上面的相等是空洞的）
    expect(withTampered.report.observedDelta.sccSize).toBe(999);
    expect(withTampered.report.predictionComparison.observedVsComputed.relation).toBe('diverges');
    expect(without.report.observedDelta).toBeNull();
    expect(without.report.predictionComparison.observedVsComputed).toBeNull();
  });

  it('同一输入连续两次运行，报告逐字节一致', () => {
    const a = goalRun(['--observed', GOAL_OBSERVED]);
    const b = goalRun(['--observed', GOAL_OBSERVED]);
    expect(JSON.stringify(b.report)).toBe(JSON.stringify(a.report));
  });
});

describe('slice-delta.mjs — 护栏（negative control / must-not-change）', () => {
  it('GOAL-033 输入下负对照成立：恢复 "" -> cli 后 subject 回到 before 的环', () => {
    const r = goalRun(['--observed', GOAL_OBSERVED]);
    expect(r.status).toBe(0);
    expect(r.report.negativeControl.subjectBackInScc).toBe(true);
    expect(r.report.negativeControl.falsified).toBe(true);
    expect(r.report.negativeControl.subjectSccMembersAfterRestore).toEqual(
      r.report.current.sccMembers
    );
  });

  it('负对照换成一条与关注点无关的边时不可证伪：falsified=false 且退出码 1', () => {
    const base = readJson(GOAL_SLICE);
    const unrelated = writeJson('slice-unrelated-negctl.json', {
      ...base,
      negativeControl: {
        description: 'kernel -> ts-demo（与 subject 的环无关）',
        restoreEdges: [{ from: 'kernel', to: 'ts-demo' }],
      },
    });
    const r = run([GOAL_ARCH, '--slice', unrelated]);
    expect(r.status).toBe(1);
    expect(r.report.negativeControl.falsified).toBe(false);
    expect(r.report.negativeControl.subjectBackInScc).toBe(false);
    expect(r.report.guards.clean).toBe(false);
  });

  it('must-not-change 可触发：切法让 "" -> fan-in 新出现时报违例并退出 1', () => {
    const base = readJson(GOAL_SLICE);
    const mnc = writeJson('slice-mnc-trigger.json', {
      ...base,
      proposedCut: {
        moves: [
          {
            file: 'cli/driver.ts',
            from: 'cli',
            to: 'fan-in',
            symbols: ['runDriver', 'ALL_SERVICE_NAMES', 'HOSTED_SERVICE_NAMES'],
          },
        ],
        consumers: [],
      },
    });
    const r = run([GOAL_ARCH, '--slice', mnc]);
    expect(r.status).toBe(1);
    expect(r.report.mustNotChange.violations.length).toBeGreaterThan(0);
    expect(
      r.report.mustNotChange.violations.some(
        (v: any) => v.kind === 'forbidden-new-edge' && v.edge === ' -> fan-in'
      )
    ).toBe(true);
    expect(
      r.report.computedDelta.addedEdges.some((a: any) => a.from === '' && a.to === 'fan-in')
    ).toBe(true);
  });

  it('缺 negative control 时直接 not-evaluated、退出 2（机制强制，不靠人记得）', () => {
    const slice = writeJson('slice-no-negctl.json', {
      subject: '',
      proposedCut: { moves: SYN_MOVES, consumers: [] },
    });
    const r = run([SYNTH_ARCH, '--slice', slice]);
    expect(r.status).toBe(2);
    expect(r.report.status).toBe('not-evaluated');
    expect(r.report.reason).toMatch(/negative control/);
  });
});

describe('slice-delta.mjs — 不猜：降级为 not-evaluated', () => {
  it('自校验失败（重算 SCC ≠ moduleGraph.cycles）时不出一份看着合理的报告', () => {
    const arch = readJson(SYNTH_ARCH);
    const mg = arch.extensions.tsAnalysis.moduleGraph;
    // 删掉环上的一条边 beta -> ""，让重算的 SCC 与自报的 cycles 不一致
    mg.edges = mg.edges.filter((e: any) => !(e.from === 'beta' && e.to === ''));
    const broken = writeJson('synthetic-broken-selfcheck.arch.json', arch);
    const slice = writeJson('slice-for-broken.json', synSlice());
    const r = run([broken, '--slice', slice]);
    expect(r.status).toBe(2);
    expect(r.report.status).toBe('not-evaluated');
    expect(r.report.reason).toMatch(/自校验/);
  });

  it('覆盖不足（importedNames 只被切法覆盖一部分）时点名那条边与未覆盖的名字', () => {
    const slice = writeJson(
      'slice-partial-coverage.json',
      synSlice({
        proposedCut: {
          moves: [{ file: 'alpha-main.ts', from: 'alpha', to: '', symbols: ['alphaMain'] }],
          consumers: [],
        },
      })
    );
    const r = run([SYNTH_ARCH, '--slice', slice]);
    expect(r.status).toBe(2);
    expect(r.report.status).toBe('not-evaluated');
    expect(r.report.reason).toContain('alphaHelper');
    expect(r.report.reason).toMatch(/-> alpha/);
  });

  it('合成小图上的正例：切法算得出 delta，退出 0', () => {
    const slice = writeJson('slice-synthetic-ok.json', synSlice());
    const r = run([SYNTH_ARCH, '--slice', slice]);
    expect(r.status).toBe(0);
    expect(r.report.current.sccMembers).toEqual(['', 'alpha', 'beta']);
    expect(r.report.computedDelta.sccAfter).toEqual(['']);
    expect(r.report.computedDelta.sccLeft.sort()).toEqual(['alpha', 'beta']);
    expect(r.report.negativeControl.falsified).toBe(true);
  });
});

describe('slice-delta.mjs — provenance 与字段边界', () => {
  it('provenance 段含 analysis / slice / tool / observed / provenanceConsistency', () => {
    const pkg = readJson(path.join(REPO_ROOT, 'package.json'));
    const withObserved = goalRun(['--observed', GOAL_OBSERVED]);
    const p = withObserved.report.provenance;
    expect(p.analysis.workspaceRoot).toBe('/tmp/g033-before/packages/quay/src');
    expect(p.analysis.timestamp).toBe('2026-10-09T10:57:11.399Z');
    expect(p.slice.commit).toBe('1ac06fd85094a58d4954640811a787873f8ad2a1');
    expect(p.slice.repo).toBe('/data/home/yale/work/quay');
    expect(p.slice.worktree).toMatch(/5213eb614130bf9f8ade9e38b46da7e60fb1c536/);
    expect(p.tool.archguardVersion).toBe(pkg.version);
    expect(p.tool.script).toBe('docs/experiments/layer-map/slice-delta.mjs');
    expect(p.observed).not.toBeNull();
    expect(path.basename(p.observed.source)).toBe('goal-033-observed.json');
    expect(p.observed.commit).toBe('d1ea4331d840777f63aef1d2267a25dd39f6d884');
    // fixture 的 workspaceRoot 不是 git work tree ⇒ 如实 not-checked，并给出理由
    expect(p.provenanceConsistency.status).toBe('not-checked');
    expect(p.provenanceConsistency.reason).toMatch(/git/);

    // 不传 --observed 时为 null
    expect(goalRun().report.provenance.observed).toBeNull();
  });

  it('provenanceConsistency 在真实 git work tree 上给出 match / mismatch', () => {
    const head = spawnSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).stdout.trim();
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    const arch = readJson(SYNTH_ARCH);
    arch.workspaceRoot = REPO_ROOT;
    const archPath = writeJson('synthetic-repo-root.arch.json', arch);

    const matched = run([
      archPath,
      '--slice',
      writeJson(
        'slice-head-match.json',
        synSlice({ provenance: { repo: REPO_ROOT, ref: 'HEAD', commit: head } })
      ),
    ]);
    expect(matched.report.provenance.provenanceConsistency.status).toBe('match');

    const mismatched = run([
      archPath,
      '--slice',
      writeJson(
        'slice-head-mismatch.json',
        synSlice({ provenance: { repo: REPO_ROOT, ref: 'HEAD', commit: '0'.repeat(40) } })
      ),
    ]);
    expect(mismatched.report.provenance.provenanceConsistency.status).toBe('mismatch');
  });

  it('不产出 pass/fail 这类会被误读成 gate 的字段名（只用 evaluated / not-evaluated / violations）', () => {
    const r = goalRun(['--observed', GOAL_OBSERVED]);
    const keys = new Set<string>();
    const walk = (o: any): void => {
      if (!o || typeof o !== 'object') return;
      for (const k of Object.keys(o)) {
        keys.add(k);
        walk(o[k]);
      }
    };
    walk(r.report);
    expect(keys.has('pass')).toBe(false);
    expect(keys.has('fail')).toBe(false);
    expect(keys.has('passed')).toBe(false);
    expect(['evaluated', 'not-evaluated']).toContain(r.report.status);
    expect(r.report.guards.clean).toBe(true);
  });
});
