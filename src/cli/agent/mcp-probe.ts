import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface McpProbeOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  teardownSignal?: 'SIGTERM' | 'SIGKILL';
}

export interface McpProbeResult {
  ok: boolean;
  toolNames: string[];
  stderr: string;
  error?: string;
  pid?: number;
  teardownMs: number;
}

export async function probeMcpListTools(options: McpProbeOptions = {}): Promise<McpProbeResult> {
  const command = options.command ?? process.execPath;
  const args = options.args ?? ['dist/cli/index.js', 'mcp'];
  const timeoutMs = options.timeoutMs ?? 5000;
  const transport = new StdioClientTransport({
    command,
    args,
    cwd: options.cwd ?? process.cwd(),
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk: Buffer | string) => {
    stderr += String(chunk);
  });

  const client = new Client({ name: 'archguard-config-doctor', version: '1.0.0' });
  const startedAt = Date.now();
  let pid: number | null = null;
  try {
    const result = await withTimeout(
      (async (): Promise<string[]> => {
        await client.connect(transport);
        pid = transport.pid;
        const tools = await client.listTools();
        return tools.tools.map((tool) => tool.name);
      })(),
      timeoutMs,
      'Timed out while probing ArchGuard MCP stdio server.'
    );
    const teardownMs = await closeTransport(transport, pid, options.teardownSignal);
    return {
      ok: true,
      toolNames: result,
      stderr,
      ...(pid ? { pid } : {}),
      teardownMs,
    };
  } catch (error) {
    pid = transport.pid;
    const teardownMs = await closeTransport(transport, pid, options.teardownSignal);
    return {
      ok: false,
      toolNames: [],
      stderr,
      error: error instanceof Error ? error.message : String(error),
      ...(pid ? { pid } : {}),
      teardownMs: Date.now() - startedAt < teardownMs ? teardownMs : teardownMs,
    };
  }
}

async function closeTransport(
  transport: StdioClientTransport,
  pid: number | null,
  teardownSignal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'
): Promise<number> {
  const startedAt = Date.now();
  await withTimeout(transport.close(), 500, 'Timed out while closing MCP transport.').catch(() => {
    if (pid && isProcessAlive(pid)) process.kill(pid, teardownSignal);
  });
  if (pid && isProcessAlive(pid)) {
    process.kill(pid, 'SIGKILL');
  }
  return Date.now() - startedAt;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
