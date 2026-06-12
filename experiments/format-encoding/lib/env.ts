export function validateEnv(): void {
  const missing: string[] = [];

  if (!process.env['LLM_BASE_URL']) {
    missing.push('LLM_BASE_URL');
  }
  if (!process.env['LLM_API_KEY']) {
    missing.push('LLM_API_KEY');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}.\n` +
        `Please set them before running the experiment.\n` +
        `  LLM_BASE_URL  - Base URL for the LLM API endpoint\n` +
        `  LLM_API_KEY   - API key for authentication`,
    );
  }
}

export function getLLMBaseUrl(): string {
  const value = process.env['LLM_BASE_URL'];
  if (!value) {
    throw new Error('LLM_BASE_URL environment variable is not set. Call validateEnv() first.');
  }
  return value;
}

export function getLLMApiKey(): string {
  const value = process.env['LLM_API_KEY'];
  if (!value) {
    throw new Error('LLM_API_KEY environment variable is not set. Call validateEnv() first.');
  }
  return value;
}

export function getModelPrimary(): string {
  return process.env['MODEL_PRIMARY'] ?? 'gpt-4o';
}

export function getModelSecondary(): string {
  return process.env['MODEL_SECONDARY'] ?? 'gpt-4o-mini';
}
