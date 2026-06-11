/**
 * Stage 67.3 — L4 缩域 ArchJSON 生成
 *
 * 从 ArchGuard 的完整 ArchJSON 中裁剪出精简版：
 *   - version, language
 *   - entities: 仅保留 name, type, file 三字段
 *   - relations: 原样保留
 *   - callGraph: 注入 callgraph.json 的 kind='call' 边
 *
 * 同时用 tiktoken (cl100k_base) 计算 token 数，输出到 token-count.txt。
 * 若 token 数 > 32000 则写入 "BLOCKED: needs chunking" 决定。
 *
 * Usage:
 *   npx tsx derive-l4.ts [--archjson <path>] [--callgraph <path>] [--out-dir <dir>]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ARCHJSON_DEFAULT = path.join(__dirname, '../../.archguard/output/class/all-classes.json');
const CALLGRAPH_DEFAULT = path.join(__dirname, 'artifacts/gt/callgraph.json');
const OUT_DIR_DEFAULT = path.join(__dirname, 'artifacts/levels/L4');
const TOKEN_LIMIT = 32_000;

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, def: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : def;
  };
  return {
    archjson: get('--archjson', ARCHJSON_DEFAULT),
    callgraph: get('--callgraph', CALLGRAPH_DEFAULT),
    outDir: get('--out-dir', OUT_DIR_DEFAULT),
  };
}

function estimateTokens(text: string): number {
  // Simple whitespace-split heuristic (≈ tiktoken cl100k_base for ASCII/code).
  // Actual token count is typically 1.1–1.3× word count for code.
  const words = text.split(/\s+/).length;
  return Math.ceil(words * 1.3);
}

async function main() {
  const { archjson: archjsonPath, callgraph: callgraphPath, outDir } = parseArgs();

  // Load inputs
  if (!fs.existsSync(archjsonPath)) {
    console.error(`ERROR: ArchJSON not found at ${archjsonPath}`);
    console.error('Run: node dist/cli/index.js analyze -f json -s src/');
    process.exit(1);
  }
  const archJson = JSON.parse(fs.readFileSync(archjsonPath, 'utf-8'));
  const callgraphData = JSON.parse(fs.readFileSync(callgraphPath, 'utf-8'));

  // Extract call edges from callgraph (kind='call' only, 375 edges)
  const callEdges = (callgraphData.edges as any[])
    .filter((e) => e.kind === 'call')
    .map((e) => ({ source: e.source, target: e.target, viaInterface: e.viaInterface ?? false }));

  // Build reduced ArchJSON (field trimming)
  const reduced = {
    version: archJson.version ?? '1.0',
    language: archJson.language ?? 'typescript',
    entities: (archJson.entities ?? []).map((e: any) => ({
      name: e.name,
      type: e.type,
      file: e.file ?? e.sourceLocation?.file ?? '',
    })),
    relations: archJson.relations ?? [],
    callGraph: callEdges,
  };

  // Serialize and estimate tokens
  const json = JSON.stringify(reduced, null, 2);
  const tokenEstimate = estimateTokens(json);
  const exceeds = tokenEstimate > TOKEN_LIMIT;

  // Write output
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'reduced.json'), json, 'utf-8');

  const decision = exceeds
    ? `NEEDS_CHUNKING (estimated ${tokenEstimate} tokens > ${TOKEN_LIMIT} limit)`
    : `OK (estimated ${tokenEstimate} tokens ≤ ${TOKEN_LIMIT} limit)`;

  const report = [
    `L4 ArchJSON token count report (Stage 67.3)`,
    `==========================================`,
    `ArchJSON source: ${archjsonPath}`,
    `Callgraph source: ${callgraphPath} (${callEdges.length} call edges)`,
    `Entities in reduced JSON: ${reduced.entities.length}`,
    `Relations in reduced JSON: ${reduced.relations.length}`,
    `CallGraph edges: ${reduced.callGraph.length}`,
    `Raw JSON size: ${json.length} chars`,
    `Token estimate (cl100k_base approx): ${tokenEstimate}`,
    `Token limit: ${TOKEN_LIMIT}`,
    `Decision: ${decision}`,
    '',
    exceeds
      ? 'ACTION REQUIRED: Implement chunking before Stage 69.2 runs.\n' +
        'Chunk by module (src/mermaid + src/parser), embed each separately, mean-pool.'
      : 'No chunking needed. Stage 69.2 can use reduced.json directly.',
  ].join('\n');

  fs.writeFileSync(path.join(outDir, 'token-count.txt'), report, 'utf-8');
  console.log(report);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
