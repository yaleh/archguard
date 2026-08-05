import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { nativeParserBackend } from '@/plugins/shared/native-parser-backend.js';
import {
  CaptureMapper,
  collectNamespace,
  type CaptureGroup,
} from '@/plugins/shared/capture-mapper.js';
import type { ParserQueryLike, ParserSession } from '@/plugins/shared/syntax-tree.js';

/** Concrete subclass that extracts node text from a `@name` capture. */
class TextCaptureMapper extends CaptureMapper<string> {
  protected mapCapture(group: CaptureGroup, _filePath: string): string | null {
    const node = group['name'];
    return node ? node.text : null;
  }
}

describe('CaptureMapper', () => {
  let session: ParserSession;
  let nameQuery: ParserQueryLike;

  beforeAll(async () => {
    session = await nativeParserBackend.createSession('cpp');
    nameQuery = session.query('(class_specifier name: (type_identifier) @name)');
  });

  afterAll(() => {
    session.dispose();
  });

  it('iterates all matches and extracts node text via a concrete subclass', () => {
    const mapper = new TextCaptureMapper(nameQuery);
    const tree = session.parse('class Foo {};\nclass Bar {};');
    try {
      expect(mapper.runQuery(tree.rootNode, 'test.hpp')).toEqual(['Foo', 'Bar']);
    } finally {
      tree.dispose();
    }
  });

  it('skips null mappings', () => {
    class SkipMapper extends CaptureMapper<string> {
      protected mapCapture(group: CaptureGroup, _filePath: string): string | null {
        const node = group['name'];
        if (!node) return null;
        return node.text === 'Skip' ? null : node.text;
      }
    }
    const mapper = new SkipMapper(nameQuery);
    const tree = session.parse('class Skip {};\nclass Keep {};');
    try {
      expect(mapper.runQuery(tree.rootNode, 'test.hpp')).toEqual(['Keep']);
    } finally {
      tree.dispose();
    }
  });

  it('groups captures into a CaptureGroup keyed by capture name', () => {
    const query = session.query('(class_specifier name: (type_identifier) @name) @spec');
    const seenKeys: string[] = [];
    class GroupMapper extends CaptureMapper<string> {
      protected mapCapture(group: CaptureGroup, _filePath: string): string | null {
        seenKeys.push(Object.keys(group).sort().join(','));
        return group['name']?.text ?? null;
      }
    }
    const mapper = new GroupMapper(query);
    const tree = session.parse('class Foo {};');
    try {
      mapper.runQuery(tree.rootNode, 't.cpp');
      expect(seenKeys).toContain('name,spec');
    } finally {
      tree.dispose();
    }
  });
});

describe('collectNamespace', () => {
  let session: ParserSession;

  beforeAll(async () => {
    session = await nativeParserBackend.createSession('cpp');
  });

  afterAll(() => {
    session.dispose();
  });

  it('walks nested namespace_definition ancestors outermost-first', () => {
    const tree = session.parse('namespace a { namespace b { class C {}; } }');
    try {
      const classNode = walkToClass(tree.rootNode);
      expect(classNode.type).toBe('class_specifier');
      expect(collectNamespace(classNode)).toBe('a::b');
    } finally {
      tree.dispose();
    }
  });

  it('returns empty string for global-scope nodes', () => {
    const tree = session.parse('class C {};');
    try {
      const classNode = tree.rootNode.namedChildren[0];
      expect(collectNamespace(classNode)).toBe('');
    } finally {
      tree.dispose();
    }
  });
});

function walkToClass(root: SyntaxNodeLike): SyntaxNodeLike {
  const outer = root.namedChildren.find((n) => n.type === 'namespace_definition');
  const inner = outer
    ?.childForFieldName('body')
    ?.namedChildren.find((n) => n.type === 'namespace_definition');
  const cls = inner
    ?.childForFieldName('body')
    ?.namedChildren.find((n) => n.type === 'class_specifier');
  if (!cls) throw new Error('expected class C inside nested namespaces');
  return cls;
}
