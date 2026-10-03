#!/usr/bin/env node
// verify-edge-completeness.mjs — moduleGraph 边集合完整性 / type-only 拆分的【独立】对账。
//
// 目的：proposal-architecture-layer-check.md 的阶段 0（边集合完整）与阶段 1（type-only/值拆分）
// 各自的验收是在"修前树"上写的，只验证了各自的缺口。本脚本在阶段 2 的检查器内建之前，
// 用一条**不读 moduleGraph** 的路径重新取一遍边，与 ArchGuard 的产物对账。
//
// 独立性从何而来：
//   - 边来自本脚本自己按【位置】扫描源文件（行首 import/export … from 语句 + 动态 import()），
//     不调用 ts-morph、不读 moduleGraph.edges 来推导任何一条边；
//   - 解析 specifier → 目录 的规则（相对路径候选扩展、tsconfig paths 别名、裸包名）本脚本自行
//     实现，只从 tsconfig 读 baseUrl/paths；
//   - 注释屏蔽是字符串/正则感知的状态机（朴素正则剥注释会被字符串里的 /* 错配——见 proposal §2）。
//
// 用法:
//   node verify-edge-completeness.mjs <overview/package.json> [--root <dir>] [--tsconfig <path>]
//        [--label <name>] [--json <out.json>] [--md <out.md>]
//   node verify-edge-completeness.mjs --self-test     # 扫描器自身的成对负对照（注释/字符串两面）
// 退出码: 0 = 对账通过（internal 边无缺无溢、拆分母等式成立且与独立扫描一致；external 偏差单列归因）
//         1 = 有偏差（清单见报告）
//         2 = 未评估（读不懂输入 / 无 moduleGraph / 无源文件）
//
// pass/fail 的口径：阶段 2 的检查器只消费 internal 边，所以只看 internal；
// external（node_modules）边的偏差是【已归因】的（根因见 caveats.rootCause），不静默、也不 blocking。
//
// 范围: 仅 TypeScript。脚本是验证实验，不是阶段 2 检查器内核。

import fs from 'node:fs';
import path from 'node:path';

// 正则字面量的前导判定表（见 maskComments）。声明在最前：tsconfig 的 JSONC 解析在同一次
// 顶层执行里就要用到 maskComments。
const REGEX_PRECEDING_CHARS = '(,=:[!&|?{};+-*%<>~^';
const REGEX_PRECEDING_WORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'do',
  'else',
  'yield',
  'await',
  'case',
  'throw',
]);

// 扫描器的判定表。声明在最前：--self-test 是文件顶部的入口，会在这些 const 初始化之前
// 就调用 scanFile()，放后面会踩 TDZ。
// 括号配对表（解析 import/export 子句的深度）
const OPEN = { '{': '}', '(': ')', '[': ']' };
const CLOSE = new Set(['}', ')', ']']);
// 动态 import() 的位置判定表：类型位置 vs 值位置（见 classifyDynamicImport）
const TYPE_POSITION_TOKENS = new Set([
  ':',
  'as',
  'typeof',
  '<',
  '|',
  '&',
  'extends',
  'implements',
  'keyof',
  'infer',
  '>',
  'readonly',
  'unique',
]);
const VALUE_POSITION_TOKENS = new Set(['await', 'return', '=>', '(', '[', '{', ',', '=', ';']);

// ── CLI ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const takeFlag = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const rootOpt = takeFlag('--root');
const tsconfigOpt = takeFlag('--tsconfig');
const jsonOut = takeFlag('--json');
const mdOut = takeFlag('--md');
const label = takeFlag('--label') ?? path.basename(process.cwd());
const archPath = argv[0];

function finish(report, code) {
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2) + '\n');
  if (mdOut) fs.writeFileSync(mdOut, renderMarkdown(report));
  console.log(summaryText(report));
  process.exit(code);
}
function notEvaluated(reason) {
  finish({ status: 'not-evaluated', label, reason }, 2);
}

