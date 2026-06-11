/**
 * Minimal LLM gateway client (Stage 63.2; reused by the 64.2(c) leakage probe).
 *
 * POSTs {LLM_BASE_URL}/v1/chat/completions with Bearer {LLM_API_KEY}
 * (credentials only via lib/env.ts). Per-model request parameters are passed
 * through verbatim. Timeout via AbortController; exactly one retry on
 * network errors (HTTP-status errors are NOT retried).
 */
import { getEnv } from './env';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /** Per-model sampling params, spread into the request body (§6). */
  params?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface ChatResponse {
  content: string;
  promptTokens: number;
  completionTokens: number;
}

export interface LlmClient {
  chat(req: ChatRequest): Promise<ChatResponse>;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    body: string
  ) {
    super(`LLM gateway HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = 'HttpError';
  }
}

export const DEFAULT_TIMEOUT_MS = 120_000;

export function createLlmClient(fetchImpl: typeof fetch = fetch): LlmClient {
  return {
    async chat(req: ChatRequest): Promise<ChatResponse> {
      const { llmBaseUrl, llmApiKey } = getEnv();
      const url = `${llmBaseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
      const body = JSON.stringify({ model: req.model, messages: req.messages, ...(req.params ?? {}) });

      const attempt = async (): Promise<ChatResponse> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        try {
          const res = await fetchImpl(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${llmApiKey}`,
            },
            body,
            signal: controller.signal,
          });
          if (!res.ok) throw new HttpError(res.status, await res.text());
          const json = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          return {
            content: json.choices?.[0]?.message?.content ?? '',
            promptTokens: json.usage?.prompt_tokens ?? -1,
            completionTokens: json.usage?.completion_tokens ?? -1,
          };
        } finally {
          clearTimeout(timer);
        }
      };

      try {
        return await attempt();
      } catch (err) {
        if (err instanceof HttpError) throw err;
        return attempt(); // one retry on network error / timeout
      }
    },
  };
}
