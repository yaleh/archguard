import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAnalyzeCommand } from '@/cli/commands/analyze.js';
import { createMcpServer } from '@/cli/mcp/mcp-server.js';

describe('CLI / MCP analyze equivalence', () => {
  let tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await fs.remove(dir);
    }
    tmpDirs = [];
  });

  it('produces equivalent query and output artifacts for the same project', async () => {
    const projectRoot = await createFixtureProject();

    await runCliAnalyze(projectRoot);
    const cliSnapshot = await snapshotArchguard(projectRoot);

    await fs.remove(path.join(projectRoot, '.archguard'));
    await runMcpAnalyze(projectRoot);
    const mcpSnapshot = await snapshotArchguard(projectRoot);

    expect(mcpSnapshot.files).toEqual(cliSnapshot.files);
    expect(mcpSnapshot.contents).toEqual(cliSnapshot.contents);
  });

  async function createFixtureProject(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-cli-mcp-'));
    tmpDirs.push(root);
    await fs.writeJson(path.join(root, 'package.json'), {
      name: 'fixture-project',
      private: true,
      type: 'module',
    });
    await fs.ensureDir(path.join(root, 'src'));
    await fs.writeJson(path.join(root, 'archguard.config.json'), {
      diagrams: [
        {
          name: 'overview',
          level: 'package',
          sources: ['./src'],
        },
        {
          name: 'classes',
          level: 'class',
          sources: ['./src'],
        },
      ],
    });
    await fs.writeFile(
      path.join(root, 'src', 'index.ts'),
      [
        "import { Helper } from './helper.js';",
        '',
        'export class App {',
        '  helper = new Helper();',
        '',
        '  run(): string {',
        '    return this.helper.message();',
        '  }',
        '}',
        '',
      ].join('\n')
    );
    await fs.writeFile(
      path.join(root, 'src', 'helper.ts'),
      ['export class Helper {', '  message(): string {', "    return 'ok';", '  }', '}', ''].join(
        '\n'
      )
    );
    return root;
  }

  async function runCliAnalyze(root: string): Promise<void> {
    const previousCwd = process.cwd();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    try {
      process.chdir(root);
      const command = createAnalyzeCommand();
      await command.parseAsync(['node', 'archguard', '--format', 'json']);
      expect(exitSpy).toHaveBeenLastCalledWith(0);
    } finally {
      process.chdir(previousCwd);
      exitSpy.mockRestore();
    }
  }

  async function runMcpAnalyze(root: string): Promise<void> {
    const previousCwd = process.cwd();

    try {
      process.chdir(root);
      const server = createMcpServer(root);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'test-client', version: '1.0.0' });

      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      await client.callTool({
        name: 'archguard_analyze',
        arguments: {
          format: 'json',
        },
      });
      await clientTransport.close();
    } finally {
      process.chdir(previousCwd);
    }
  }

  async function snapshotArchguard(
    root: string
  ): Promise<{ files: string[]; contents: Record<string, string> }> {
    const archRoot = path.join(root, '.archguard');
    const files = await collectFiles(archRoot);
    const contents: Record<string, string> = {};
    for (const file of files) {
      const fullPath = path.join(archRoot, file);
      contents[file] = normalizeArtifact(await fs.readFile(fullPath, 'utf-8'), root);
    }
    return { files, contents };
  }

  async function collectFiles(root: string): Promise<string[]> {
    const entries: string[] = [];
    async function walk(current: string) {
      const children = await fs.readdir(current);
      for (const child of children.sort()) {
        const fullPath = path.join(current, child);
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          await walk(fullPath);
        } else {
          entries.push(path.relative(root, fullPath).replace(/\\/g, '/'));
        }
      }
    }
    await walk(root);
    return entries;
  }

  function normalizeArtifact(content: string, root: string): string {
    const normalizedRoot = root.replace(/\\/g, '/');
    const value = content.replaceAll(normalizedRoot, '<ROOT>');
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      scrub(parsed);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return value
        .replace(/"generatedAt":\s*"[^"]+"/g, '"generatedAt":"<TIME>"')
        .replace(/"createdAt":\s*"[^"]+"/g, '"createdAt":"<TIME>"')
        .replace(/"timestamp":\s*"[^"]+"/g, '"timestamp":"<TIME>"')
        .replace(/"lastRun":\s*"[^"]+"/g, '"lastRun":"<TIME>"')
        .replace(/"archJsonHash":\s*"[^"]+"/g, '"archJsonHash":"<HASH>"');
    }
  }

  function scrub(value: unknown): void {
    if (!value || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(scrub);
      return;
    }
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (
        key === 'generatedAt' ||
        key === 'createdAt' ||
        key === 'timestamp' ||
        key === 'lastRun'
      ) {
        record[key] = '<TIME>';
      } else if (key === 'archJsonHash') {
        record[key] = '<HASH>';
      } else {
        scrub(record[key]);
      }
    }
  }
});
