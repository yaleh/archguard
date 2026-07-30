/**
 * TASK-44 unit tests for GoplsClient reliability bounds.
 *
 * Uses an injected fake gopls (mocked child_process.spawn) with controllable
 * latency — NO real gopls binary is required. Covers:
 *   - configurable timeout budget (default + env override)
 *   - startup budget exhaustion → GoplsTimeoutError + poison-pill + reaping
 *   - poison-pill prevents re-spawn within the process
 *   - diagnostics surface the poisoned state
 *   - process reaping on dispose / timeout / error
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { Writable } from 'stream';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

// ---------------------------------------------------------------------------
// Fake gopls process factory (controllable latency / hang)
// ---------------------------------------------------------------------------

function makeLspResponse(id: number, result: unknown): string {
  const body = JSON.stringify({ jsonrpc: '2.0', id, result });
  const len = Buffer.byteLength(body, 'utf-8');
  return `Content-Length: ${len}\r\n\r\n${body}`;
}

/** Fake `gopls version` probe. `hang: true` never exits (simulates a stall). */
function makeVersionProc(opts: { hang?: boolean } = {}) {
  const proc = new EventEmitter() as any;
  proc.kill = vi.fn();
  proc.stdin = null;
  proc.stdout = null;
  proc.stderr = new EventEmitter();
  proc.pid = 11111;
  if (!opts.hang) {
    setImmediate(() => proc.emit('exit', 0, null));
  }
  return proc;
}

/**
 * Fake `gopls serve` process speaking LSP Content-Length framing.
 * `hang: true` never responds to any request (simulates a stalled analysis).
 */
function makeServeProc(opts: { hang?: boolean } = {}) {
  const stdout = new EventEmitter() as any;
  const stderr = new EventEmitter() as any;
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
          if (msg.id === undefined) continue; // notification
          if (opts.hang) continue; // never respond → forces budget exhaustion
          let result: unknown = null;
          if (msg.method === 'initialize') result = { capabilities: {} };
          else if (msg.method === 'shutdown') result = null;
          else if (msg.method === 'textDocument/implementation') result = [];
          else if (msg.method === 'textDocument/hover') result = null;
          else continue;
          const response = makeLspResponse(msg.id, result);
          setImmediate(() => stdout.emit('data', Buffer.from(response)));
        } catch {
          // ignore malformed
        }
      }
      callback();
    },
  });

  const proc = new EventEmitter() as any;
  proc.stdin = stdin;
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.pid = 22222;
  proc.kill = vi.fn(() => {
    setImmediate(() => proc.emit('exit', 0, null));
  });
  return proc;
}

// ---------------------------------------------------------------------------
// Mock child_process
// ---------------------------------------------------------------------------

const spawnMock = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import {
  GoplsClient,
  GoplsTimeoutError,
  GoplsPoisonedError,
  resolveGoplsTimeoutMs,
  readGoplsTimeoutFromConfigFile,
  resolveEffectiveGoplsTimeoutMs,
  DEFAULT_GOPLS_TIMEOUT_MS,
  isGoplsPoisoned,
  getGoplsPoisonReason,
  poisonGopls,
  resetGoplsPoison,
  getGoplsDiagnostics,
} from '../../../../src/plugins/golang/gopls-client.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const WS = '/tmp/fake-gopls-ws';

