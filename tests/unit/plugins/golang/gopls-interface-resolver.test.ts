/**
 * TASK-44 unit tests for GoplsInterfaceResolver degradation propagation.
 *
 * Injects a fake gopls via mocked child_process.spawn (no real binary). The
 * budget is driven through the ARCHGUARD_GOPLS_TIMEOUT_MS env override to also
 * exercise the env → GoplsClient wiring. Covers:
 *   - timeout → degraded (tree-sitter-only) resolve, warning emitted
 *   - poison-pill → degraded without spawning
 *   - healthy gopls → not degraded
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { Writable } from 'stream';

function makeLspResponse(id: number, result: unknown): string {
  const body = JSON.stringify({ jsonrpc: '2.0', id, result });
  const len = Buffer.byteLength(body, 'utf-8');
  return `Content-Length: ${len}\r\n\r\n${body}`;
}

function makeVersionProc() {
  const proc = new EventEmitter() as any;
  proc.kill = vi.fn();
  proc.stdin = null;
  proc.stdout = null;
  proc.stderr = new EventEmitter();
  proc.pid = 33333;
  setImmediate(() => proc.emit('exit', 0, null));
  return proc;
}

function makeServeProc(opts: { hang?: boolean } = {}) {
  const stdout = new EventEmitter() as any;
  let inputBuffer = '';
  const stdin = new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      inputBuffer += chunk.toString();
      while (true) {
        const headerMatch = inputBuffer.match(/Content-Length: (\d+)\r\n\r\n/);
        if (!headerMatch) break;
        const contentLength = parseInt(headerMatch[1], 10);
        const headerLen = headerMatch[0].length;
        const bodyStart = (headerMatch.index ?? 0) + headerLen;
        const bodyEnd = bodyStart + contentLength;
        if (inputBuffer.length < bodyEnd) break;
        const body = inputBuffer.substring(bodyStart, bodyEnd);
        inputBuffer = inputBuffer.substring(bodyEnd);
        try {
          const msg = JSON.parse(body);
          if (msg.id === undefined) continue;
          if (opts.hang) continue;
          let result: unknown = null;
          if (msg.method === 'initialize') result = { capabilities: {} };
          else if (msg.method === 'shutdown') result = null;
          else if (msg.method === 'textDocument/implementation') result = [];
          else continue;
          const response = makeLspResponse(msg.id, result);
          setImmediate(() => stdout.emit('data', Buffer.from(response)));
        } catch {
          // ignore
        }
      }
      callback();
    },
  });
  const proc = new EventEmitter() as any;
  proc.stdin = stdin;
  proc.stdout = stdout;
  proc.stderr = new EventEmitter();
  proc.pid = 44444;
  proc.kill = vi.fn(() => setImmediate(() => proc.emit('exit', 0, null)));
  return proc;
}

const spawnMock = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { GoplsInterfaceResolver } from '../../../../src/plugins/golang/gopls-interface-resolver.js';
import {
  resetGoplsPoison,
  poisonGopls,
  isGoplsPoisoned,
} from '../../../../src/plugins/golang/gopls-client.js';
import type {
  GoRawStruct,
  GoRawInterface,
} from '../../../../src/plugins/golang/types.js';

const WS = '/tmp/fake-gopls-ws';

function fixtureStruct(): GoRawStruct & { packageName: string } {
  return {
    name: 'Service',
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
  };
}

function fixtureInterface(): GoRawInterface & { packageName: string } {
  return {
    name: 'Runner',
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
  };
}

describe('GoplsInterfaceResolver (TASK-44 degradation)', () => {
  let spawned: Array<{ args: string[]; proc: any }>;
  let savedEnv: string | undefined;

  beforeEach(() => {
    resetGoplsPoison();
    spawned = [];
    savedEnv = process.env.ARCHGUARD_GOPLS_TIMEOUT_MS;
    spawnMock.mockImplementation((_cmd: string, args: string[]) => {
      const proc = args && args[0] === 'version' ? makeVersionProc() : makeServeProc();
      spawned.push({ args, proc });
      return proc;
    });
  });

  afterEach(async () => {
    if (savedEnv === undefined) {
      delete process.env.ARCHGUARD_GOPLS_TIMEOUT_MS;
    } else {
      process.env.ARCHGUARD_GOPLS_TIMEOUT_MS = savedEnv;
    }
    resetGoplsPoison();
    vi.clearAllMocks();
  });

  it('degrades to tree-sitter matching when gopls startup exceeds the budget', async () => {
    // Small budget via env override; serve hangs so the budget fires.
    process.env.ARCHGUARD_GOPLS_TIMEOUT_MS = '120';
    spawnMock.mockImplementation((_cmd: string, args: string[]) => {
      const proc =
        args && args[0] === 'version' ? makeVersionProc() : makeServeProc({ hang: true });
      spawned.push({ args, proc });
      return proc;
    });

    const warnings: string[] = [];
    const resolver = new GoplsInterfaceResolver({ warn: (m) => warnings.push(m) });

    // initialize must NOT throw — it degrades gracefully.
    await expect(resolver.initialize(WS)).resolves.not.toThrow();

    expect(resolver.isDegraded()).toBe(true);
    expect(resolver.isGoplsAvailable()).toBe(false);
    expect(resolver.getDegradedReason()).toMatch(/timed out|timeout/i);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/degraded/i);

    // resolve() still produces results via name-based matching.
    const results = await resolver.resolve([fixtureStruct()], [fixtureInterface()]);
    expect(results).toHaveLength(1);
    expect(results[0].structName).toBe('Service');
    expect(results[0].interfaceName).toBe('Runner');
    expect(results[0].source).toBe('inferred');

    // The hung child was reaped.
    const serveEntry = spawned.find((s) => s.args[0] !== 'version');
    expect(serveEntry!.proc.kill).toHaveBeenCalled();

    await resolver.dispose();
  });

  it('is not degraded when gopls starts successfully', async () => {
    const resolver = new GoplsInterfaceResolver({ budgetMs: 5000 });
    await resolver.initialize(WS);

    expect(resolver.isDegraded()).toBe(false);
    expect(resolver.getDegradedReason()).toBeNull();
    expect(resolver.isGoplsAvailable()).toBe(true);

    await resolver.dispose();
  });

  it('degrades without spawning when the poison-pill is active', async () => {
    poisonGopls('earlier budget timeout');
    const warnings: string[] = [];
    const resolver = new GoplsInterfaceResolver({ warn: (m) => warnings.push(m) });

    const callsBefore = spawnMock.mock.calls.length;
    await resolver.initialize(WS);

    expect(spawnMock.mock.calls.length).toBe(callsBefore); // no spawn
    expect(resolver.isDegraded()).toBe(true);
    expect(resolver.isGoplsAvailable()).toBe(false);
    expect(resolver.getDegradedReason()).toMatch(/poison-pill/);
    expect(isGoplsPoisoned()).toBe(true);
    expect(warnings[0]).toMatch(/degraded/i);
  });

  it('emits the degradation warning on stderr by default (console.warn)', async () => {
    process.env.ARCHGUARD_GOPLS_TIMEOUT_MS = '120';
    spawnMock.mockImplementation((_cmd: string, args: string[]) => {
      const proc =
        args && args[0] === 'version' ? makeVersionProc() : makeServeProc({ hang: true });
      spawned.push({ args, proc });
      return proc;
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const resolver = new GoplsInterfaceResolver(); // default warn → console.warn
    await resolver.initialize(WS);

    expect(warnSpy).toHaveBeenCalled();
    const combined = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(combined).toMatch(/degraded/i);
    warnSpy.mockRestore();
    await resolver.dispose();
  });
});
