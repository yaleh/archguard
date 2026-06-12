/**
 * LLM gateway client for format-encoding experiment.
 * POST {LLM_BASE_URL}/v1/chat/completions with Bearer {LLM_API_KEY}.
 * Credentials only via env.ts (zero disk for API keys).
 */
import { getLLMBaseUrl, getLLMApiKey, validateEnv } from './env.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  params?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface ChatResponse {
  content: string;
  promptTokens: number;
  completionTokens: number;
}

export class HttpError extends Error {
  constructor(public readonly status: number, body: string) {
    super(`LLM HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = 'HttpError';
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;

export function createLlmClient(): {
  chat(req: ChatRequest): Promise<ChatResponse>;
} {
  return {
    async chat(req) {
      validateEnv();
      const llmBaseUrl = getLLMBaseUrl();
      const llmApiKey = getLLMApiKey();
      const url = `${llmBaseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
      const body = JSON.stringify({
        model: req.model,
        messages: req.messages,
        max_tokens: 8192,
        ...(req.params ?? {}),
      });

      const attempt = async (): Promise<ChatResponse> => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${llmApiKey}` },
            body,
            signal: ctrl.signal,
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
        return attempt();
      }
    },
  };
}