// ── 自检：位置扫描器的两面负对照 ────────────────────────────────────────────
// 一面：注释 / 字符串里的路径提及【不得】产生边。
// 另一面：字符串里的 `/*` 【不得】被当成块注释开头而吞掉真实代码（proposal §2 记录的 quay 事故）。
if (argv.includes('--self-test')) {
  const cases = [];
  const scan = (src) => {
    const { code, codeOnly } = maskSource(src);
    return scanFile(code, codeOnly);
  };

  // 1) 注释与字符串里的 import 一律不算
  const decoy = [
    "// import a from './a';",
    "/* export * from './b';",
    "   import c from './c'; */",
    'const s = "import(\'./d\')";',
    "const t = `export * from './e'`;",
    "import real from './real';",
  ].join('\n');
  const d = scan(decoy);
  cases.push({
    name: '注释/字符串里的 import 不产生边',
    ok:
      d.statements.length === 1 && d.statements[0].specifier === './real' && d.dynamic.length === 0,
    actual: { statements: d.statements.map((s) => s.specifier), dynamic: d.dynamic.length },
    expected: { statements: ['./real'], dynamic: 0 },
  });

  // 2) 字符串里的 `/*` 不得吞掉其后的真实代码
  const tricky = ['const re = "/* 不是注释";', "import after from './after';"].join('\n');
  const t = scan(tricky);
  cases.push({
    name: '字符串里的 /* 不吞掉后续真实代码',
    ok: t.statements.length === 1 && t.statements[0].specifier === './after',
    actual: { statements: t.statements.map((s) => s.specifier) },
    expected: { statements: ['./after'] },
  });

  // 3) 同一行的注释不得吞掉同一行的真实代码
  const trailing = "import x from './x'; // import y from './y'";
  const tr = scan(trailing);
  cases.push({
    name: '行尾注释里的 import 不算，同行的真 import 保留',
    ok: tr.statements.length === 1 && tr.statements[0].specifier === './x',
    actual: { statements: tr.statements.map((s) => s.specifier) },
    expected: { statements: ['./x'] },
  });

  // 4) type-only 判定：三种写法
  const kinds = [
    "import type { A } from './a';",
    "import { type B, type C } from './b';",
    "import { type D, E } from './d';",
    "import * as ns from './e';",
    "export * from './f';",
    "export { type G } from './g';",
    "export {} from './h';",
  ].join('\n');
  const k = scan(kinds);
  const want = [
    ['./a', true],
    ['./b', true],
    ['./d', false],
    ['./e', false],
    ['./f', false],
    ['./g', true],
    ['./h', false],
  ];
  const got = k.statements.map((s) => [s.specifier, s.typeOnly]);
  cases.push({
    name: 'type-only 判定（含 import type / 全 type 命名 / 混合 / export * / export {}）',
    ok: JSON.stringify(got) === JSON.stringify(want),
    actual: got,
    expected: want,
  });

  // 5) 动态 import 的位置分类
  const dyn = [
    'const a = await import("./r1");',
    'const b = await Promise.all([import("./r2"), import("./r3")]);',
    "type T = import('./t1').X;",
    '): Promise<import("./t2").Y> {',
  ].join('\n');
  const dy = scan(dyn);
  const dyGot = dy.dynamic.map((x) => [x.specifier, x.position]);
  const dyWant = [
    ['./r1', 'value'],
    ['./r2', 'value'],
    ['./r3', 'value'],
    ['./t1', 'type'],
    ['./t2', 'type'],
  ];
  cases.push({
    name: '动态 import() 的值/类型位置分类',
    ok: JSON.stringify(dyGot) === JSON.stringify(dyWant),
    actual: dyGot,
    expected: dyWant,
  });

  const failed = cases.filter((c) => !c.ok);
  console.log(`self-test: ${cases.length - failed.length}/${cases.length} passed`);
  for (const c of cases)
    console.log(
      `  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}` +
        (c.ok
          ? ''
          : `\n        got=${JSON.stringify(c.actual)}\n        want=${JSON.stringify(c.expected)}`)
    );
  process.exit(failed.length === 0 ? 0 : 1);
}

if (!archPath) notEvaluated('缺少参数: ArchJSON(package 层)路径');

let arch;
try {
  arch = JSON.parse(fs.readFileSync(archPath, 'utf8'));
} catch (e) {
  notEvaluated(`读取 ArchJSON 失败: ${e.message}`);
}
const mg = arch?.extensions?.tsAnalysis?.moduleGraph;
if (!mg || !Array.isArray(mg.edges) || !Array.isArray(mg.nodes)) {
  notEvaluated('输入缺少 extensions.tsAnalysis.moduleGraph（非 TS，或不是 package 层 JSON）');
}
const sourceFilesIn = arch.sourceFiles;
if (!Array.isArray(sourceFilesIn) || sourceFilesIn.length === 0) {
  notEvaluated('ArchJSON 缺 sourceFiles —— 无法在不读 moduleGraph 的前提下确定文件全集');
}

const root = path.resolve(rootOpt ?? arch.workspaceRoot ?? process.cwd());
const sourceFiles = sourceFilesIn.map((f) => (path.isAbsolute(f) ? f : path.resolve(root, f)));

// ── 文件 → module id（与 ModuleGraphBuilder 相同的定义：项目根相对目录）────────
const fileToModule = new Map();
for (const f of sourceFiles) {
  const rel = path.relative(root, f).split(path.sep).join('/');
  const dir = path.posix.dirname(rel);
  fileToModule.set(f, dir === '.' ? '' : dir);
}

