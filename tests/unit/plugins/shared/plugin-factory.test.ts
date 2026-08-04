/**
 * Unit tests for createLanguagePlugin (plugin factory).
 *
 * Covers the per-language switch: each language constructs its concrete
 * plugin class with the resolver-selected backend. selectParserBackendFor is
 * mocked to a fake backend so the test exercises the factory switch without
 * depending on the native probe.
 */

import { describe, it, expect, vi } from 'vitest';
import { createLanguagePlugin } from '@/plugins/shared/plugin-factory.js';
import { selectParserBackendFor } from '@/plugins/shared/parser-runtime.js';
import type { ParserBackend } from '@/plugins/shared/parser-backend.js';

vi.mock('@/plugins/shared/parser-runtime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/plugins/shared/parser-runtime.js')>();
  return {
    ...actual,
    selectParserBackendFor: vi.fn(),
  };
});

const fakeBackend: ParserBackend = {
  runtime: 'native',
  createSession: async () => {
    throw new Error('not used in factory test');
  },
};

describe('createLanguagePlugin', () => {
  it('constructs the Go atlas plugin with the selected backend', async () => {
    vi.mocked(selectParserBackendFor).mockResolvedValue({ backend: fakeBackend } as never);
    const plugin = await createLanguagePlugin('go', {});
    expect(selectParserBackendFor).toHaveBeenCalledWith('go', {});
    expect(plugin).toBeInstanceOf((await import('@/plugins/golang/atlas/index.js')).GoAtlasPlugin);
  });

  it('constructs the Java plugin', async () => {
    vi.mocked(selectParserBackendFor).mockResolvedValue({ backend: fakeBackend } as never);
    const plugin = await createLanguagePlugin('java');
    expect(plugin).toBeInstanceOf((await import('@/plugins/java/index.js')).JavaPlugin);
  });

  it('constructs the Python plugin', async () => {
    vi.mocked(selectParserBackendFor).mockResolvedValue({ backend: fakeBackend } as never);
    const plugin = await createLanguagePlugin('python');
    expect(plugin).toBeInstanceOf((await import('@/plugins/python/index.js')).PythonPlugin);
  });

  it('constructs the C++ plugin', async () => {
    vi.mocked(selectParserBackendFor).mockResolvedValue({ backend: fakeBackend } as never);
    const plugin = await createLanguagePlugin('cpp');
    expect(plugin).toBeInstanceOf((await import('@/plugins/cpp/index.js')).CppPlugin);
  });

  it('constructs the Kotlin plugin', async () => {
    vi.mocked(selectParserBackendFor).mockResolvedValue({ backend: fakeBackend } as never);
    const plugin = await createLanguagePlugin('kotlin');
    expect(plugin).toBeInstanceOf((await import('@/plugins/kotlin/index.js')).KotlinPlugin);
  });
});
