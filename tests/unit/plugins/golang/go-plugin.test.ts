/**
 * TASK-44 unit tests for GoPlugin end-to-end gopls degradation.
 *
 * Drives the real tree-sitter parse path (nativeParserBackend) against a temp
 * Go fixture while injecting a fake gopls via mocked child_process.spawn. No
 * real gopls binary is required. Asserts that a hanging gopls:
 *   - never stalls parseProject (bounded by the env-driven budget)
 *   - marks the ArchJSON output degraded (metadata.goGoplsDegraded)
 *   - emits a loud warning
 *   - still yields tree-sitter entities/relations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { Writable } from 'stream';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

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
  proc.pid = 55555;
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
  proc.pid = 66666;
  proc.kill = vi.fn(() => setImmediate(() => proc.emit('exit', 0, null)));
  return proc;
}

const spawnMock = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { GoPlugin } from '../../../../src/plugins/golang/index.js';
import { nativeParserBackend } from '../../../../src/plugins/shared/native-parser-backend.js';
import { resetGoplsPoison } from '../../../../src/plugins/golang/gopls-client.js';

const GO_MOD = 'module github.com/example/demo\n\ngo 1.21\n';
const MAIN_GO = `package main

type Runner interface {
\tStart()
\tStop()
}

type Service struct {
\tName string
}

func (s *Service) Start() {}
func (s *Service) Stop() {}

func main() {
\ts := &Service{Name: "demo"}
\ts.Start()
\ts.Stop()
}
`;

describe('GoPlugin (TASK-44 end-to-end degradation)', () => {
  let tmpDir: string;
  let savedEnv: string | undefined;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    resetGoplsPoison();
    savedEnv = process.env.ARCHGUARD_GOPLS_TIMEOUT_MS;
    tmpDir = await mkdtemp(path.join(tmpdir(), 'go-plugin-task44-'));
    await writeFile(path.join(tmpDir, 'go.mod'), GO_MOD);
    await writeFile(path.join(tmpDir, 'main.go'), MAIN_GO);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    if (savedEnv === undefined) {
      delete process.env.ARCHGUARD_GOPLS_TIMEOUT_MS;
    } else {
      process.env.ARCHGUARD_GOPLS_TIMEOUT_MS = savedEnv;
    }
    resetGoplsPoison();
    await rm(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('completes bounded + degraded when gopls hangs, with tree-sitter results', async () => {
    process.env.ARCHGUARD_GOPLS_TIMEOUT_MS = '150';
    spawnMock.mockImplementation((_cmd: string, args: string[]) =>
      args && args[0] === 'version' ? makeVersionProc() : makeServeProc({ hang: true })
    );

    const plugin = new GoPlugin(nativeParserBackend);
    const start = Date.now();
    await plugin.initialize({ workspaceRoot: tmpDir });
    const result = await plugin.parseProject(tmpDir, {
      workspaceRoot: tmpDir,
      excludePatterns: [],
    });
    const elapsed = Date.now() - start;

    // Bounded: far below the default 120s budget / any CLI timeout.
    expect(elapsed).toBeLessThan(15000);

    // Output is explicitly marked degraded.
    expect(result.metadata?.goGoplsDegraded).toBe(true);
    expect(String(result.metadata?.goGoplsDegradedReason)).toMatch(/timed out|timeout/i);
    expect(result.metadata?.goGoplsAvailable).toBe(false);

    // Tree-sitter results are still present.
    expect(result.language).toBe('go');
    const names = result.entities.map((e) => e.name);
    expect(names).toContain('Service');
    expect(names).toContain('Runner');
    // Name-based implementation relation survived the degradation.
    expect(
      result.relations.some((r) => r.type === 'implementation' && r.source.endsWith('Service'))
    ).toBe(true);

    // A loud warning was emitted.
    const combined = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(combined).toMatch(/degraded/i);

    await plugin.dispose();
  }, 20000);

  it('config-only (no env): honours atlas.goplsTimeoutMs from archguard.config.json', async () => {
    delete process.env.ARCHGUARD_GOPLS_TIMEOUT_MS;
    await writeFile(
      path.join(tmpDir, 'archguard.config.json'),
      JSON.stringify({ atlas: { goplsTimeoutMs: 200 } })
    );
    spawnMock.mockImplementation((_cmd: string, args: string[]) =>
      args && args[0] === 'version' ? makeVersionProc() : makeServeProc({ hang: true })
    );

    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const plugin = new GoPlugin(nativeParserBackend);
      const start = Date.now();
      await plugin.initialize({ workspaceRoot: tmpDir });
      const result = await plugin.parseProject(tmpDir, {
        workspaceRoot: tmpDir,
        excludePatterns: [],
      });
      const elapsed = Date.now() - start;

      // Bounded by the config-file budget, not the 120s default.
      expect(elapsed).toBeLessThan(15000);
      expect(result.metadata?.goGoplsDegraded).toBe(true);
      // Mechanical proof the config value reached GoplsClient: the budget in
      // the timeout message is exactly the config-file value.
      expect(String(result.metadata?.goGoplsDegradedReason)).toMatch(/budget of 200ms/);
      expect(result.entities.map((e) => e.name)).toContain('Service');

      await plugin.dispose();
    } finally {
      process.chdir(prevCwd);
    }
  }, 20000);

  it('env + config: the env override wins over the config file', async () => {
    process.env.ARCHGUARD_GOPLS_TIMEOUT_MS = '150';
    await writeFile(
      path.join(tmpDir, 'archguard.config.json'),
      JSON.stringify({ atlas: { goplsTimeoutMs: 8000 } })
    );
    spawnMock.mockImplementation((_cmd: string, args: string[]) =>
      args && args[0] === 'version' ? makeVersionProc() : makeServeProc({ hang: true })
    );

    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const plugin = new GoPlugin(nativeParserBackend);
      await plugin.initialize({ workspaceRoot: tmpDir });
      const result = await plugin.parseProject(tmpDir, {
        workspaceRoot: tmpDir,
        excludePatterns: [],
      });

      expect(result.metadata?.goGoplsDegraded).toBe(true);
      // 150ms (env), NOT 8000ms (config): env takes precedence.
      expect(String(result.metadata?.goGoplsDegradedReason)).toMatch(/budget of 150ms/);

      await plugin.dispose();
    } finally {
      process.chdir(prevCwd);
    }
  }, 20000);

  it('is not marked degraded when gopls starts cleanly', async () => {
    spawnMock.mockImplementation((_cmd: string, args: string[]) =>
      args && args[0] === 'version' ? makeVersionProc() : makeServeProc()
    );

    const plugin = new GoPlugin(nativeParserBackend);
    await plugin.initialize({ workspaceRoot: tmpDir });
    const result = await plugin.parseProject(tmpDir, {
      workspaceRoot: tmpDir,
      excludePatterns: [],
    });

    expect(result.metadata?.goGoplsDegraded).toBeUndefined();
    expect(result.metadata?.goGoplsAvailable).toBe(true);
    expect(result.entities.map((e) => e.name)).toContain('Service');

    await plugin.dispose();
  }, 20000);

  // ── TASK-47: resolved config (PluginInitConfig.goplsTimeoutMs) ────────

  it('programmatic goplsTimeoutMs in PluginInitConfig reaches GoplsClient', async () => {
    delete process.env.ARCHGUARD_GOPLS_TIMEOUT_MS;
    spawnMock.mockImplementation((_cmd: string, args: string[]) =>
      args && args[0] === 'version' ? makeVersionProc() : makeServeProc({ hang: true })
    );

    const plugin = new GoPlugin(nativeParserBackend);
    // Pass goplsTimeoutMs via PluginInitConfig — simulates the resolved
    // config flowing through from a custom --config file.
    const start = Date.now();
    await plugin.initialize({ workspaceRoot: tmpDir, goplsTimeoutMs: 250 });
    const result = await plugin.parseProject(tmpDir, {
      workspaceRoot: tmpDir,
      excludePatterns: [],
    });
    const elapsed = Date.now() - start;

    // Bounded by the programmatic budget, not the 120s default.
    expect(elapsed).toBeLessThan(15000);
    expect(result.metadata?.goGoplsDegraded).toBe(true);
    // Mechanical proof: the budget in the error message matches exactly.
    expect(String(result.metadata?.goGoplsDegradedReason)).toMatch(/budget of 250ms/);
    expect(result.entities.map((e) => e.name)).toContain('Service');

    await plugin.dispose();
  }, 20000);

  it('env override wins over programmatic PluginInitConfig.goplsTimeoutMs', async () => {
    process.env.ARCHGUARD_GOPLS_TIMEOUT_MS = '100';
    spawnMock.mockImplementation((_cmd: string, args: string[]) =>
      args && args[0] === 'version' ? makeVersionProc() : makeServeProc({ hang: true })
    );

    const plugin = new GoPlugin(nativeParserBackend);
    // env=100 beats programmatic=5000
    await plugin.initialize({ workspaceRoot: tmpDir, goplsTimeoutMs: 5000 });
    const result = await plugin.parseProject(tmpDir, {
      workspaceRoot: tmpDir,
      excludePatterns: [],
    });

    expect(result.metadata?.goGoplsDegraded).toBe(true);
    expect(String(result.metadata?.goGoplsDegradedReason)).toMatch(/budget of 100ms/);

    await plugin.dispose();
  }, 20000);

  it('cwd config file is still honoured when PluginInitConfig.goplsTimeoutMs is absent', async () => {
    delete process.env.ARCHGUARD_GOPLS_TIMEOUT_MS;
    // Place a config file in tmpDir so the cwd-based fallback finds it.
    await writeFile(
      path.join(tmpDir, 'archguard.config.json'),
      JSON.stringify({ atlas: { goplsTimeoutMs: 300 } })
    );
    spawnMock.mockImplementation((_cmd: string, args: string[]) =>
      args && args[0] === 'version' ? makeVersionProc() : makeServeProc({ hang: true })
    );

    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const plugin = new GoPlugin(nativeParserBackend);
      // NO goplsTimeoutMs in PluginInitConfig — falls back to cwd-based config file.
      await plugin.initialize({ workspaceRoot: tmpDir });
      const result = await plugin.parseProject(tmpDir, {
        workspaceRoot: tmpDir,
        excludePatterns: [],
      });

      expect(result.metadata?.goGoplsDegraded).toBe(true);
      expect(String(result.metadata?.goGoplsDegradedReason)).toMatch(/budget of 300ms/);

      await plugin.dispose();
    } finally {
      process.chdir(prevCwd);
    }
  }, 20000);
});
