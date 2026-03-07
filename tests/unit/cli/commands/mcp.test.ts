import { afterEach, describe, expect, it, vi } from 'vitest';

const startMcpServerMock = vi.fn();

vi.mock('@/cli/mcp/mcp-server.js', () => ({
  startMcpServer: startMcpServerMock,
}));

describe('createMcpCommand', () => {
  afterEach(() => {
    startMcpServerMock.mockReset();
  });

  it('starts the MCP server with process.cwd()', async () => {
    const { createMcpCommand } = await import('@/cli/commands/mcp.js');
    const cmd = createMcpCommand();

    await cmd.parseAsync(['node', 'mcp'], { from: 'node' });

    expect(startMcpServerMock).toHaveBeenCalledWith(process.cwd());
  });

  it('rejects removed --arch-dir option', async () => {
    const { createMcpCommand } = await import('@/cli/commands/mcp.js');
    const cmd = createMcpCommand();
    cmd.exitOverride();

    await expect(
      cmd.parseAsync(['node', 'mcp', '--arch-dir', '/tmp/custom'], { from: 'node' }),
    ).rejects.toMatchObject({
      code: 'commander.unknownOption',
    });
  });

  it('rejects removed --scope option', async () => {
    const { createMcpCommand } = await import('@/cli/commands/mcp.js');
    const cmd = createMcpCommand();
    cmd.exitOverride();

    await expect(
      cmd.parseAsync(['node', 'mcp', '--scope', 'frontend'], { from: 'node' }),
    ).rejects.toMatchObject({
      code: 'commander.unknownOption',
    });
  });
});
