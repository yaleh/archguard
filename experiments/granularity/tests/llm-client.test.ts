import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLlmClient, DEFAULT_TIMEOUT_MS, HttpError } from '../lib/llm-client';

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const GOOD_BODY = {
  choices: [{ message: { content: '{"answer": "Pf3"}' } }],
  usage: { prompt_tokens: 123, completion_tokens: 9 },
};

describe('createLlmClient', () => {
  beforeEach(() => {
    process.env.LLM_BASE_URL = 'https://gw.example.test/';
    process.env.LLM_API_KEY = 'sk-test-key';
  });

  afterEach(() => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
  });

  it('POSTs {base}/v1/chat/completions with Bearer auth and verbatim per-model params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(GOOD_BODY));
    const client = createLlmClient(fetchMock as unknown as typeof fetch);

    const res = await client.chat({
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hello' }],
      params: { temperature: 1, reasoning_effort: 'low' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    // trailing slash on LLM_BASE_URL is stripped (no double slash)
    expect(url).toBe('https://gw.example.test/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test-key');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe('gpt-5.4');
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(body.temperature).toBe(1);
    expect(body.reasoning_effort).toBe('low');

    expect(res).toEqual({ content: '{"answer": "Pf3"}', promptTokens: 123, completionTokens: 9 });
  });

  it('retries exactly once on a network error, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(okResponse(GOOD_BODY));
    const client = createLlmClient(fetchMock as unknown as typeof fetch);

    const res = await client.chat({ model: 'deepseek-v4-flash', messages: [], params: { temperature: 0.2 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.promptTokens).toBe(123);
  });

  it('fails after the single retry when the network keeps failing', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const client = createLlmClient(fetchMock as unknown as typeof fetch);

    await expect(client.chat({ model: 'm', messages: [] })).rejects.toThrow('fetch failed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry HTTP-status errors and surfaces them as HttpError', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    } as unknown as Response);
    const client = createLlmClient(fetchMock as unknown as typeof fetch);

    await expect(client.chat({ model: 'm', messages: [] })).rejects.toThrow(HttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts on timeout (and the timeout abort is retried once like a network error)', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          (init.signal as AbortSignal).addEventListener('abort', () =>
            reject(new DOMException('This operation was aborted', 'AbortError'))
          );
        })
    );
    const client = createLlmClient(fetchMock as unknown as typeof fetch);

    await expect(client.chat({ model: 'm', messages: [], timeoutMs: 20 })).rejects.toThrow(/abort/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(DEFAULT_TIMEOUT_MS).toBe(120_000);
  });

  it('defaults missing usage fields to -1 and missing content to empty string', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ choices: [] }));
    const client = createLlmClient(fetchMock as unknown as typeof fetch);

    const res = await client.chat({ model: 'm', messages: [] });
    expect(res).toEqual({ content: '', promptTokens: -1, completionTokens: -1 });
  });

  it('fails fast when credentials are missing (via lib/env.ts, no defaults)', async () => {
    delete process.env.LLM_API_KEY;
    const fetchMock = vi.fn();
    const client = createLlmClient(fetchMock as unknown as typeof fetch);

    await expect(client.chat({ model: 'm', messages: [] })).rejects.toThrow(/LLM_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
