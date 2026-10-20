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
});
