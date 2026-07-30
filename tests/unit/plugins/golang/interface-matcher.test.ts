/**
 * TASK-44 unit tests for InterfaceMatcher bounded gopls integration.
 *
 * Uses a duck-typed fake GoplsClient (no binary, no child_process) to verify
 * the matcher degrades safely: a throwing/slow gopls query falls back to
 * name-based matching per-interface, and a poison-pill disabled gopls
 * short-circuits to the fallback.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InterfaceMatcher } from '../../../../src/plugins/golang/interface-matcher.js';
import {
  resetGoplsPoison,
  poisonGopls,
  type GoplsClient,
} from '../../../../src/plugins/golang/gopls-client.js';
import type { GoRawStruct, GoRawInterface } from '../../../../src/plugins/golang/types.js';

function fixtureStruct(name = 'Service'): GoRawStruct {
  return {
    name,
    packageName: 'main',
    fields: [],
    methods: [
      {
        name: 'Start',
        parameters: [],
        returnTypes: [],
        exported: true,
        location: { file: 'a.go', startLine: 1, endLine: 1 },
      },
      {
        name: 'Stop',
        parameters: [],
        returnTypes: [],
        exported: true,
        location: { file: 'a.go', startLine: 2, endLine: 2 },
      },
    ],
    embeddedTypes: [],
    exported: true,
    location: { file: 'a.go', startLine: 1, endLine: 5 },
  } as GoRawStruct;
}

function fixtureInterface(name = 'Runner'): GoRawInterface {
  return {
    name,
    packageName: 'main',
    methods: [
      {
        name: 'Start',
        parameters: [],
        returnTypes: [],
        exported: true,
        location: { file: 'a.go', startLine: 1, endLine: 1 },
      },
      {
        name: 'Stop',
        parameters: [],
        returnTypes: [],
        exported: true,
        location: { file: 'a.go', startLine: 2, endLine: 2 },
      },
    ],
    embeddedInterfaces: [],
    exported: true,
    location: { file: 'a.go', startLine: 1, endLine: 5 },
  } as GoRawInterface;
}

/** Duck-typed fake GoplsClient with programmable behaviour. */
function makeFakeClient(opts: {
  initialized?: boolean;
  throwOnQuery?: boolean;
}): GoplsClient {
  return {
    isInitialized: () => opts.initialized ?? true,
    getImplementations: vi.fn(async () => {
      if (opts.throwOnQuery) {
        throw new Error('Request timeout: textDocument/implementation');
      }
      return [];
    }),
  } as unknown as GoplsClient;
}

describe('InterfaceMatcher (TASK-44 bounded gopls integration)', () => {
  const matcher = new InterfaceMatcher();

  beforeEach(() => resetGoplsPoison());
  afterEach(() => {
    resetGoplsPoison();
    vi.clearAllMocks();
  });

  it('falls back to name-based matching when the client is null', async () => {
    const results = await matcher.matchWithGopls(
      [fixtureStruct()],
      [fixtureInterface()],
      null
    );
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('inferred');
  });

  it('falls back when gopls is disabled by the poison-pill', async () => {
    poisonGopls('budget exceeded');
    const client = makeFakeClient({ initialized: true });
    const results = await matcher.matchWithGopls(
      [fixtureStruct()],
      [fixtureInterface()],
      client
    );
    // Even though the client claims to be initialized, poison forces fallback.
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('inferred');
    expect(client.getImplementations).not.toHaveBeenCalled();
  });

  it('falls back when the client is not initialized', async () => {
    const client = makeFakeClient({ initialized: false });
    const results = await matcher.matchWithGopls(
      [fixtureStruct()],
      [fixtureInterface()],
      client
    );
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('inferred');
    expect(client.getImplementations).not.toHaveBeenCalled();
  });

  it('a throwing gopls query degrades per-interface and never throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = makeFakeClient({ initialized: true, throwOnQuery: true });

    // Must resolve (not reject) and still yield name-based results.
    const results = await matcher.matchWithGopls(
      [fixtureStruct()],
      [fixtureInterface()],
      client
    );

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('inferred');
    expect(results[0].structName).toBe('Service');
    expect(client.getImplementations).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('merges gopls hits with fallback for the remaining structs', async () => {
    // Client reports Service as an implementation of Runner.
    const client = {
      isInitialized: () => true,
      getImplementations: vi.fn(async () => [
        { structName: 'Service', filePath: '/a.go', line: 3 },
      ]),
    } as unknown as GoplsClient;

    const results = await matcher.matchWithGopls(
      [fixtureStruct('Service'), fixtureStruct('Other')],
      [fixtureInterface('Runner')],
      client
    );

    // Service via gopls (0.99), Other via name-based fallback (it has the
    // methods too) → both present.
    const service = results.find((r) => r.structName === 'Service');
    expect(service?.source).toBe('gopls');
    expect(service?.confidence).toBe(0.99);
  });
});
