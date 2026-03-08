import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAnalyzeCommand } from '@/cli/commands/analyze.js';
import { createMcpServer } from '@/cli/mcp/mcp-server.js';

describe('Default language scopes', () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await fs.remove(dir);
    }
    tmpDirs.length = 0;
  });

  it('default CLI analysis discovers multiple language scopes and keeps cpp as global', async () => {
    const root = await createMultiLanguageProject(tmpDirs);

    await runCliAnalyze(root);

    const manifest = await fs.readJson(path.join(root, '.archguard', 'query', 'manifest.json'));
    const languages = manifest.scopes.map((scope: { language: string }) => scope.language).sort();

    expect(languages).toContain('cpp');
    expect(languages).toContain('python');
    expect(languages).toContain('typescript');

    const globalScope = manifest.scopes.find(
      (scope: { key: string }) => scope.key === manifest.globalScopeKey
    );
    expect(globalScope.language).toBe('cpp');
  });

  it('MCP can query the global scope and explicit secondary scopes after incremental analysis', async () => {
    const root = await createMultiLanguageProject(tmpDirs);

    await runCliAnalyze(root);

    const server = createMcpServer(root);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1.0.0' });

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      const defaultSummary = await client.callTool({
        name: 'archguard_summary',
        arguments: { projectRoot: root },
      });
      expect(JSON.parse(defaultSummary.content[0].text as string).language).toBe('cpp');

      const initialManifest = await fs.readJson(
        path.join(root, '.archguard', 'query', 'manifest.json')
      );
      const tsScope = initialManifest.scopes.find(
        (scope: { language: string }) => scope.language === 'typescript'
      );
      const pythonRootScope = initialManifest.scopes.find(
        (scope: { language: string }) => scope.language === 'python'
      );

      const tsSummary = await client.callTool({
        name: 'archguard_summary',
        arguments: { projectRoot: root, scope: tsScope.key },
      });
      expect(JSON.parse(tsSummary.content[0].text as string).language).toBe('typescript');

      const analyzeResult = await client.callTool({
        name: 'archguard_analyze',
        arguments: {
          projectRoot: root,
          lang: 'python',
          sources: ['./gguf-py'],
          format: 'json',
        },
      });
      expect(analyzeResult.content[0].text).toContain('Analysis completed');

      const mergedManifest = await fs.readJson(
        path.join(root, '.archguard', 'query', 'manifest.json')
      );
      expect(mergedManifest.globalScopeKey).toBe(initialManifest.globalScopeKey);
      const explicitPythonScope = mergedManifest.scopes.find(
        (scope: { language: string; sources: string[] }) =>
          scope.language === 'python' && scope.sources.some((source) => source.endsWith('/gguf-py'))
      );

      expect(explicitPythonScope).toBeDefined();
      expect(explicitPythonScope.key).not.toBe(pythonRootScope.key);

      const explicitPythonSummary = await client.callTool({
        name: 'archguard_summary',
        arguments: { projectRoot: root, scope: explicitPythonScope.key },
      });
      expect(JSON.parse(explicitPythonSummary.content[0].text as string).language).toBe('python');
    } finally {
      await clientTransport.close();
    }
  });
});

async function createMultiLanguageProject(tmpDirs: string[]): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-default-language-scopes-'));
  tmpDirs.push(root);

  await fs.writeFile(path.join(root, 'CMakeLists.txt'), 'project(multilang)\n');
  await fs.ensureDir(path.join(root, 'src'));
  await fs.writeFile(
    path.join(root, 'src', 'main.cpp'),
    [
      '#include "engine.h"',
      '',
      'int main() {',
      '  Engine engine;',
      '  return engine.run();',
      '}',
      '',
    ].join('\n')
  );
  await fs.writeFile(
    path.join(root, 'src', 'engine.h'),
    ['class Engine {', 'public:', '  int run();', '};', ''].join('\n')
  );
  await fs.writeFile(
    path.join(root, 'src', 'engine.cpp'),
    ['#include "engine.h"', '', 'int Engine::run() {', '  return 0;', '}', ''].join('\n')
  );

  await fs.writeFile(path.join(root, 'requirements.txt'), 'pytest\n');
  await fs.writeFile(
    path.join(root, 'convert.py'),
    ['class RootConverter:', '    def run(self) -> str:', "        return 'ok'", ''].join('\n')
  );
  await fs.ensureDir(path.join(root, 'gguf-py'));
  await fs.writeFile(
    path.join(root, 'gguf-py', 'converter.py'),
    ['class GgufConverter:', '    def transform(self) -> str:', "        return 'gguf'", ''].join(
      '\n'
    )
  );

  await fs.ensureDir(path.join(root, 'tools', 'server', 'webui', 'src'));
  await fs.writeJson(path.join(root, 'tools', 'server', 'webui', 'package.json'), {
    name: 'webui',
    private: true,
    type: 'module',
  });
  await fs.writeJson(path.join(root, 'tools', 'server', 'webui', 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
    },
  });
  await fs.writeFile(
    path.join(root, 'tools', 'server', 'webui', 'src', 'app.ts'),
    ['export class WebUiApp {', '  render(): string {', "    return 'webui';", '  }', '}', ''].join(
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
