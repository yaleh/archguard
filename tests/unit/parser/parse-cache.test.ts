/**
 * Unit tests for ParseCache
 *
 * Phase D: parse-time deduplication via ParseCache
 */

import { describe, it, expect, vi } from 'vitest';
import { ParseCache } from '@/parser/parse-cache.js';
import type { ArchJSON } from '@/types/index.js';

function makeArchJSON(id: string): ArchJSON {
  return {
    version: '1.0',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: [`${id}.ts`],
    entities: [],
    relations: [],
  };
}

describe('ParseCache', () => {
  it('cache miss: first call invokes parseFn and returns result', () => {
    const cache = new ParseCache();
    const parseFn = vi.fn(() => makeArchJSON('a'));

    const result = cache.getOrParse('/path/to/a.ts', 'content-a', parseFn);

    expect(parseFn).toHaveBeenCalledTimes(1);
    expect(result.sourceFiles).toContain('a.ts');
  });

  it('cache hit: second call with same filePath+content returns cached result without calling parseFn', () => {
    const cache = new ParseCache();
    const archJSON = makeArchJSON('b');
    const parseFn = vi.fn(() => archJSON);

    const first = cache.getOrParse('/path/to/b.ts', 'content-b', parseFn);
    const second = cache.getOrParse('/path/to/b.ts', 'content-b', parseFn);

    expect(parseFn).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('key includes filePath: same content + different path → cache miss', () => {
    const cache = new ParseCache();
    const parseFn = vi.fn(() => makeArchJSON('c'));

    cache.getOrParse('/path/one.ts', 'same-content', parseFn);
    cache.getOrParse('/path/two.ts', 'same-content', parseFn);

    expect(parseFn).toHaveBeenCalledTimes(2);
  });

  it('key includes content: same path + different content → cache miss', () => {
    const cache = new ParseCache();
    const parseFn = vi.fn(() => makeArchJSON('d'));

    cache.getOrParse('/path/d.ts', 'content-v1', parseFn);
    cache.getOrParse('/path/d.ts', 'content-v2', parseFn);

    expect(parseFn).toHaveBeenCalledTimes(2);
  });

  it('empty content string works correctly', () => {
    const cache = new ParseCache();
    const archJSON = makeArchJSON('empty');
    const parseFn = vi.fn(() => archJSON);

    const result = cache.getOrParse('/path/empty.ts', '', parseFn);

    expect(parseFn).toHaveBeenCalledTimes(1);
    expect(result).toBe(archJSON);

    // Second call with empty string should be a cache hit
    cache.getOrParse('/path/empty.ts', '', parseFn);
    expect(parseFn).toHaveBeenCalledTimes(1);
  });

  it('multiple independent entries coexist', () => {
    const cache = new ParseCache();
    const parseFn1 = vi.fn(() => makeArchJSON('x'));
    const parseFn2 = vi.fn(() => makeArchJSON('y'));
    const parseFn3 = vi.fn(() => makeArchJSON('z'));

    cache.getOrParse('/x.ts', 'cx', parseFn1);
    cache.getOrParse('/y.ts', 'cy', parseFn2);
    cache.getOrParse('/z.ts', 'cz', parseFn3);

    // All three are cache hits on second call
    cache.getOrParse('/x.ts', 'cx', parseFn1);
    cache.getOrParse('/y.ts', 'cy', parseFn2);
    cache.getOrParse('/z.ts', 'cz', parseFn3);

    expect(parseFn1).toHaveBeenCalledTimes(1);
    expect(parseFn2).toHaveBeenCalledTimes(1);
    expect(parseFn3).toHaveBeenCalledTimes(1);
  });

  it('size getter reflects cache entry count', () => {
    const cache = new ParseCache();

    expect(cache.size).toBe(0);

    cache.getOrParse('/a.ts', 'ca', () => makeArchJSON('a'));
    expect(cache.size).toBe(1);

    cache.getOrParse('/b.ts', 'cb', () => makeArchJSON('b'));
    expect(cache.size).toBe(2);

    // Repeat existing key — no new entry
    cache.getOrParse('/a.ts', 'ca', () => makeArchJSON('a'));
    expect(cache.size).toBe(2);
  });
});