// ── tsconfig: baseUrl / paths（自行从磁盘读，含 JSONC 注释）───────────────────
function findTsconfig(startDir) {
  let d = startDir;
  for (let i = 0; i < 12; i++) {
    const p = path.join(d, 'tsconfig.json');
    if (fs.existsSync(p)) return p;
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return null;
}

const tsconfigPath = tsconfigOpt ? path.resolve(tsconfigOpt) : findTsconfig(root);
let aliasConfig = null;
if (tsconfigPath && fs.existsSync(tsconfigPath)) {
  try {
    const cfg = parseJsonc(fs.readFileSync(tsconfigPath, 'utf8'));
    const co = cfg?.compilerOptions ?? {};
    if (co.paths || co.baseUrl) {
      aliasConfig = {
        baseUrl: path.resolve(path.dirname(tsconfigPath), co.baseUrl ?? '.'),
        paths: co.paths ?? {},
      };
    }
  } catch (e) {
    notEvaluated(`tsconfig 解析失败 (${tsconfigPath}): ${e.message}`);
  }
}

// ── 字符串/正则感知的注释屏蔽 ────────────────────────────────────────────────
// 注释内容被替换为空格（换行保留），字符串字面量与正则字面量原样保留（我们要读它们的文本）。
// 朴素正则剥注释会被字符串里的 `/*` 错配 —— 这里用状态机避免（proposal §2 的成对负对照）。
/**
 * 一次遍历产出两份文本（长度与原文一致，便于按位置回读）：
 *  - `code`    : 注释→空格，字符串原样（要读 specifier 文本）
 *  - `codeOnly`: 注释→空格，字符串内容也→空格（只保留定界符）—— 用于【定位】语句与 import()
 *                token。否则字符串里的 `import(` 会被当成真的动态 import（archguard 的
 *                `normalizeEntityName` 里 `name.startsWith('import(')` 就是这么被骗的）。
 */
function maskSource(src) {
  let out = '';
  let only = '';
  let i = 0;
  const n = src.length;
  let state = 'code';
  let lastSig = ''; // code 状态里最后一个非空白字符
  let word = ''; // code 状态里结尾的标识符
  const emitCode = (s) => {
    out += s;
    only += s;
    for (const ch of s) {
      if (!/\s/.test(ch)) lastSig = ch;
      if (/[A-Za-z0-9_$]/.test(ch)) word += ch;
      else word = '';
    }
  };

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    if (state === 'code') {
      if (c === '/' && c2 === '/') {
        out += '  ';
        only += '  ';
        i += 2;
        state = 'line';
        continue;
      }
      if (c === '/' && c2 === '*') {
        out += '  ';
        only += '  ';
        i += 2;
        state = 'block';
        continue;
      }
      if (
        c === '/' &&
        (lastSig === '' ||
          REGEX_PRECEDING_CHARS.includes(lastSig) ||
          REGEX_PRECEDING_WORDS.has(word))
      ) {
        // 正则字面量：走到未转义的 `/`（字符类内的 `/` 不算）
        let j = i + 1;
        let inClass = false;
        let esc = false;
        let closed = false;
        while (j < n) {
          const ch = src[j];
          if (esc) {
            esc = false;
            j++;
            continue;
          }
          if (ch === '\\') {
            esc = true;
            j++;
            continue;
          }
          if (ch === '\n') break;
          if (ch === '[') inClass = true;
          else if (ch === ']') inClass = false;
          else if (ch === '/' && !inClass) {
            j++;
            closed = true;
            break;
          }
          j++;
        }
        if (closed) {
          const seg = src.slice(i, j);
          out += seg;
          only += seg;
          lastSig = '/';
          word = '';
          i = j;
          continue;
        }
        // 未闭合 → 其实是除号，按普通字符处理
      }
      if (c === "'" || c === '"' || c === '`') {
        out += c;
        only += c;
        lastSig = c;
        word = '';
        state = c === "'" ? 'sq' : c === '"' ? 'dq' : 'tpl';
        i++;
        continue;
      }
      emitCode(c);
      i++;
      continue;
    }

    if (state === 'line') {
      const ch = c === '\n' ? c : ' ';
      out += ch;
      only += ch;
      state = c === '\n' ? 'code' : state;
      i++;
      continue;
    }

    if (state === 'block') {
      if (c === '*' && c2 === '/') {
        out += '  ';
        only += '  ';
        i += 2;
        state = 'code';
        continue;
      }
      const ch = c === '\n' ? '\n' : ' ';
      out += ch;
      only += ch;
      i++;
      continue;
    }

    // 字符串字面量（'  "  `）：code 原样保留内容，codeOnly 只保留定界符与换行
    const closer = state === 'sq' ? "'" : state === 'dq' ? '"' : '`';
    if (c === '\\') {
      const nx = src[i + 1] ?? '';
      out += c + nx;
      only += (c === '\n' ? '\n' : ' ') + (nx === '\n' ? '\n' : ' ');
      i += 2;
      continue;
    }
    out += c;
    only += c === '\n' ? '\n' : c === closer ? c : ' ';
    if (c === closer) state = 'code';
    i++;
  }
  return { code: out, codeOnly: only };
}

function maskComments(src) {
  return maskSource(src).code;
}

function parseJsonc(text) {
  const stripped = maskComments(text).replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(stripped);
}

// ── 行首 import/export … from 语句 ──────────────────────────────────────────

/** 从 `from` 处读一个字符串字面量，返回 { value, end } 或 null。 */
function readStringAt(code, i) {
  while (i < code.length && /\s/.test(code[i])) i++;
  const q = code[i];
  if (q !== "'" && q !== '"') return null;
  let j = i + 1;
  let val = '';
  while (j < code.length) {
    const ch = code[j];
    if (ch === '\\') {
      val += code[j + 1] ?? '';
      j += 2;
      continue;
    }
    if (ch === q) return { value: val, end: j + 1 };
    if (ch === '\n') return null;
    val += ch;
    j++;
  }
  return null;
}

/**
 * 解析一条以 `import`/`export` 开头的模块语句。
 * 返回 { kind, typeOnly, specifier, line, text } 或 null（如 `export const x = 1`）。
 */
