import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLlmClient } from './lib/llm-client';
import { createV2LevelTextLoader, buildPrompt } from './run-tasks';
import { parseModelAnswer, scoreSetF1, scoreExact } from './score';
import { LEVELS_DIR } from './lib/paths';

const MODEL = 'claude-haiku-4-5-20251001';
const client = createLlmClient();
const loader = createV2LevelTextLoader(LEVELS_DIR);
const tasks = JSON.parse(readFileSync('tasks/v2-tasks.json', 'utf8')) as any[];

const sample: any[] = [];
for (const cls of ['A','B','C']) {
  sample.push(...tasks.filter((t: any) => t.taskClass === cls).slice(0, 3));
}

const LEVELS = ['L3', 'L4'];
const K = 2;
const results: any[] = [];

console.log(`Testing ${MODEL} on ${sample.length} tasks × ${LEVELS.length} levels × k=${K}`);
console.log('');

for (const task of sample) {
  for (const level of LEVELS) {
    const deriv = (task as any).derivability?.[level];
    if (deriv === false) { console.log(`  SKIP ${task.id} ${level}`); continue; }
    const levelText = loader('v2-arch', level as any);
    const prompt = buildPrompt(task, levelText);
    const votes: string[] = [];
    const times: number[] = [];
    for (let k = 1; k <= K; k++) {
      const t0 = Date.now();
      try {
        const res = await client.chat({ model: MODEL, messages: [{ role: 'user', content: prompt }], params: { temperature: 0.2, max_tokens: 1024 }, timeoutMs: 60000 });
        times.push(Date.now() - t0); votes.push(res.content);
      } catch (e: any) {
        times.push(Date.now() - t0); votes.push('');
        process.stderr.write(`  ERR: ${e.message?.slice(0,100)}\n`);
      }
    }
    const parsed = votes.map(v => parseModelAnswer(v, task.answerType));
    const scores = parsed.map(p => p === null ? 0 : task.answerType === 'set' ? scoreSetF1(p as string[], task.answer) : scoreExact(p as any, task.answer as any));
    const mean = scores.reduce((a:number,b:number)=>a+b,0)/scores.length;
    const avgMs = times.reduce((a:number,b:number)=>a+b,0)/times.length;
    console.log(`[${task.taskClass}] ${task.id.slice(0,35).padEnd(35)} ${level}  score=${mean.toFixed(2)}  ${avgMs.toFixed(0)}ms  empty=${votes.filter(v=>!v.trim()).length}/${K}`);
    results.push({ taskId: task.id, taskClass: task.taskClass, level, score: mean, ms: avgMs });
  }
}

console.log('\n=== Summary ===');
for (const cls of ['A','B','C']) {
  for (const lv of LEVELS) {
    const rows = results.filter((r:any) => r.taskClass===cls && r.level===lv);
    if (!rows.length) continue;
    const mean = rows.reduce((s:number,r:any)=>s+r.score,0)/rows.length;
    const avgMs = rows.reduce((s:number,r:any)=>s+r.ms,0)/rows.length;
    console.log(`  ${cls}-${lv}: score=${mean.toFixed(3)}  latency=${(avgMs/1000).toFixed(1)}s  n=${rows.length}`);
  }
}
const overall = results.reduce((s:number,r:any)=>s+r.score,0)/results.length;
const overallMs = results.reduce((s:number,r:any)=>s+r.ms,0)/results.length;
console.log(`  OVERALL: score=${overall.toFixed(3)}  latency=${(overallMs/1000).toFixed(1)}s  n=${results.length}`);
