import { createLlmClient, HttpError } from './lib/llm-client';

async function test(label: string, params: Record<string, unknown>) {
  const client = createLlmClient();
  try {
    const res = await client.chat({
      model: 'glm-4.5-flash',
      messages: [{ role: 'user', content: 'What is 2+2? Reply with just the number.' }],
      params: { max_tokens: 512, ...params },
      timeoutMs: 30000
    });
    console.log(`[${label}] OK tok=${res.completionTokens} empty=${!res.content.trim()} "${res.content.slice(0,60)}"`);
  } catch(e: any) {
    if (e instanceof HttpError) {
      console.log(`[${label}] HTTP ${e.status}: ${e.message.slice(0, 500)}`);
    } else {
      console.log(`[${label}] ERR: ${e.message?.slice(0, 200)}`);
    }
  }
}

// Zhipu 原生参数
await test('thinking={type:disabled}',        { thinking: { type: 'disabled' } });
await test('thinking={type:enabled}',         { thinking: { type: 'enabled' } });

// LiteLLM 标准参数
await test('reasoning_effort=none',           { reasoning_effort: 'none' });

// 不同写法尝试
await test('enable_thinking=false',           { enable_thinking: false });
await test('do_thinking=false',               { do_thinking: false });

// 无参数基准
await test('baseline (no thinking params)',   {});
