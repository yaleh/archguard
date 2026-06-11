/**
 * Fail-fast environment access for LLM / embedding gateway credentials.
 *
 * Credentials are ONLY ever read from environment variables (LLM_BASE_URL,
 * LLM_API_KEY). No defaults are provided and nothing is written to disk or
 * back into process.env (plan 59-66 discipline #4: zero credentials on disk).
 */

export interface GranularityEnv {
  llmBaseUrl: string;
  llmApiKey: string;
}

export function getEnv(): GranularityEnv {
  const llmBaseUrl = process.env.LLM_BASE_URL;
  const llmApiKey = process.env.LLM_API_KEY;

  const missing: string[] = [];
  if (!llmBaseUrl) missing.push('LLM_BASE_URL');
  if (!llmApiKey) missing.push('LLM_API_KEY');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Set them before running any granularity experiment script (no defaults are provided).'
    );
  }

  return { llmBaseUrl: llmBaseUrl as string, llmApiKey: llmApiKey as string };
}
