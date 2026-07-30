/**
 * Native vs WASM parser parity: canonical AST dumps and full ArchJSON output
 * must be byte-identical between NativeParserBackend and WasmParserBackend
 * for representative fixtures in all five supported languages.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { nativeParserBackend } from '../../../src/plugins/shared/native-parser-backend.js';
import { wasmParserBackend } from '../../../src/plugins/shared/wasm-parser-backend.js';
import type { ParserBackend } from '../../../src/plugins/shared/parser-backend.js';
import type { SyntaxNodeLike } from '../../../src/plugins/shared/syntax-tree.js';
import { GoPlugin } from '../../../src/plugins/golang/index.js';
import { JavaPlugin } from '../../../src/plugins/java/index.js';
import { PythonPlugin } from '../../../src/plugins/python/index.js';
import { CppPlugin } from '../../../src/plugins/cpp/index.js';
import { KotlinPlugin } from '../../../src/plugins/kotlin/index.js';

const FIXTURES = path.resolve(__dirname, '../../fixtures');
const LOCAL_FIXTURES = path.resolve(__dirname, 'fixtures');

interface FixtureCase {
  language: 'go' | 'java' | 'python' | 'cpp' | 'kotlin';
  filePath: string;
}

const CASES: FixtureCase[] = [
  { language: 'go', filePath: path.join(FIXTURES, 'go/sample.go') },
  { language: 'go', filePath: path.join(FIXTURES, 'go-mcp-server/main.go') },
  { language: 'go', filePath: path.join(FIXTURES, 'go-mcp-server/handlers.go') },
  { language: 'java', filePath: path.join(FIXTURES, 'java/simple-class.java') },
  { language: 'java', filePath: path.join(FIXTURES, 'java/inheritance.java') },
  { language: 'java', filePath: path.join(FIXTURES, 'java/annotations.java') },
  { language: 'java', filePath: path.join(FIXTURES, 'java/enum.java') },
  { language: 'java', filePath: path.join(FIXTURES, 'java/interface.java') },
  { language: 'python', filePath: path.join(FIXTURES, 'python/simple-class.py') },
  { language: 'python', filePath: path.join(FIXTURES, 'python/inheritance.py') },
  { language: 'python', filePath: path.join(FIXTURES, 'python/decorators.py') },
  { language: 'python', filePath: path.join(FIXTURES, 'python/async-functions.py') },
  { language: 'python', filePath: path.join(FIXTURES, 'python/type-hints.py') },
  { language: 'python', filePath: path.join(FIXTURES, 'python/module-functions.py') },
  { language: 'cpp', filePath: path.join(LOCAL_FIXTURES, 'sample.cpp') },
  { language: 'kotlin', filePath: path.join(LOCAL_FIXTURES, 'sample.kt') },
];

/** Canonical serialization of a syntax tree: every node, position, and field. */
function dumpNode(node: SyntaxNodeLike): unknown {
  return {
    type: node.type,
    named: node.isNamed,
    start: node.startIndex,
    end: node.endIndex,
    startPos: [node.startPosition.row, node.startPosition.column],
    endPos: [node.endPosition.row, node.endPosition.column],
    children: node.children.map(dumpNode),
  };
}

function parseDump(backend: ParserBackend, testCase: FixtureCase, code: string) {
  return backend.createSession(testCase.language).then((session) => {
    try {
      const tree = session.parse(code);
      try {
        return dumpNode(tree.rootNode);
      } finally {
        tree.dispose();
      }
    } finally {
      session.dispose();
    }
  });
}

describe('native vs WASM canonical AST parity', () => {
  it.each(CASES)('$language: $filePath', async (testCase) => {
    const code = readFileSync(testCase.filePath, 'utf8');
    const [nativeDump, wasmDump] = await Promise.all([
      parseDump(nativeParserBackend, testCase, code),
      parseDump(wasmParserBackend, testCase, code),
    ]);
    expect(wasmDump).toEqual(nativeDump);
  });
});

describe('native vs WASM ArchJSON parity', () => {
  const archjsonByKey = new Map<string, { native: string; wasm: string }>();

  beforeAll(async () => {
    const workspaceRoot = path.join(FIXTURES, 'go');
    for (const backendKind of ['native', 'wasm'] as const) {
      const backend = backendKind === 'native' ? nativeParserBackend : wasmParserBackend;

      const go = new GoPlugin(backend);
      await go.initialize({ workspaceRoot } as never);
      const java = new JavaPlugin(backend);
      await java.initialize({ workspaceRoot } as never);
      const python = new PythonPlugin(backend);
      await python.initialize({ workspaceRoot } as never);
      const cpp = new CppPlugin(backend);
      await cpp.initialize({ workspaceRoot } as never);
      const kotlin = new KotlinPlugin(backend);
      await kotlin.initialize({ workspaceRoot } as never);

      for (const testCase of CASES) {
        const code = readFileSync(testCase.filePath, 'utf8');
        const key = `${testCase.language}:${path.basename(testCase.filePath)}`;
        const plugins = { go, java, python, cpp, kotlin };
        const archjson = plugins[testCase.language].parseCode(code, testCase.filePath);
        const entry = archjsonByKey.get(key) ?? { native: '', wasm: '' };
        // Normalize wall-clock fields: parity is about parser-derived content.
        entry[backendKind] = JSON.stringify(archjson).replaceAll(
          /"timestamp":"[^"]*"/g,
          '"timestamp":"<normalized>"'
        );
        archjsonByKey.set(key, entry);
      }

      go.dispose?.();
      java.dispose?.();
      python.dispose?.();
      cpp.dispose?.();
      kotlin.dispose?.();
    }
  }, 120_000);

  it.each(CASES)('$language: $filePath produces identical ArchJSON', (testCase) => {
    const key = `${testCase.language}:${path.basename(testCase.filePath)}`;
    const entry = archjsonByKey.get(key);
    expect(entry).toBeDefined();
    expect(entry!.wasm).toBe(entry!.native);
  });
});
