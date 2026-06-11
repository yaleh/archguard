import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getEnv } from '../lib/env';
import {
  GRANULARITY_ROOT,
  OBF_DIR,
  ARTIFACTS_DIR,
  LEVELS_DIR,
  GT_DIR,
  PREDICTIONS_DIR,
  RUNS_DIR,
  EMBEDDINGS_DIR,
  ensureDirs,
} from '../lib/paths';

describe('getEnv', () => {
  const ORIGINAL_BASE_URL = process.env.LLM_BASE_URL;
  const ORIGINAL_API_KEY = process.env.LLM_API_KEY;

  beforeEach(() => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_BASE_URL === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = ORIGINAL_BASE_URL;
    if (ORIGINAL_API_KEY === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = ORIGINAL_API_KEY;
  });

  it('throws when both LLM_BASE_URL and LLM_API_KEY are missing', () => {
    expect(() => getEnv()).toThrow(Error);
    expect(() => getEnv()).toThrow(/LLM_BASE_URL/);
    expect(() => getEnv()).toThrow(/LLM_API_KEY/);
  });

  it('throws when only LLM_BASE_URL is missing', () => {
    process.env.LLM_API_KEY = 'test-key-from-env';
    expect(() => getEnv()).toThrow(/LLM_BASE_URL/);
  });

  it('throws when only LLM_API_KEY is missing', () => {
    process.env.LLM_BASE_URL = 'http://localhost:4000';
    expect(() => getEnv()).toThrow(/LLM_API_KEY/);
  });

  it('throws when a variable is set to an empty string', () => {
    process.env.LLM_BASE_URL = '';
    process.env.LLM_API_KEY = 'test-key-from-env';
    expect(() => getEnv()).toThrow(/LLM_BASE_URL/);
  });

  it('returns both values when both variables are present', () => {
    process.env.LLM_BASE_URL = 'http://localhost:4000';
    process.env.LLM_API_KEY = 'test-key-from-env';
    expect(getEnv()).toEqual({
      llmBaseUrl: 'http://localhost:4000',
      llmApiKey: 'test-key-from-env',
    });
  });

  it('does not mutate process.env (no defaults written back)', () => {
    try {
      getEnv();
    } catch {
      // expected
    }
    expect(process.env.LLM_BASE_URL).toBeUndefined();
    expect(process.env.LLM_API_KEY).toBeUndefined();
  });
});

describe('paths', () => {
  it('GRANULARITY_ROOT is the absolute experiments/granularity directory', () => {
    expect(path.isAbsolute(GRANULARITY_ROOT)).toBe(true);
    expect(GRANULARITY_ROOT.split(path.sep).slice(-2)).toEqual(['experiments', 'granularity']);
  });

  it('exposes stable artifact directory constants under the experiment root', () => {
    expect(OBF_DIR).toBe(path.join(GRANULARITY_ROOT, 'obf'));
    expect(ARTIFACTS_DIR).toBe(path.join(GRANULARITY_ROOT, 'artifacts'));
    expect(LEVELS_DIR).toBe(path.join(ARTIFACTS_DIR, 'levels'));
    expect(GT_DIR).toBe(path.join(ARTIFACTS_DIR, 'gt'));
    expect(PREDICTIONS_DIR).toBe(path.join(ARTIFACTS_DIR, 'predictions'));
    expect(RUNS_DIR).toBe(path.join(ARTIFACTS_DIR, 'runs'));
    expect(EMBEDDINGS_DIR).toBe(path.join(ARTIFACTS_DIR, 'embeddings'));
  });

  it('ensureDirs creates every artifact directory', () => {
    ensureDirs();
    for (const dir of [
      OBF_DIR,
      LEVELS_DIR,
      GT_DIR,
      PREDICTIONS_DIR,
      RUNS_DIR,
      EMBEDDINGS_DIR,
    ]) {
      expect(existsSync(dir)).toBe(true);
      expect(statSync(dir).isDirectory()).toBe(true);
    }
  });

  it('ensureDirs is idempotent (second call does not throw)', () => {
    expect(() => {
      ensureDirs();
      ensureDirs();
    }).not.toThrow();
  });
});
