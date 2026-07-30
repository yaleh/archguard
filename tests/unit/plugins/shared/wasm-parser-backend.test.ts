import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WasmParserBackend,
  resetWasmParserRuntimeCache,
  wasmParserBackend,
} from '@/plugins/shared/wasm-parser-backend.js';
import {
  ParserInitializationError,
  resolveParserBackend,
} from '@/plugins/shared/parser-backend.js';
import type { ParserLanguage } from '@/plugins/shared/parser-backend.js';
import type { ParserSession } from '@/plugins/shared/syntax-tree.js';

const SNIPPETS: Record<ParserLanguage, { code: string; rootType: string }> = {
  go: { code: 'package main\n\nfunc main() {}\n', rootType: 'source_file' },
  java: { code: 'class A {}\n', rootType: 'program' },
  python: { code: 'def f():\n    pass\n', rootType: 'module' },
  cpp: { code: 'int main() { return 0; }\n', rootType: 'translation_unit' },
  kotlin: { code: 'fun main() {}\n', rootType: 'source_file' },
};

const ALL_LANGUAGES = Object.keys(SNIPPETS) as ParserLanguage[];

describe('WasmParserBackend', () => {
  const sessions: ParserSession[] = [];

  afterEach(() => {
    while (sessions.length > 0) sessions.pop()?.dispose();
    resetWasmParserRuntimeCache();
  });

  it('exposes the wasm runtime kind', () => {
    const backend = new WasmParserBackend();
    expect(backend.runtime).toBe('wasm');
  });

  it.each(ALL_LANGUAGES)('parses %s through the ParserSession facade', async (language) => {
    const session = await new WasmParserBackend().createSession(language);
    sessions.push(session);

    expect(session.language).toBe(language);
    expect(session.runtime).toBe('wasm');

    const tree = session.parse(SNIPPETS[language].code);
    try {
      expect(tree.rootNode.type).toBe(SNIPPETS[language].rootType);
      expect(tree.rootNode.startIndex).toBe(0);
      expect(tree.rootNode.endIndex).toBe(SNIPPETS[language].code.length);
    } finally {
      tree.dispose();
    }
  });

  it('exposes the full SyntaxNodeLike surface consumed by extractors', async () => {
    const session = await new WasmParserBackend().createSession('go');
    sessions.push(session);

    const code = 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println() }\n';
    const tree = session.parse(code);
    try {
      const root = tree.rootNode;
      expect(root.isNamed).toBe(true);
      expect(root.parent).toBeNull();
      expect(root.namedChildCount).toBeGreaterThan(0);
      expect(root.namedChild(0)?.type).toBe('package_clause');
      expect(root.namedChild(0)?.parent?.type).toBe('source_file');

      const importDecls = root.descendantsOfType('import_declaration');
      expect(importDecls).toHaveLength(1);
      expect(importDecls[0].text).toBe('import "fmt"');
      expect(importDecls[0].startPosition).toEqual({ row: 2, column: 0 });

      const pathNode = importDecls[0].descendantsOfType('import_spec')[0].childForFieldName('path');
      expect(pathNode?.text).toBe('"fmt"');

      const funcs = root.descendantsOfType(['function_declaration', 'method_declaration']);
      expect(funcs.map((f) => f.type)).toEqual(['function_declaration']);

      expect(Array.isArray(root.children)).toBe(true);
      expect(Array.isArray(root.namedChildren)).toBe(true);
      expect(root.children.length).toBeGreaterThanOrEqual(root.namedChildren.length);
    } finally {
      tree.dispose();
    }
  });

  it('supports repeated parse/dispose cycles on one session', async () => {
    const session = await new WasmParserBackend().createSession('python');
    sessions.push(session);

    for (let i = 0; i < 5; i++) {
      const tree = session.parse('x = 1\n');
      expect(tree.rootNode.type).toBe('module');
      tree.dispose();
      tree.dispose(); // idempotent
    }
  });

  it('rejects parsing after the session is disposed', async () => {
    const session = await new WasmParserBackend().createSession('go');
    session.dispose();
    session.dispose(); // idempotent
    expect(() => session.parse('package main\n')).toThrow(/disposed/);
  });

  it('caches Language.load per language across sessions', async () => {
    const backend = new WasmParserBackend();
    expect(backend.cachedLanguageCount).toBe(0);

    const first = await backend.createSession('go');
    const second = await backend.createSession('go');
    const third = await backend.createSession('java');
    sessions.push(first, second, third);

    expect(backend.cachedLanguageCount).toBe(2);
  });

  it('shares process-lifetime runtime and language caches across backend instances', async () => {
    const firstBackend = new WasmParserBackend();
    const secondBackend = new WasmParserBackend();
    const first = await firstBackend.createSession('python');
    const second = await secondBackend.createSession('python');
    sessions.push(first, second);

    expect(firstBackend.cachedLanguageCount).toBe(secondBackend.cachedLanguageCount);
    expect(secondBackend.cachedLanguageCount).toBeGreaterThanOrEqual(1);
  });

  it('resolves grammar assets independent of process.cwd()', async () => {
    const originalCwd = process.cwd();
    const scratch = mkdtempSync(join(tmpdir(), 'archguard-wasm-cwd-'));
    process.chdir(scratch);
    try {
      const session = await new WasmParserBackend().createSession('kotlin');
      sessions.push(session);
      const tree = session.parse(SNIPPETS.kotlin.code);
      try {
        expect(tree.rootNode.type).toBe(SNIPPETS.kotlin.rootType);
      } finally {
        tree.dispose();
      }
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('fails with ParserInitializationError when grammar assets are missing', async () => {
    const backend = new WasmParserBackend({ assetsDir: '/nonexistent/archguard-assets' });
    await expect(backend.createSession('go')).rejects.toThrow(ParserInitializationError);
    await expect(backend.createSession('go')).rejects.toThrow(/wasm/);
    await expect(backend.createSession('go')).rejects.toThrow(/go/);
  });
});

describe('resolveParserBackend (forced-WASM mode)', () => {
  afterEach(() => {
    delete process.env.ARCHGUARD_PARSER_BACKEND;
  });

  it('returns the wasm backend when explicitly requested', async () => {
    const backend = await resolveParserBackend('wasm');
    expect(backend.runtime).toBe('wasm');
    expect(backend).toBe(wasmParserBackend);
  });

  it('defaults to the native backend', async () => {
    const backend = await resolveParserBackend();
    expect(backend.runtime).toBe('native');
  });

  it('honours ARCHGUARD_PARSER_BACKEND=wasm', async () => {
    process.env.ARCHGUARD_PARSER_BACKEND = 'wasm';
    const backend = await resolveParserBackend();
    expect(backend.runtime).toBe('wasm');
  });

  it('rejects unknown backend kinds', async () => {
    process.env.ARCHGUARD_PARSER_BACKEND = 'bogus';
    await expect(resolveParserBackend()).rejects.toThrow(/ARCHGUARD_PARSER_BACKEND/);
  });
});
