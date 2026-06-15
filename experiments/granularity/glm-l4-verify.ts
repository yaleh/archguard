import { readFileSync } from 'node:fs';
import { createLlmClient } from './lib/llm-client';
import { createV2LevelTextLoader, buildPrompt } from './run-tasks';
import { LEVELS_DIR } from './lib/paths';

async function main() {
  const client = createLlmClient();
  const loader = createV2LevelTextLoader(LEVELS_DIR);
  const tasks = JSON.parse(readFileSync('tasks/v2-tasks.json', 'utf8')) as any[];

  // 测试之前 empty 的 A-L4 任务
  const aTask = tasks.find((t: any) => t.id === 'v2-a-highest-indegree-1')!;
  for (const [label, max_tokens] of [['4096', 4096], ['8192', 8192]] as [string, number][]) {
    const levelText = loader('v2-arch', 'L4' as any);
    const prompt = buildPrompt(aTask, levelText);
    const t0 = Date.now();
    const res = await client.chat({
      model: 'glm-4.5-flash',
      messages: [{ role: 'user', content: prompt }],
      params: { temperature: 0.2, max_tokens },
      timeoutMs: 300000
    });
    console.log(`A-L4 max=${label}: ms=${Date.now()-t0} tok=${res.completionTokens} empty=${!res.content.trim()} "${res.content.slice(0,100)}"`);
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
