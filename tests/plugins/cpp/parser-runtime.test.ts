import { describe, expect, it, vi } from 'vitest';
import { NativeParserBackend } from '../../../src/plugins/shared/native-parser-backend.js';
import {
  ParserInitializationError,
  type ParserBackend,
} from '../../../src/plugins/shared/parser-backend.js';
import { CppPlugin } from '../../../src/plugins/cpp/index.js';
import type { ParserSession, SyntaxNodeLike } from '../../../src/plugins/shared/syntax-tree.js';
import { TreeSitterBridge } from '../../../src/plugins/cpp/tree-sitter-bridge.js';

describe('parser runtime facade', () => {
  it('creates contextualized native sessions for every supported language', async () => {
    const backend = new NativeParserBackend();
    for (const language of ['go', 'java', 'python', 'cpp', 'kotlin'] as const) {
      const session = await backend.createSession(language);
      expect(session.language).toBe(language);
      expect(session.runtime).toBe('native');
      session.dispose();
    }
  });

  it('rejects parsing after session disposal', async () => {
    const session = await new NativeParserBackend().createSession('cpp');
    session.dispose();
    expect(() => session.parse('class Foo {};')).toThrow('cpp parser session has been disposed');
  });

  it('retains language and backend context on initialization errors', async () => {
    const cause = new Error('grammar unavailable');
    const backend: ParserBackend = {
      runtime: 'native',
      createSession: async (language) => {
        throw new ParserInitializationError(language, 'native', cause);
      },
    };

    await expect(
      new CppPlugin(backend).initialize({ workspaceRoot: '/tmp' })
    ).rejects.toMatchObject({
      language: 'cpp',
      backend: 'native',
      cause,
    });
  });

  it('disposes each syntax tree even when extraction throws', () => {
    const dispose = vi.fn();
    const rootNode = {
      namedChildren: [
        {
          type: 'namespace_definition',
          childForFieldName: () => {
            throw new Error('extraction failed');
          },
        },
      ],
    } as unknown as SyntaxNodeLike;
    const session = {
      language: 'cpp',
      runtime: 'native',
      parse: () => ({ rootNode, dispose }),
      dispose: vi.fn(),
    } satisfies ParserSession;

    expect(() => new TreeSitterBridge(session).parseCode('namespace x {}', 'x.cpp')).toThrow(
      'extraction failed'
    );
    expect(dispose).toHaveBeenCalledOnce();
  });
});