function parseModuleStatement(code, pos, lineOf) {
  const kw = code.startsWith('import', pos) ? 'import' : 'export';
  let i = pos + kw.length;
  // 关键字后必须跟空白（避免 `imports` / `exports` 之类）
  if (i < code.length && /[A-Za-z0-9_$]/.test(code[i])) return null;

  const start = pos;
  let typeOnly = false;
  let depth = 0;
  let sawSideEffectString = null;

  // 可选的前置 `type` 关键字（`import type {…}` / `export type {…}` / `export type * from`）
  let j = i;
  while (j < code.length && /\s/.test(code[j])) j++;
  if (code.startsWith('type', j) && !/[A-Za-z0-9_$]/.test(code[j + 4] ?? '')) {
    const k = j + 4;
    if (k < code.length && /\s/.test(code[k])) {
      typeOnly = true;
      j = k;
    }
  }
  const clauseStart = j;
  i = j;

  let clauseEnd = -1;
  let specifier = null;
  let statementEnd = -1;

  while (i < code.length) {
    const c = code[i];
    if (depth === 0) {
      if (c === ';') {
        statementEnd = i + 1;
        break;
      }
      if (c === '\n') {
        statementEnd = i;
        break;
      }
      // 副作用 import：`import 'x'`
      if (kw === 'import' && (c === "'" || c === '"')) {
        const s = readStringAt(code, i);
        if (s) {
          sawSideEffectString = s.value;
          statementEnd = s.end;
        }
        break;
      }
      if (c === 'f' && code.startsWith('from', i) && !/[A-Za-z0-9_$]/.test(code[i + 4] ?? '')) {
        clauseEnd = i;
        const s = readStringAt(code, i + 4);
        if (s) {
          specifier = s.value;
          statementEnd = s.end;
        }
        break;
      }
    }
    if (c === '/' && code[i + 1] === '/') return null; // 不应出现（注释已屏蔽）
    if (OPEN[c]) depth++;
    else if (CLOSE.has(c)) depth--;
    i++;
  }

  if (statementEnd < 0) return null;
  const text = code
    .slice(start, statementEnd)
    .replace(/[ \t]+/g, ' ')
    .trim();

  if (sawSideEffectString !== null) {
    return {
      kind: 'import',
      typeOnly: false,
      specifier: sawSideEffectString,
      line: lineOf(start),
      text,
    };
  }
  if (specifier === null || clauseEnd < 0) return null;

  const clause = code.slice(clauseStart, clauseEnd);
  return {
    kind: kw,
    typeOnly: typeOnly || isAllTypeClause(clause),
    specifier,
    line: lineOf(start),
    text,
  };
}

/**
 * 命名子句是否整体 type-only（与 ModuleGraphBuilder.isTypeOnlyImport/Export 的规则一致）：
 * `{ type A, type B }` → 是；`{ type A, B }` → 否；`{}` / `* as ns` / `A, {…}` → 否。
 */
function isAllTypeClause(clause) {
  const t = clause.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return false;
  const body = t.slice(1, -1).replace(/\{[^}]*\}/g, '');
  const items = body
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) return false;
  return items.every((s) => /^type\s/.test(s));
}

// 动态 import() 出现的【位置】分类。
// 运行时 import() 是 CallExpression（值位置）；类型位置的 `import('x').T` 是 TSImportType。
// 两者现在都由 builder 产边（类型位置自 gap-ts-module-graph-misses-type-position-import-type 起），
// 但拆分不同：值位置 → value，类型位置 → type-only。因此仍要分类，分类结果同时决定 isTypeOnly。
// `await import(...)` 不足以判定：`await Promise.all([import(a), import(b)])` 里每个 import 的前导
// token 是 `[` / `,` 而不是 `await`（quay control-plane-http.ts 的真实写法）。

function classifyDynamicImport(code, idx) {
  const before = code.slice(0, idx);
  const lineStart = before.lastIndexOf('\n') + 1;
  const linePrefix = code.slice(lineStart, idx);
  // `type X = import('y').Z` / `declare …` —— 整行是类型声明
  if (/^\s*(export\s+)?(type|interface|declare)\b/.test(linePrefix)) return 'type';
  const tokMatch = /([A-Za-z_$][\w$]*|[^\s])\s*$/.exec(before);
  const tok = tokMatch ? tokMatch[1] : '';
  if (TYPE_POSITION_TOKENS.has(tok)) return 'type';
  if (VALUE_POSITION_TOKENS.has(tok)) return 'value';
  return 'unknown';
}

/**
 * 扫描一个源文件里所有模块语句 + 动态 import。
 * `code` 用于读取 specifier 文本；`codeOnly`（字符串内容已抹白）用于定位 token。
 */
