import { describe, it, expect, beforeAll } from 'vitest';
import { FunctionExtractor } from '../../../src/parser/function-extractor.js';
import { TypeScriptParser } from '../../../src/parser/typescript-parser.js';
import { Project } from 'ts-morph';

describe('FunctionExtractor', () => {
  let project: Project;

  beforeAll(() => {
    project = new Project({ useInMemoryFileSystem: true, compilerOptions: { target: 99 } });
  });

  function extractFromCode(code: string, filePath = 'src/cli/foo.ts') {
    const sourceFile = project.createSourceFile(filePath, code, { overwrite: true });
    const extractor = new FunctionExtractor();
    return extractor.extract(sourceFile, filePath);
  }

  it('extracts an exported named function declaration', () => {
    const entities = extractFromCode('export function foo(a: string): void {}');
    expect(entities).toHaveLength(1);
    expect(entities[0].id).toBe('src/cli/foo.ts.foo');
    expect(entities[0].name).toBe('foo');
    expect(entities[0].type).toBe('function');
    expect(entities[0].visibility).toBe('public');
  });

  it('extracts an exported arrow function const', () => {
    const entities = extractFromCode('export const bar = (x: number): number => x * 2;');
    expect(entities).toHaveLength(1);
    expect(entities[0].id).toBe('src/cli/foo.ts.bar');
    expect(entities[0].name).toBe('bar');
    expect(entities[0].type).toBe('function');
  });

  it('extracts an exported function expression const', () => {
    const entities = extractFromCode(
      'export const baz = function(y: string): string { return y; };'
    );
    expect(entities).toHaveLength(1);
    expect(entities[0].id).toBe('src/cli/foo.ts.baz');
    expect(entities[0].type).toBe('function');
  });

  it('does not extract unexported function declarations', () => {
    const entities = extractFromCode('function internal(): void {}');
    expect(entities).toHaveLength(0);
  });

  it('does not extract unexported const arrow functions', () => {
    const entities = extractFromCode('const hidden = (): void => {};');
    expect(entities).toHaveLength(0);
  });

  it('extracts only exported functions from a mixed file', () => {
    const code = `
      export function publicFn(): void {}
      function privateFn(): void {}
      export const publicArrow = () => {};
      const privateArrow = () => {};
    `;
    const entities = extractFromCode(code);
    expect(entities).toHaveLength(2);
    expect(entities.map((e) => e.name)).toContain('publicFn');
    expect(entities.map((e) => e.name)).toContain('publicArrow');
  });

  it('collectEntitySources enumerates exactly the declarations extract() turns into entities', () => {
    const code = `
      export function publicFn(): void {}
      function privateFn(): void {}
      export const publicArrow = () => {};
      const privateArrow = () => {};
    `;
    const sourceFile = project.createSourceFile('src/enumerate.ts', code, { overwrite: true });
    const extractor = new FunctionExtractor();
    const sources = extractor.collectEntitySources(sourceFile, 'src/enumerate.ts');
    const entities = extractor.extract(sourceFile, 'src/enumerate.ts');

    expect(sources.map((s) => s.id)).toEqual(entities.map((e) => e.id));
    expect(sources.map((s) => s.name).sort()).toEqual(['publicArrow', 'publicFn']);
  });

  it('extracts function parameters as members', () => {
    const entities = extractFromCode(
      'export function greet(name: string, age: number): string { return name; }'
    );
    expect(entities[0].members).toHaveLength(2);
    expect(entities[0].members[0].name).toBe('name');
    expect(entities[0].members[1].name).toBe('age');
  });

  it('includes sourceLocation with correct file and line numbers', () => {
    const entities = extractFromCode('export function foo(): void {}', 'src/cli/commands.ts');
    expect(entities[0].sourceLocation.file).toBe('src/cli/commands.ts');
    expect(entities[0].sourceLocation.startLine).toBeGreaterThanOrEqual(1);
  });

  describe('HOC-wrapped components', () => {
    it('unwraps a memo-wrapped arrow function const', () => {
      const entities = extractFromCode(
        'export const MessageComponent = memo((props: { text: string }) => props.text);',
        'src/components/Message.tsx'
      );
      expect(entities).toHaveLength(1);
      expect(entities[0].id).toBe('src/components/Message.tsx.MessageComponent');
      expect(entities[0].name).toBe('MessageComponent');
      expect(entities[0].type).toBe('function');
      expect(entities[0].members.map((m) => m.name)).toEqual(['props']);
    });

    it('unwraps a forwardRef-wrapped function expression const', () => {
      const entities = extractFromCode(
        'export const ToolGroup = forwardRef<HTMLDivElement, { label: string }>(function ToolGroup(props, ref) { return null; });',
        'src/components/ToolGroup.tsx'
      );
      expect(entities).toHaveLength(1);
      expect(entities[0].name).toBe('ToolGroup');
      expect(entities[0].type).toBe('function');
      expect(entities[0].members.map((m) => m.name)).toEqual(['props', 'ref']);
    });

    it('unwraps React.memo-wrapped arrow functions', () => {
      const entities = extractFromCode(
        'export const ChatMessagesPane = React.memo((props) => props);',
        'src/components/ChatMessagesPane.tsx'
      );
      expect(entities).toHaveLength(1);
      expect(entities[0].name).toBe('ChatMessagesPane');
    });

    it('unwraps React.forwardRef-wrapped arrow functions', () => {
      const entities = extractFromCode(
        'export const ChatInterface = React.forwardRef<HTMLDivElement, {}>((props, ref) => null);',
        'src/components/ChatInterface.tsx'
      );
      expect(entities).toHaveLength(1);
      expect(entities[0].name).toBe('ChatInterface');
    });

    it('unwraps nested wrappers such as memo(forwardRef(...))', () => {
      const entities = extractFromCode(
        'export const Markdown = memo(forwardRef<HTMLDivElement, {}>((props, ref) => null));',
        'src/components/Markdown.tsx'
      );
      expect(entities).toHaveLength(1);
      expect(entities[0].name).toBe('Markdown');
    });

    it('produces entities for HOC-wrapped named function references', () => {
      const entities = extractFromCode(
        `
          function Plain(props: { text: string }) { return props.text; }
          function Forwarded(props: { text: string }, ref: unknown) { return null; }
          function Qualified(props: { text: string }) { return props.text; }
          function QualifiedForwarded(props: { text: string }, ref: unknown) { return null; }
          export const MemoNamed = memo(Plain);
          export const ForwardRefNamed = forwardRef<HTMLDivElement, { text: string }>(Forwarded);
          export const ReactMemoNamed = React.memo(Qualified);
          export const ReactForwardRefNamed = React.forwardRef(QualifiedForwarded);
        `,
        'src/components/NamedRefs.tsx'
      );
      expect(entities.map((e) => e.name).sort()).toEqual([
        'ForwardRefNamed',
        'MemoNamed',
        'ReactForwardRefNamed',
        'ReactMemoNamed',
      ]);
      expect(entities.every((e) => e.type === 'function')).toBe(true);
    });

    it('produces an entity for a memo-wrapped named function reference through parseCode', () => {
      const parser = new TypeScriptParser();
      const arch = parser.parseCode(
        `
          function MarkdownBodyRenderer(props: { text: string }) { return props.text; }
          export const MarkdownBody = memo(MarkdownBodyRenderer);
        `,
        'src/modules/chat/transcript/Markdown.tsx'
      );
      expect(arch.entities).toHaveLength(1);
      expect(arch.entities[0].id).toBe('src/modules/chat/transcript/Markdown.tsx.MarkdownBody');
      expect(arch.entities[0].name).toBe('MarkdownBody');
      expect(arch.entities[0].type).toBe('function');
    });

    it('does not unwrap unrelated call-expression initializers', () => {
      const entities = extractFromCode(
        `
          export const value = someFactory(() => 1);
          export const memoized = useMemo(() => 1, []);
        `,
        'src/components/NotAComponent.tsx'
      );
      expect(entities).toHaveLength(0);
    });

    it('produces one function entity per HOC-wrapped component through parseCode', () => {
      const parser = new TypeScriptParser();
      const messages = parser.parseCode(
        'export const MessageComponent = memo((props) => props.text);',
        'src/components/Message.tsx'
      );
      const toolGroup = parser.parseCode(
        'export const ToolGroup = forwardRef<HTMLDivElement, { label: string }>(function ToolGroup(props, ref) { return null; });',
        'src/components/ToolGroup.tsx'
      );

      const messageFns = messages.entities.filter((e) => e.type === 'function');
      const toolGroupFns = toolGroup.entities.filter((e) => e.type === 'function');
      expect(messageFns).toHaveLength(1);
      expect(messageFns[0].name).toBe('MessageComponent');
      expect(toolGroupFns).toHaveLength(1);
      expect(toolGroupFns[0].name).toBe('ToolGroup');
    });
  });

  describe('declarations exported by reference', () => {
    it('extracts a memo const referenced by export default', () => {
      const parser = new TypeScriptParser();
      const arch = parser.parseCode(
        `
          const MessageComponent = memo((props: { text: string }) => props.text);
          export default MessageComponent;
        `,
        'src/components/Message.tsx'
      );
      const fns = arch.entities.filter((e) => e.type === 'function');
      expect(fns).toHaveLength(1);
      expect(fns[0].id).toBe('src/components/Message.tsx.MessageComponent');
      expect(fns[0].name).toBe('MessageComponent');
    });

    it('extracts a plain arrow const referenced by export default memo(...)', () => {
      const parser = new TypeScriptParser();
      const arch = parser.parseCode(
        `
          const ChatMessagesPane = (props: { text: string }) => props.text;
          export default memo(ChatMessagesPane);
        `,
        'src/components/ChatMessagesPane.tsx'
      );
      const fns = arch.entities.filter((e) => e.type === 'function');
      expect(fns).toHaveLength(1);
      expect(fns[0].name).toBe('ChatMessagesPane');
    });

    it('extracts a function declaration referenced by export default React.memo(...)', () => {
      const parser = new TypeScriptParser();
      const arch = parser.parseCode(
        `
          function ChatInterface(props: { text: string }) { return props.text; }
          export default React.memo(ChatInterface);
        `,
        'src/components/ChatInterface.tsx'
      );
      const fns = arch.entities.filter((e) => e.type === 'function');
      expect(fns).toHaveLength(1);
      expect(fns[0].name).toBe('ChatInterface');
    });

    it('extracts declarations re-exported through export { X }', () => {
      const parser = new TypeScriptParser();
      const arch = parser.parseCode(
        `
          const ToolGroupContainer = memo((props: { label: string }) => props.label);
          function helper(props: { label: string }) { return props.label; }
          export { ToolGroupContainer, helper as renamedHelper };
        `,
        'src/components/ToolGroup.tsx'
      );
      const fns = arch.entities.filter((e) => e.type === 'function');
      expect(fns.map((e) => e.name).sort()).toEqual(['ToolGroupContainer', 'helper']);
    });

    it('does not treat re-exports from another module as local declarations', () => {
      const parser = new TypeScriptParser();
      const arch = parser.parseCode(
        `
          const localOnly = memo(() => null);
          export { localOnly, SomethingElse } from './elsewhere';
        `,
        'src/components/ReExport.tsx'
      );
      const fns = arch.entities.filter((e) => e.type === 'function');
      expect(fns).toHaveLength(0);
    });
  });
});
