/**
 * Stage 68.3 — C 类任务 GT 自动计算
 *
 * C 类任务：答案在粗层级存在，但 LLM 无法可靠抽取（present-but-overcompressed）。
 * 答案在 L2（class Mermaid）层级存在，但需要 method 粒度（L3+）才能确定具体答案。
 *
 * 三种查询函数（plan §Stage 68.3 预注册）：
 *   C1: 过压缩拓扑推断 — ClassA 与 ClassB 之间，具体是哪些方法在调用？
 *   C2: 细粒度计数 — ClassX 中，被外部类调用次数最多的方法是哪个？
 *   C3: 条件可达性 — MethodA 的调用方中，有哪些本身也被 MethodB 直接调用？
 *
 * Usage: npx tsx gt-c-class.ts [--out tasks/c-class-tasks.json]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CALLGRAPH_PATH = path.join(__dirname, 'artifacts/gt/callgraph.json');
const ARCHJSON_PATH = path.join(__dirname, '../../.archguard/output/class/all-classes.json');
const OUT_DEFAULT = path.join(__dirname, 'tasks/c-class-tasks.json');
const GT_OUT_DEFAULT = path.join(__dirname, 'artifacts/gt/c-class-gt.json');

interface CallEdge {
  source: string; // 'file#ClassName.methodName'
  target: string;
  viaInterface: boolean;
  kind: 'call' | 'reference';
}

interface Task {
  id: string;
  taskClass: 'C';
  taskType: string;
  prompt: string;
  answerType: 'exact' | 'set';
  answer: string | string[];
  derivability: { L0: boolean; L1: boolean; L2: 'partial'; L3: boolean; L4: boolean; L5: boolean };
  h0Prediction: 'L2'; // C class H0: L2 (partial = coarsest "information present" level)
  humanVerification?: string; // notes from human check
}

function loadCallgraph(): CallEdge[] {
  const cg = JSON.parse(fs.readFileSync(CALLGRAPH_PATH, 'utf-8'));
  return cg.edges.filter((e: any) => e.kind === 'call') as CallEdge[];
}

function parseMethodId(id: string): { file: string; className: string; methodName: string } {
  const [file, qualName] = id.split('#');
  const dotIdx = qualName.lastIndexOf('.');
  return {
    file,
    className: qualName.substring(0, dotIdx),
    methodName: qualName.substring(dotIdx + 1),
  };
}

// C1: Find concrete call edges between two classes
function findConcreteCallEdgesBetweenClasses(
  edges: CallEdge[],
  fromClass: string,
  toClass: string
): string[] {
  return edges
    .filter((e) => {
      const src = parseMethodId(e.source);
      const tgt = parseMethodId(e.target);
      return src.className === fromClass && tgt.className === toClass;
    })
    .map((e) => {
      const src = parseMethodId(e.source);
      return `${src.className}.${src.methodName}`;
    })
    .filter((v, i, arr) => arr.indexOf(v) === i); // dedup
}

// C2: Find most-called-by-external method in a class
function findMostCalledExternalMethod(
  edges: CallEdge[],
  targetClass: string
): { method: string; count: number } | null {
  const counts: Record<string, number> = {};
  for (const e of edges) {
    const tgt = parseMethodId(e.target);
    const src = parseMethodId(e.source);
    if (tgt.className === targetClass && src.className !== targetClass) {
      const key = `${tgt.className}.${tgt.methodName}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return { method: entries[0][0], count: entries[0][1] };
}

// C3: Find callers of methodA that are also directly called by methodB
function findSharedCallers(
  edges: CallEdge[],
  methodA: string, // 'ClassName.methodName'
  methodB: string
): string[] {
  // callers of methodA
  const callersOfA = new Set(
    edges
      .filter((e) => {
        const tgt = parseMethodId(e.target);
        return `${tgt.className}.${tgt.methodName}` === methodA;
      })
      .map((e) => {
        const src = parseMethodId(e.source);
        return `${src.className}.${src.methodName}`;
      })
  );

  // targets called by methodB
  const targetsOfB = new Set(
    edges
      .filter((e) => {
        const src = parseMethodId(e.source);
        return `${src.className}.${src.methodName}` === methodB;
      })
      .map((e) => {
        const tgt = parseMethodId(e.target);
        return `${tgt.className}.${tgt.methodName}`;
      })
  );

  return [...callersOfA].filter((c) => targetsOfB.has(c)).sort();
}

const PARTIAL_DERIVABILITY = {
  L0: false,
  L1: false,
  L2: 'partial' as const,
  L3: true,
  L4: true,
  L5: true,
};

async function main() {
  const outPath = process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : OUT_DEFAULT;
  const gtOutPath = process.argv.includes('--gt-out')
    ? process.argv[process.argv.indexOf('--gt-out') + 1]
    : GT_OUT_DEFAULT;

  const edges = loadCallgraph();
  console.log(`Loaded ${edges.length} call edges`);

  const tasks: Task[] = [];
  const gtData: Record<string, unknown> = {};

  // ===== C1 type: Concrete call edges between two classes =====
  // These class pairs have entity-level relations in L2 but method details only in L3
  const c1Pairs: Array<[string, string, string]> = [
    ['MermaidDiagramGenerator', 'ValidatedMermaidGenerator', 'c1-mermaid-to-validated'],
    ['MermaidDiagramGenerator', 'MermaidValidationPipeline', 'c1-mermaid-to-pipeline'],
    ['MermaidDiagramGenerator', 'IsomorphicMermaidRenderer', 'c1-mermaid-to-renderer'],
    ['MermaidDiagramGenerator', 'MermaidAutoRepair', 'c1-mermaid-to-repair'],
    ['MermaidDiagramGenerator', 'HeuristicGrouper', 'c1-mermaid-to-grouper'],
    ['MermaidValidationPipeline', 'MermaidParseValidator', 'c1-pipeline-to-validator'],
    ['MermaidValidationPipeline', 'StructuralValidator', 'c1-pipeline-to-structural'],
    ['MermaidValidationPipeline', 'RenderValidator', 'c1-pipeline-to-render'],
    ['MermaidValidationPipeline', 'QualityValidator', 'c1-pipeline-to-quality'],
    ['MermaidAutoRepair', 'MermaidParseValidator', 'c1-autorepair-to-validator'],
    ['ValidatedMermaidGenerator', 'CommentGenerator', 'c1-generator-to-comment'],
    ['ParallelParser', 'TypeScriptParser', 'c1-parallel-to-ts'],
    ['TypeScriptParser', 'RelationExtractor', 'c1-ts-to-relation'],
    ['TypeScriptParser', 'InterfaceExtractor', 'c1-ts-to-interface'],
    ['TypeScriptParser', 'EnumExtractor', 'c1-ts-to-enum'],
    ['TypeScriptParser', 'FunctionExtractor', 'c1-ts-to-function'],
  ];

  for (const [fromClass, toClass, id] of c1Pairs) {
    const callers = findConcreteCallEdgesBetweenClasses(edges, fromClass, toClass);
    if (callers.length === 0) continue;
    gtData[id] = { fromClass, toClass, callers };
    tasks.push({
      id,
      taskClass: 'C',
      taskType: 'concrete-call-edges',
      prompt:
        `Based only on the representation above: which specific methods of class \`${fromClass}\` ` +
        `directly call methods of class \`${toClass}\`? ` +
        `Respond with JSON only: {"answer": ["ClassName.methodName", ...]}. Empty array if none.`,
      answerType: 'set',
      answer: callers,
      derivability: PARTIAL_DERIVABILITY,
      h0Prediction: 'L2',
      humanVerification:
        `L2 shows ${fromClass}→${toClass} relation exists, but method names only visible in L3+.`,
    });
  }

  // ===== C2 type: Most externally-called method in a class =====
  const c2Classes = [
    'ValidatedMermaidGenerator',
    'MermaidDiagramGenerator',
    'ParallelParser',
    'TypeScriptParser',
    'RelationExtractor',
    'MetricsCalculator',
    'MermaidValidationPipeline',
    'MermaidParseValidator',
  ];

  for (const cls of c2Classes) {
    const result = findMostCalledExternalMethod(edges, cls);
    if (!result || result.count < 2) continue;
    const id = `c2-most-called-${cls.toLowerCase().replace(/([A-Z])/g, '-$1').slice(1)}`;
    gtData[id] = { targetClass: cls, mostCalled: result.method, externalCallCount: result.count };
    tasks.push({
      id,
      taskClass: 'C',
      taskType: 'most-called-external-method',
      prompt:
        `Based only on the representation above: which method of class \`${cls}\` is called most ` +
        `frequently by OTHER classes (external callers only)? ` +
        `Respond with JSON only: {"answer": "ClassName.methodName"}.`,
      answerType: 'exact',
      answer: result.method,
      derivability: PARTIAL_DERIVABILITY,
      h0Prediction: 'L2',
      humanVerification:
        `L2 shows ${cls} exists with external dependencies, but method-level call counts require L3+.`,
    });
  }

  // ===== C3 type: Shared callers (intersection of caller sets) =====
  // Pick meaningful method pairs from the callgraph
  const c3Pairs: Array<[string, string, string]> = [
    ['ValidatedMermaidGenerator.generate', 'ValidatedMermaidGenerator.generatePackageLevel', 'c3-generate-shared'],
    ['ValidatedMermaidGenerator.generateClassLevel', 'ValidatedMermaidGenerator.generate', 'c3-class-level-shared'],
    ['MermaidAutoRepair.repair', 'MermaidAutoRepair.addDiagramDeclaration', 'c3-repair-shared'],
    ['ParallelParser.parse', 'TypeScriptParser.parseFile', 'c3-parser-shared'],
  ];

  for (const [methodA, methodB, id] of c3Pairs) {
    const shared = findSharedCallers(edges, methodA, methodB);
    // Only include tasks where the intersection is non-empty and interesting
    if (shared.length === 0) continue;
    gtData[id] = { methodA, methodB, sharedCallers: shared };
    tasks.push({
      id,
      taskClass: 'C',
      taskType: 'shared-callers',
      prompt:
        `Based only on the representation above: which methods are both (a) direct callers of ` +
        `\`${methodA}\` AND (b) directly called by \`${methodB}\`? ` +
        `Respond with JSON only: {"answer": ["ClassName.methodName", ...]}. Empty array if none.`,
      answerType: 'set',
      answer: shared,
      derivability: PARTIAL_DERIVABILITY,
      h0Prediction: 'L2',
      humanVerification:
        `L2 shows the classes involved, but the specific method-level intersection requires L3+ call graph.`,
    });
  }

  // Print summary
  console.log(`\nC-class tasks generated: ${tasks.length}`);
  const byType: Record<string, number> = {};
  for (const t of tasks) {
    byType[t.taskType] = (byType[t.taskType] ?? 0) + 1;
  }
  console.log('By type:', byType);
  for (const t of tasks) {
    const ans = Array.isArray(t.answer) ? `[${(t.answer as string[]).length} items]` : `"${t.answer}"`;
    console.log(`  ${t.id}: ${ans}`);
  }

  if (tasks.length < 15) {
    console.warn(`\nWARNING: Only ${tasks.length} C-class tasks generated (target ≥15).`);
    console.warn('This may be due to the ArchGuard scope. A larger or private codebase may yield more.');
  }

  // Write outputs
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.mkdirSync(path.dirname(gtOutPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(tasks, null, 2), 'utf-8');
  fs.writeFileSync(gtOutPath, JSON.stringify(gtData, null, 2), 'utf-8');
  console.log(`\nWritten: ${outPath} (${tasks.length} tasks)`);
  console.log(`Written: ${gtOutPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
