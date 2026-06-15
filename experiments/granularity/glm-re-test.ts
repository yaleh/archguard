import { createLlmClient } from './lib/llm-client';

async function test(label: string, params: Record<string, unknown>) {
  const client = createLlmClient();
  const t0 = Date.now();
  try {
    const res = await client.chat({
      model: 'glm-4.5-flash',
      messages: [{ role: 'user', content: 'What is 2+2? Reply with just the number.' }],
      params: { temperature: 0.2, max_tokens: 64, ...params },
      timeoutMs: 30000
    });
    console.log(`[${label}] ms=${Date.now()-t0} tokens=${res.completionTokens} empty=${!res.content.trim()} "${res.content.slice(0,80)}"`);
  } catch(e: any) {
    console.log(`[${label}] ERR: ${e.message?.slice(0,100)}`);
  }
}

await test('reasoning_effort=none', { reasoning_effort: 'none' });
await test('reasoning_effort=low',  { reasoning_effort: 'low' });
await test('no-params',             {});