function scanFile(code, codeOnly) {
  const starts = [];
  for (let i = 0; i < codeOnly.length; i++) {
    const atLineStart = i === 0 || codeOnly[i - 1] === '\n';
    if (!atLineStart) continue;
    let k = i;
    while (k < codeOnly.length && (codeOnly[k] === ' ' || codeOnly[k] === '\t')) k++;
    if (codeOnly.startsWith('import', k) || codeOnly.startsWith('export', k)) starts.push(k);
  }

  const lineOf = (pos) => code.slice(0, pos).split('\n').length;
  const statements = [];
  for (const pos of starts) {
    const st = parseModuleStatement(code, pos, lineOf);
    if (st) statements.push(st);
  }

  const dynamic = [];
  const DYN = /\bimport\s*\(/g;
  let m;
  while ((m = DYN.exec(codeOnly)) !== null) {
    let j = m.index + m[0].length;
    while (j < codeOnly.length && /\s/.test(codeOnly[j])) j++;
    // 位置取自 codeOnly，字面量文本回读自 code —— 两者偏移一致
    const lit = readStringAt(code, j);
    const rawEnd = lit ? lit.end : j;
    dynamic.push({
      line: lineOf(m.index),
      position: classifyDynamicImport(codeOnly, m.index),
      specifier: lit ? lit.value : null,
      text: codeOnly.slice(m.index, Math.min(codeOnly.length, rawEnd)).replace(/\s+/g, ' ').trim(),
    });
  }
  return { statements, dynamic };
}

// ── specifier → 目标 module（自行实现，规则对齐 builder）────────────────────
const JS_EXT = ['.js', '.jsx', '.mjs', '.cjs'];
const TS_EXT = ['.ts', '.tsx', '.d.ts'];

function expandCandidates(absPath) {
  const out = [absPath];
  for (const jsExt of JS_EXT) {
    if (absPath.endsWith(jsExt)) {
      const stem = absPath.slice(0, -jsExt.length);
      out.push(stem);
      for (const t of TS_EXT) out.push(stem + t);
    }
  }
  for (const t of TS_EXT) out.push(absPath + t);
  out.push(absPath + '/index.ts', absPath + '/index.tsx', absPath + '/index.d.ts');
  return [...new Set(out)];
}

function moduleForPath(absPath) {
  for (const c of expandCandidates(absPath)) {
    const mod = fileToModule.get(c);
    if (mod !== undefined) return mod;
  }
  return undefined;
}

function matchAliasTargets(specifier, paths) {
  const exact = paths[specifier];
  if (exact) return [...exact];
  for (const [pattern, mapped] of Object.entries(paths)) {
    const star = pattern.indexOf('*');
    if (star === -1) continue;
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
    if (specifier.length < prefix.length + suffix.length) continue;
    const mid = specifier.slice(prefix.length, specifier.length - suffix.length);
    return mapped.map((t) => t.replace('*', mid));
  }
  return [];
}

/** @returns {{kind:'internal',module:string}|{kind:'external',name:string}|{kind:'unresolved-alias'}|{kind:'skip'}} */
function resolveTarget(fromFileAbs, specifier) {
  if (specifier.startsWith('.')) {
    const base = path.resolve(path.dirname(fromFileAbs), specifier);
    const mod = moduleForPath(base);
    return mod !== undefined ? { kind: 'internal', module: mod } : { kind: 'skip' };
  }
  if (aliasConfig) {
    const targets = matchAliasTargets(specifier, aliasConfig.paths);
    if (targets.length > 0) {
      for (const t of targets) {
        const mod = moduleForPath(path.resolve(aliasConfig.baseUrl, t));
        if (mod !== undefined) return { kind: 'internal', module: mod };
      }
      return { kind: 'unresolved-alias' };
    }
  }
  const name = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
  return { kind: 'external', name };
}

// ── 独立扫描 → 边表 ────────────────────────────────────────────────────────
const indep = new Map(); // `${from}|||${to}` -> {from,to,kind,strength,typeOnly,value,evidence:[]}
const unresolvedAlias = [];
const skippedRelative = [];
const selfStatements = [];
const typePositionImports = [];
const unknownDynamic = [];
const nonLiteralDynamic = [];
let filesRead = 0;
let filesMissing = 0;

const addEdge = (from, to, kind, isTypeOnly, ev) => {
  const key = `${from}|||${to}`;
  let e = indep.get(key);
  if (!e) {
    e = { from, to, kind, strength: 0, typeOnly: 0, value: 0, evidence: [] };
    indep.set(key, e);
  }
  e.strength += 1;
  if (isTypeOnly) e.typeOnly += 1;
  else e.value += 1;
  if (e.evidence.length < 5) e.evidence.push(ev);
};

for (const f of sourceFiles) {
  let text;
  try {
    text = fs.readFileSync(f, 'utf8');
  } catch {
    filesMissing++;
    continue;
  }
  filesRead++;
  const { code, codeOnly } = maskSource(text);
  const fromModule = fileToModule.get(f);
  const { statements, dynamic } = scanFile(code, codeOnly);
  const relFile = path.relative(root, f).split(path.sep).join('/');

  for (const st of statements) {
    const r = resolveTarget(f, st.specifier);
    const ev = {
      file: relFile,
      line: st.line,
      specifier: st.specifier,
      typeOnly: st.typeOnly,
      text: st.text,
    };
    if (r.kind === 'skip') {
      skippedRelative.push(ev);
      continue;
    }
    if (r.kind === 'unresolved-alias') {
      unresolvedAlias.push(ev);
      continue;
    }
    const to = r.kind === 'internal' ? r.module : r.name;
    if (to === fromModule) {
      selfStatements.push({ ...ev, module: to });
      continue;
    }
    addEdge(fromModule, to, r.kind, st.typeOnly, ev);
  }

  for (const d of dynamic) {
    const ev = {
      file: relFile,
      line: d.line,
      specifier: d.specifier,
      text: d.text,
      position: d.position,
    };
    // 类型位置的 import('...')（TSImportType）是编译期擦除的类型引用，等价于一条
    // type-only 边：builder 自 gap-ts-module-graph-misses-type-position-import-type 起
    // 也为它产边，因此独立扫描同样把它计入边表（isTypeOnly=true）。单独再收集一份到
    // typePositionImports，供下面的残余影响诊断用。
    const isTypePosition = d.position === 'type';
    if (isTypePosition) typePositionImports.push(ev);
    if (d.position === 'unknown') {
      unknownDynamic.push(ev);
      continue;
    }
    if (d.specifier === null) {
      // 非字面量类型位置 import() 与运行时一样不可静态求值：不产边，也不计入未求值动态 import。
      if (!isTypePosition) nonLiteralDynamic.push(ev);
      continue;
    }
    const r = resolveTarget(f, d.specifier);
    if (r.kind === 'skip') {
      skippedRelative.push(ev);
      continue;
    }
    if (r.kind === 'unresolved-alias') {
      unresolvedAlias.push(ev);
      continue;
    }
    const to = r.kind === 'internal' ? r.module : r.name;
    if (to === fromModule) {
      selfStatements.push({ ...ev, module: to });
      continue;
    }
    addEdge(fromModule, to, r.kind, isTypePosition, ev);
  }
}

// ── moduleGraph 边表 ───────────────────────────────────────────────────────
const internalNodes = new Set(mg.nodes.filter((n) => n.type === 'internal').map((n) => n.id));
const built = new Map();
for (const e of mg.edges) {
  built.set(`${e.from}|||${e.to}`, {
    from: e.from,
    to: e.to,
    kind: internalNodes.has(e.to) ? 'internal' : 'external',
    strength: e.strength,
    typeOnly: e.typeOnlyStrength,
    value: e.valueStrength,
  });
}

// ── 对账 ───────────────────────────────────────────────────────────────────
const missedInternal = [];
const missedExternal = [];
const extraInternal = [];
const extraExternal = [];
const strengthMismatch = [];
const splitMismatch = [];
const splitInvariantViolations = [];
const splitMissing = [];

for (const [key, e] of indep.entries()) {
  const b = built.get(key);
  if (!b) {
    (e.kind === 'internal' ? missedInternal : missedExternal).push({
      edge: `${e.from} -> ${e.to}`,
      from: e.from,
      to: e.to,
      strength: e.strength,
      typeOnly: e.typeOnly,
      value: e.value,
      evidence: e.evidence,
    });
    continue;
  }
  if (b.strength !== e.strength) {
    strengthMismatch.push({
      edge: `${e.from} -> ${e.to}`,
      kind: e.kind,
      built: b.strength,
      independent: e.strength,
      builtSplit: { typeOnly: b.typeOnly, value: b.value },
      independentSplit: { typeOnly: e.typeOnly, value: e.value },
      evidence: e.evidence,
    });
  }
  if (b.typeOnly === undefined || b.value === undefined) {
    splitMissing.push({ edge: `${e.from} -> ${e.to}`, strength: b.strength });
  } else if (b.typeOnly !== e.typeOnly || b.value !== e.value) {
    splitMismatch.push({
      edge: `${e.from} -> ${e.to}`,
      kind: e.kind,
      built: { typeOnly: b.typeOnly, value: b.value },
      independent: { typeOnly: e.typeOnly, value: e.value },
      evidence: e.evidence,
    });
  }
}

for (const [key, b] of built.entries()) {
  if (indep.has(key)) {
    if (b.typeOnly !== undefined && b.value !== undefined && b.strength !== b.typeOnly + b.value) {
      splitInvariantViolations.push({
        edge: `${b.from} -> ${b.to}`,
        strength: b.strength,
        typeOnly: b.typeOnly,
        value: b.value,
      });
    }
    continue;
  }
  (b.kind === 'internal' ? extraInternal : extraExternal).push({
    edge: `${b.from} -> ${b.to}`,
    from: b.from,
    to: b.to,
    strength: b.strength,
    typeOnly: b.typeOnly,
    value: b.value,
  });
}

// 类型位置 import() 的【残余】影响：独立扫描现在已把它计入边表，所以这两个清单描述的是
// 「修复后仍存在的问题」——
//   edgeAbsent      : 独立扫描有这条 type-only 依赖，moduleGraph 里却整条边都没有；
//   edgeUnderCounted: 边在，但 moduleGraph 的 strength 少于独立扫描（这条 type-only 贡献没被计入）。
// 修复前 archguard 自身为 edgeAbsent=3 / edgeUnderCounted=9；修复后两者都应归零。
const typePositionImpact = { resolvedInternal: 0, edgeAbsent: [], edgeUnderCounted: [] };
for (const t of typePositionImports) {
  const r = resolveTarget(path.resolve(root, t.file), t.specifier ?? '');
  if (r.kind !== 'internal') continue;
  typePositionImpact.resolvedInternal += 1;
  const from = fileToModule.get(path.resolve(root, t.file));
  if (from === r.module) continue;
  const key = `${from}|||${r.module}`;
  const b = built.get(key);
  if (!b) {
    typePositionImpact.edgeAbsent.push({
      edge: `${from} -> ${r.module}`,
      file: t.file,
      line: t.line,
      specifier: t.specifier,
    });
    continue;
  }
  const e = indep.get(key);
  if (e && b.strength < e.strength) {
    typePositionImpact.edgeUnderCounted.push({
      edge: `${from} -> ${r.module}`,
      file: t.file,
      line: t.line,
      specifier: t.specifier,
      builtStrength: b.strength,
      independentStrength: e.strength,
    });
  }
}

// 内建 unresolved / unevaluatedDynamicImports 与独立扫描的对照
const builtUnresolved = (mg.unresolved ?? []).map((u) => `${u.from} -> ${u.specifier}`).sort();
const indepUnresolved = unresolvedAlias
  .map((u) => `${fileToModule.get(path.resolve(root, u.file)) ?? '?'} -> ${u.specifier}`)
  .sort();
const unevalBuilt = mg.unevaluatedDynamicImports ?? 0;
const unevalIndep = nonLiteralDynamic.length;

const internalEdgeCount = [...built.values()].filter((e) => e.kind === 'internal').length;
// 判定的口径：阶段 2 的层间检查只消费 **internal** 边，所以 pass/fail 只看 internal 边与拆分不变式。
// external（node_modules）边的偏差单列为 caveat —— 它们是"已归因偏差"（AC 明确允许），但绝不静默：
// 根因是 builder 的 resolveTarget 在 ts-morph 把裸包名解析进 node_modules 时返回 skip（见下）。
const internalProblems = {
  missedInternal: missedInternal.length,
  extraInternal: extraInternal.length,
  strengthMismatch: strengthMismatch.filter((m) => m.kind === 'internal').length,
  splitMismatch: splitMismatch.filter((m) => m.kind === 'internal').length,
};
const status =
  Object.values(internalProblems).every((n) => n === 0) &&
  splitInvariantViolations.length === 0 &&
  splitMissing.length === 0 &&
  unknownDynamic.length === 0
    ? 'pass'
    : 'fail';
const caveats = {
  externalMissedEdges: missedExternal.length,
  externalExtraEdges: extraExternal.length,
  externalStrengthMismatch: strengthMismatch.filter((m) => m.kind === 'external').length,
  externalSplitMismatch: splitMismatch.filter((m) => m.kind === 'external').length,
  externalTargets: [...new Set(missedExternal.map((m) => m.to))].sort(),
  rootCause:
    'ModuleGraphBuilder.resolveTarget 先看 ts-morph 的 getModuleSpecifierSourceFile()：裸包名若能解析到 node_modules 里的文件，' +
    '该文件不在 fileToModule → 返回 skip（不产边）；解析不到才落到 external 分支。于是同一个包在不同目录下' +
    '「有边 / 无边」取决于 ts-morph 是否解析得到它（类型声明是否存在/可见），external 边集合因此既不稳定也不完整。' +
    '动态 import() 不走 ts-morph 解析，一律落到 external —— 所以只有被 await import 过的包才一定出现在图里。',
  phase2Impact:
    '阶段 2 的层间检查只用 internal 边，external 边不进层映射（check-layers.mjs 只把 externalEdgesIgnored 计入覆盖缺口数字），' +
    '因此不阻塞阶段 2；但覆盖缺口里的「外部依赖边数」会偏小，且依赖 external 节点的图（如 package 层 node_modules 展示）不完整。',
};

const report = {
  status,
  label,
  generatedFrom: {
    arch: path.resolve(archPath),
    timestamp: arch.timestamp,
    root,
    tsconfig: tsconfigPath,
    aliases: aliasConfig ? Object.keys(aliasConfig.paths).length : 0,
  },
  inputs: {
    sourceFiles: sourceFiles.length,
    filesRead,
    filesMissing,
    internalModules: internalNodes.size,
    internalEdges: internalEdgeCount,
  },
  scanTotals: {
    independentEdges: indep.size,
    unresolvedAlias: unresolvedAlias.length,
    skippedRelative: skippedRelative.length,
    selfStatements: selfStatements.length,
    typePositionImports: typePositionImports.length,
    unknownDynamic: unknownDynamic.length,
    nonLiteralDynamic: nonLiteralDynamic.length,
  },
  // pass/fail 的口径：只看 internal 边与拆分不变式（阶段 2 的检查器只消费 internal 边）
  internalProblems,
  caveats,
  results: {
    missedInternal,
    extraInternal,
    missedExternal,
    extraExternal,
    strengthMismatch,
    splitMismatch,
    splitMissing,
    splitInvariantViolations,
  },
  attribution: {
    typePositionImports: {
      count: typePositionImports.length,
      note:
        "TSImportType（类型位置的 import('...')）—— 编译期擦除的类型引用，等价于一条 type-only 边。" +
        'builder 自 gap-ts-module-graph-misses-type-position-import-type 起为它产边，独立扫描同样计入边表。' +
        '此处为原始出现次数（含自指/非字面量）。样例见 samples。',
      samples: typePositionImports.slice(0, 10),
    },
    typePositionImpact: {
      note:
        '类型位置 import() 的残余影响（独立扫描已计入边表后仍存在的问题）：edgeAbsent = 独立扫描有该 type-only ' +
        '依赖但 moduleGraph 整条边缺失；edgeUnderCounted = 边在但 strength 少计（该 type-only 贡献没被计入）。' +
        '修复前 archguard 自身 3 / 9，修复后两者应归零。',
      resolvedInternal: typePositionImpact.resolvedInternal,
      edgeAbsent: typePositionImpact.edgeAbsent,
      edgeUnderCounted: typePositionImpact.edgeUnderCounted,
    },
    unknownDynamicImports: {
      count: unknownDynamic.length,
      note: '前导 token 既非类型位置也非值位置，无法自动归位 —— 必须人工判读，非空则本次对账不算通过。',
      samples: unknownDynamic.slice(0, 10),
    },
    unresolvedAlias: {
      built: builtUnresolved,
      independent: indepUnresolved,
      agree: JSON.stringify(builtUnresolved) === JSON.stringify(indepUnresolved),
    },
    unevaluatedDynamicImports: {
      built: unevalBuilt,
      independent: unevalIndep,
      agree: unevalBuilt === unevalIndep,
    },
    skippedRelative: { count: skippedRelative.length, samples: skippedRelative.slice(0, 5) },
    selfStatements: { count: selfStatements.length, samples: selfStatements.slice(0, 5) },
  },
};

finish(report, status === 'pass' ? 0 : 1);

// ── 输出 ───────────────────────────────────────────────────────────────────
function summaryText(r) {
  if (r.status === 'not-evaluated') return `NOT-EVALUATED [${r.label}]: ${r.reason}`;
  const R = r.results;
  const L = [];
  L.push(
    `[${r.label}] status=${r.status} 独立扫描 ${r.inputs.filesRead} 文件 / ${r.scanTotals.independentEdges} 边（internal ${r.inputs.internalEdges} 内建）`
  );
  L.push(
    `  (a) 漏边 internal=${R.missedInternal.length} external=${R.missedExternal.length}；多报 internal=${R.extraInternal.length} external=${R.extraExternal.length}` +
      (r.caveats.externalMissedEdges || r.caveats.externalExtraEdges
        ? `  [external 偏差已归因，目标: ${r.caveats.externalTargets.join(', ')}]`
        : '')
  );
  L.push(
    `  (b) strength 不符=${R.strengthMismatch.length}；拆分母等式违例=${R.splitInvariantViolations.length}；拆分缺字段=${R.splitMissing.length}；type-only 判定不符=${R.splitMismatch.length}`
  );
  L.push(
    `  归因: 类型位置 import()=${r.attribution.typePositionImports.count}（残余：整条边缺失 ${r.attribution.typePositionImpact.edgeAbsent.length}、少计 ${r.attribution.typePositionImpact.edgeUnderCounted.length}） 无法归位 import()=${r.attribution.unknownDynamicImports.count} 未解析别名 built=${r.attribution.unresolvedAlias.built.length}/indep=${r.attribution.unresolvedAlias.independent.length} 动态 import 未求值 built=${r.attribution.unevaluatedDynamicImports.built}/indep=${r.attribution.unevaluatedDynamicImports.independent}`
  );
  for (const m of R.missedInternal)
    L.push(
      `    [漏] ${m.edge}  strength=${m.strength}  e.g. ${m.evidence[0]?.file}:${m.evidence[0]?.line} ${m.evidence[0]?.specifier}`
    );
  for (const m of R.extraInternal) L.push(`    [溢] ${m.edge}  strength=${m.strength}`);
  for (const m of R.splitMismatch)
    L.push(
      `    [拆] ${m.edge}  built=${JSON.stringify(m.built)} indep=${JSON.stringify(m.independent)}`
    );
  for (const m of R.strengthMismatch)
    L.push(`    [强] ${m.edge}  built=${m.built} indep=${m.independent}`);
  return L.join('\n');
}

function renderMarkdown(r) {
  if (r.status === 'not-evaluated') return `# 边完整性对账：未评估\n\n${r.reason}\n`;
  const R = r.results;
  const rows = (arr, cols) =>
    arr.length === 0
      ? '（无）'
      : '| ' +
        cols.join(' | ') +
        ' |\n|' +
        cols.map(() => '---').join('|') +
        '|\n' +
        arr
          .map(
            (x) =>
              '| ' +
              cols.map((c) => String(c.split('.').reduce((o, k) => o?.[k], x) ?? '')).join(' | ') +
              ' |'
          )
          .join('\n') +
        '\n';
  return `# moduleGraph 边集合完整性 / type-only 拆分 独立对账 — ${r.label}

- 输入: \`${r.generatedFrom.arch}\`（workspaceRoot \`${r.generatedFrom.root}\`，tsconfig \`${r.generatedFrom.tsconfig ?? '—'}\`，别名规则 ${r.generatedFrom.aliases} 条）
- 数据时间戳: ${r.generatedFrom.timestamp ?? '—'}
- 独立扫描: ${r.inputs.filesRead} 个文件（缺 ${r.inputs.filesMissing}），${r.scanTotals.independentEdges} 条独立边；内建 internal 模块 ${r.inputs.internalModules}，internal 边 ${r.inputs.internalEdges}
- 判定: **${r.status}**

## (a) 漏边 / 多报边

内建漏边（独立扫描有、moduleGraph 无）— internal ${R.missedInternal.length} / external ${R.missedExternal.length}
${rows(R.missedInternal, ['edge', 'strength', 'typeOnly', 'value'])}
内建多报边（moduleGraph 有、独立扫描无）— internal ${R.extraInternal.length} / external ${R.extraExternal.length}
${rows(R.extraInternal, ['edge', 'strength'])}
${rows(R.extraExternal, ['edge', 'strength'])}

## (b) 拆分一致性

- \`strength === typeOnlyStrength + valueStrength\` 违例: ${R.splitInvariantViolations.length}
- 缺拆分子字段的边: ${R.splitMissing.length}
- strength 与独立扫描不符: ${R.strengthMismatch.length}
- type-only/值 判定与独立扫描不符: ${R.splitMismatch.length}

${rows(R.splitMismatch, ['edge', 'built.typeOnly', 'built.value', 'independent.typeOnly', 'independent.value'])}

## 归因（独立扫描可见但 builder 结构性不产边的部分）

- 类型位置 \`import('...')\`（TSImportType，已是独立扫描的 type-only 边）: ${r.attribution.typePositionImports.count}
${r.attribution.typePositionImports.samples.map((s) => `    - ${s.file}:${s.line} \`${s.specifier}\``).join('\n')}
  （上面只列前 ${r.attribution.typePositionImports.samples.length} 条，全量见 --json 产物）