describe('GoplsClient (TASK-44 reliability bounds)', () => {
  let spawned: Array<{ args: string[]; proc: any }>;

  beforeEach(() => {
    resetGoplsPoison();
    spawned = [];
    spawnMock.mockImplementation((_cmd: string, args: string[]) => {
      const proc =
        args && args[0] === 'version' ? makeVersionProc() : makeServeProc();
      spawned.push({ args, proc });
      return proc;
    });
  });

  afterEach(async () => {
    resetGoplsPoison();
    vi.clearAllMocks();
  });

  describe('resolveGoplsTimeoutMs', () => {
    it('returns the 120s default when the env override is unset', () => {
      expect(resolveGoplsTimeoutMs({} as NodeJS.ProcessEnv)).toBe(DEFAULT_GOPLS_TIMEOUT_MS);
      expect(DEFAULT_GOPLS_TIMEOUT_MS).toBe(120_000);
    });

    it('honours the ARCHGUARD_GOPLS_TIMEOUT_MS env override', () => {
      expect(resolveGoplsTimeoutMs({ ARCHGUARD_GOPLS_TIMEOUT_MS: '5000' })).toBe(5000);
    });

    it('falls back to the default on invalid / non-positive values', () => {
      expect(resolveGoplsTimeoutMs({ ARCHGUARD_GOPLS_TIMEOUT_MS: 'nope' })).toBe(
        DEFAULT_GOPLS_TIMEOUT_MS
      );
      expect(resolveGoplsTimeoutMs({ ARCHGUARD_GOPLS_TIMEOUT_MS: '-1' })).toBe(
        DEFAULT_GOPLS_TIMEOUT_MS
      );
      expect(resolveGoplsTimeoutMs({ ARCHGUARD_GOPLS_TIMEOUT_MS: '0' })).toBe(
        DEFAULT_GOPLS_TIMEOUT_MS
      );
    });
  });

  describe('budget precedence (env > config atlas.goplsTimeoutMs > default)', () => {
    it('config-only (no env): the budget equals the config value', () => {
      expect(resolveGoplsTimeoutMs({}, 180_000)).toBe(180_000);
    });

    it('env + config: the env override wins', () => {
      expect(resolveGoplsTimeoutMs({ ARCHGUARD_GOPLS_TIMEOUT_MS: '5000' }, 180_000)).toBe(5000);
    });

    it('neither env nor config: the 120s default applies', () => {
      expect(resolveGoplsTimeoutMs({})).toBe(DEFAULT_GOPLS_TIMEOUT_MS);
      expect(resolveGoplsTimeoutMs({}, undefined)).toBe(DEFAULT_GOPLS_TIMEOUT_MS);
    });

    it('invalid / non-positive config values fall through to the default', () => {
      expect(resolveGoplsTimeoutMs({}, -1)).toBe(DEFAULT_GOPLS_TIMEOUT_MS);
      expect(resolveGoplsTimeoutMs({}, 0)).toBe(DEFAULT_GOPLS_TIMEOUT_MS);
      expect(resolveGoplsTimeoutMs({}, Number.NaN)).toBe(DEFAULT_GOPLS_TIMEOUT_MS);
    });

    it('an invalid env value falls through to the config value, then the default', () => {
      expect(resolveGoplsTimeoutMs({ ARCHGUARD_GOPLS_TIMEOUT_MS: 'nope' }, 9000)).toBe(9000);
      expect(resolveGoplsTimeoutMs({ ARCHGUARD_GOPLS_TIMEOUT_MS: 'nope' })).toBe(
        DEFAULT_GOPLS_TIMEOUT_MS
      );
    });
  });

  describe('readGoplsTimeoutFromConfigFile', () => {
    let cfgDir: string;

    beforeEach(async () => {
      cfgDir = await mkdtemp(path.join(tmpdir(), 'gopls-cfg-task44-'));
    });

    afterEach(async () => {
      await rm(cfgDir, { recursive: true, force: true });
    });

    it('reads atlas.goplsTimeoutMs from archguard.config.json', async () => {
      await writeFile(
        path.join(cfgDir, 'archguard.config.json'),
        JSON.stringify({ atlas: { goplsTimeoutMs: 90_000 } })
      );
      expect(readGoplsTimeoutFromConfigFile(cfgDir)).toBe(90_000);
    });

    it('returns undefined when the config file is absent', () => {
      expect(readGoplsTimeoutFromConfigFile(cfgDir)).toBeUndefined();
    });

    it('returns undefined on malformed JSON', async () => {
      await writeFile(path.join(cfgDir, 'archguard.config.json'), '{ not json');
      expect(readGoplsTimeoutFromConfigFile(cfgDir)).toBeUndefined();
    });

    it('returns undefined when atlas.goplsTimeoutMs is absent or invalid', async () => {
      const cfgPath = path.join(cfgDir, 'archguard.config.json');

      await writeFile(cfgPath, JSON.stringify({ verbose: true }));
      expect(readGoplsTimeoutFromConfigFile(cfgDir)).toBeUndefined();

      await writeFile(cfgPath, JSON.stringify({ atlas: {} }));
      expect(readGoplsTimeoutFromConfigFile(cfgDir)).toBeUndefined();

      await writeFile(cfgPath, JSON.stringify({ atlas: { goplsTimeoutMs: 'soon' } }));
      expect(readGoplsTimeoutFromConfigFile(cfgDir)).toBeUndefined();

      await writeFile(cfgPath, JSON.stringify({ atlas: { goplsTimeoutMs: -5 } }));
      expect(readGoplsTimeoutFromConfigFile(cfgDir)).toBeUndefined();
    });
  });

  describe('resolveEffectiveGoplsTimeoutMs (all three sources converge)', () => {
    let cfgDir: string;

    beforeEach(async () => {
      cfgDir = await mkdtemp(path.join(tmpdir(), 'gopls-eff-task44-'));
    });

    afterEach(async () => {
      await rm(cfgDir, { recursive: true, force: true });
    });

    it('config file value applies when env is unset', async () => {
      await writeFile(
        path.join(cfgDir, 'archguard.config.json'),
        JSON.stringify({ atlas: { goplsTimeoutMs: 77_000 } })
      );
      expect(resolveEffectiveGoplsTimeoutMs({}, cfgDir)).toBe(77_000);
    });

    it('env beats the config file value', async () => {
      await writeFile(
        path.join(cfgDir, 'archguard.config.json'),
        JSON.stringify({ atlas: { goplsTimeoutMs: 77_000 } })
      );
      expect(resolveEffectiveGoplsTimeoutMs({ ARCHGUARD_GOPLS_TIMEOUT_MS: '321' }, cfgDir)).toBe(
        321
      );
    });

    it('no env + no config file → 120s default', () => {
      expect(resolveEffectiveGoplsTimeoutMs({}, cfgDir)).toBe(DEFAULT_GOPLS_TIMEOUT_MS);
    });
  });

  describe('startup budget exhaustion', () => {
    it('rejects with GoplsTimeoutError, poisons, and reaps when gopls hangs', async () => {
      // Serve process never responds → the startup budget must fire.
      spawnMock.mockImplementation((_cmd: string, args: string[]) => {
        const proc =
          args && args[0] === 'version' ? makeVersionProc() : makeServeProc({ hang: true });
        spawned.push({ args, proc });
        return proc;
      });

      // budget = 120ms, per-request timeout large so the budget is binding.
      const client = new GoplsClient('gopls', 30000, 120);
      const start = Date.now();
      const promise = client.initialize(WS);

      await expect(promise).rejects.toBeInstanceOf(GoplsTimeoutError);
      const elapsed = Date.now() - start;

      // Bounded: completes on the budget, not the 30s per-request timeout.
      expect(elapsed).toBeLessThan(5000);

      const err = await client.initialize(WS).catch((e) => e);
      // Second call is blocked by the poison-pill (set by the first failure).
      expect(err).toBeInstanceOf(GoplsPoisonedError);

      // Poison-pill is now active process-wide.
      expect(isGoplsPoisoned()).toBe(true);
      expect(getGoplsPoisonReason()).toMatch(/budget/);

      // The hung serve child was reaped (kill called).
      const serveEntry = spawned.find((s) => s.args[0] !== 'version');
      expect(serveEntry).toBeDefined();
      expect(serveEntry!.proc.kill).toHaveBeenCalled();
    });

    it('bounds a hung version probe and reaps the probe child', async () => {
      spawnMock.mockImplementation((_cmd: string, args: string[]) => {
        const proc =
          args && args[0] === 'version'
            ? makeVersionProc({ hang: true })
            : makeServeProc();
        spawned.push({ args, proc });
        return proc;
      });

      const client = new GoplsClient('gopls', 30000, 100);
      await expect(client.initialize(WS)).rejects.toBeInstanceOf(GoplsTimeoutError);
      expect(isGoplsPoisoned()).toBe(true);

      const versionEntry = spawned.find((s) => s.args[0] === 'version');
      expect(versionEntry).toBeDefined();
      expect(versionEntry!.proc.kill).toHaveBeenCalled();
    });
  });

  describe('poison-pill', () => {
    it('never spawns gopls again once poisoned', async () => {
      poisonGopls('prior timeout');
      const client = new GoplsClient('gopls', 30000, 1000);

      const callsBefore = spawnMock.mock.calls.length;
      await expect(client.initialize(WS)).rejects.toBeInstanceOf(GoplsPoisonedError);
      expect(spawnMock.mock.calls.length).toBe(callsBefore); // no spawn
      expect(isGoplsPoisoned()).toBe(true);
    });

    it('resetGoplsPoison re-arms gopls', async () => {
      poisonGopls('prior timeout');
      expect(isGoplsPoisoned()).toBe(true);
      resetGoplsPoison();
      expect(isGoplsPoisoned()).toBe(false);
      expect(getGoplsPoisonReason()).toBeNull();

      const client = new GoplsClient('gopls', 30000, 5000);
      await expect(client.initialize(WS)).resolves.not.toThrow();
      expect(client.isInitialized()).toBe(true);
      await client.dispose();
    });

    it('surfaces the poisoned state in diagnostics', () => {
      resetGoplsPoison();
      expect(getGoplsDiagnostics().join('\n')).toMatch(/poison-pill inactive/);
      poisonGopls('startup exceeded budget of 120ms');
      const diag = getGoplsDiagnostics().join('\n');
      expect(diag).toMatch(/POISON-PILL active/);
      expect(diag).toMatch(/startup exceeded budget/);
    });
  });

  describe('process reaping', () => {
    it('reaps the serve child on dispose', async () => {
      const client = new GoplsClient('gopls', 30000, 5000);
      await client.initialize(WS);
      const serveEntry = spawned.find((s) => s.args[0] !== 'version');
      expect(serveEntry).toBeDefined();

      await client.dispose();
      expect(serveEntry!.proc.kill).toHaveBeenCalled();
      expect(client.isInitialized()).toBe(false);
    });

    it('is safe to dispose multiple times', async () => {
      const client = new GoplsClient('gopls', 30000, 5000);
      await client.initialize(WS);
      await client.dispose();
      await expect(client.dispose()).resolves.not.toThrow();
    });
  });
});
