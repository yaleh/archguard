import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAnalyzeCommand } from '@/cli/commands/analyze.js';
import { createMcpServer } from '@/cli/mcp/mcp-server.js';

describe('MCP cross-project queries', () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await fs.remove(dir);
    }
    tmpDirs.length = 0;
  });

  it('can alternate query and analyze across projects without restarting the server', async () => {
    const projectA = await createFixtureProject(tmpDirs, 'alpha-project', 'AlphaApp', 'AlphaHelper');
    const projectB = await createFixtureProject(tmpDirs, 'beta-project', 'BetaApp', 'BetaHelper');

    await runCliAnalyze(projectA);
    await runCliAnalyze(projectB);

    const server = createMcpServer(projectA);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1.0.0' });

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      const defaultSummary = await client.callTool({ name: 'archguard_summary', arguments: {} });
      const defaultParsed = JSON.parse(defaultSummary.content[0].text as string);
      expect(defaultParsed.language).toBe('typescript');

      const projectAEntity = await client.callTool({
        name: 'archguard_find_entity',
        arguments: { name: 'AlphaApp' },
      });
      expect(JSON.parse(projectAEntity.content[0].text as string)).toHaveLength(1);

      const projectBEntity = await client.callTool({
        name: 'archguard_find_entity',
        arguments: { projectRoot: projectB, name: 'BetaApp' },
      });
      const projectBParsed = JSON.parse(projectBEntity.content[0].text as string);
      expect(projectBParsed).toHaveLength(1);
      expect(projectBParsed[0].name).toBe('BetaApp');

      await fs.remove(path.join(projectB, '.archguard'));
      const analyzeResult = await client.callTool({
        name: 'archguard_analyze',
        arguments: { projectRoot: projectB, format: 'json' },
      });
      expect(analyzeResult.content[0].text).toContain('Analysis completed');

      const projectBAfterAnalyze = await client.callTool({
        name: 'archguard_find_entity',
        arguments: { projectRoot: projectB, name: 'BetaApp' },
      });
      expect(JSON.parse(projectBAfterAnalyze.content[0].text as string)).toHaveLength(1);

      const projectAAfterAnalyze = await client.callTool({
        name: 'archguard_find_entity',
        arguments: { name: 'AlphaApp' },
      });
      expect(JSON.parse(projectAAfterAnalyze.content[0].text as string)).toHaveLength(1);
    } finally {
      await clientTransport.close();
    }
  });
});

async function createFixtureProject(
  tmpDirs: string[],
  packageName: string,
  appName: string,
  helperName: string,
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-mcp-cross-project-'));
  tmpDirs.push(root);
  await fs.writeJson(path.join(root, 'package.json'), {
    name: packageName,
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
      `import { ${helperName} } from './helper.js';`,
      '',
      `export class ${appName} {`,
      `  helper = new ${helperName}();`,
      '',
      '  run(): string {',
      '    return this.helper.message();',
      '  }',
      '}',
      '',
    ].join('\n'),
  );
  await fs.writeFile(
    path.join(root, 'src', 'helper.ts'),
    [
      `export class ${helperName} {`,
      '  message(): string {',
      `    return '${packageName}';`,
      '  }',
      '}',
      '',
    ].join('\n'),
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