- 残余：独立扫描有该 type-only 依赖，但 moduleGraph **整条边不存在**的: ${r.attribution.typePositionImpact.edgeAbsent.length}
${r.attribution.typePositionImpact.edgeAbsent.map((s) => `    - ${s.edge}  (${s.file}:${s.line})`).join('\n')}
- 残余：边在但 strength **少计**的: ${r.attribution.typePositionImpact.edgeUnderCounted.length}
${r.attribution.typePositionImpact.edgeUnderCounted.map((s) => `    - ${s.edge}  built=${s.builtStrength} indep=${s.independentStrength}  (${s.file}:${s.line})`).join('\n')}
- 无法自动归位的 \`import('...')\`: ${r.attribution.unknownDynamicImports.count}
${r.attribution.unknownDynamicImports.samples.map((s) => `    - ${s.file}:${s.line} \`${s.specifier}\``).join('\n')}
- 未解析别名边: built ${r.attribution.unresolvedAlias.built.length} / indep ${r.attribution.unresolvedAlias.independent.length}（一致: ${r.attribution.unresolvedAlias.agree}）
- 动态 import() 非字面量（未求值）: built ${r.attribution.unevaluatedDynamicImports.built} / indep ${r.attribution.unevaluatedDynamicImports.independent}（一致: ${r.attribution.unevaluatedDynamicImports.agree}）
- 解析不到项目内文件的相对导入（两边都不产边）: ${r.attribution.skippedRelative.count}
- 同目录自指语句（两边都不产边）: ${r.attribution.selfStatements.count}
`;
}
