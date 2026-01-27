import { describe, it, expect } from 'vitest';
import { ValidatedMermaidGenerator } from '@/mermaid/generator.js';
import { ArchJSON } from '@/types/index.js';

describe('EnhancedTypeSanitizer', () => {
  // 创建一个 mock ArchJSON 用于测试
  const createMockArchJson = (entities: any[] = []): ArchJSON => ({
    version: '1.0',
    language: 'typescript',
    entities,
    relations: [],
  });

  describe('escapeId - Remove Generic Parameters', () => {
    it('should remove generics from class names', () => {
      const archJson = createMockArchJson([
        {
          id: 'CacheEntry',
          name: 'CacheEntry<T>',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 1, column: 1 },
          members: [
            {
              name: 'get',
              type: 'method',
              visibility: '+',
              returnType: 'T',
              parameters: [],
            },
            {
              name: 'data',
              type: 'property',
              visibility: '+',
              fieldType: 'T',
            },
          ],
        },
      ]);

      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: {
          packages: [{ name: 'Test', entities: ['CacheEntry'] }],
          layout: { direction: 'TB', reasoning: 'test' },
        },
      });

      const code = generator.generate();

      // 类名应该是 CacheEntry，而不是 CacheEntry<T>
      expect(code).toContain('class CacheEntry {');
      expect(code).not.toContain('class CacheEntry<T>');

      // 方法返回类型和属性类型应该保留 T
      expect(code).toMatch(/\+\s*get\(\)/);
      expect(code).toMatch(/\+\s*data:/);
    });

    it('should handle nested generics in property types', () => {
      const archJson = createMockArchJson([
        {
          id: 'ComplexMap',
          name: 'ComplexMap',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 1, column: 1 },
          members: [
            {
              name: 'data',
              type: 'property',
              visibility: '+',
              fieldType: 'Map<string, Map<number, any>>',
            },
          ],
        },
      ]);

      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: {
          packages: [{ name: 'Test', entities: ['ComplexMap'] }],
          layout: { direction: 'TB', reasoning: 'test' },
        },
      });

      const code = generator.generate();

      // 不应该包含尖括号
      expect(code).not.toContain('<');
      expect(code).not.toContain('>');
      // 应该使用 tilde 表示法
      expect(code).toMatch(/\+\s*data:\s*Map~/);
    });
  });

  describe('sanitizeType - Promise Types', () => {
    it('should handle Promise return types correctly', () => {
      const archJson = createMockArchJson([
        {
          id: 'Service',
          name: 'Service',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 1, column: 1 },
          members: [
            {
              name: 'fetch',
              type: 'method',
              visibility: '+',
              returnType: 'Promise<Data>',
              parameters: [],
            },
            {
              name: 'save',
              type: 'method',
              visibility: '+',
              returnType: 'Promise<void>',
              parameters: [],
            },
          ],
        },
      ]);

      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: {
          packages: [{ name: 'Test', entities: ['Service'] }],
          layout: { direction: 'TB', reasoning: 'test' },
        },
      });

      const code = generator.generate();

      // Promise 应该被正确处理
      expect(code).toMatch(/\+\s*fetch\(/);
      expect(code).not.toContain('Promise<Data>'); // 不能有尖括号
      expect(code).toMatch(/Promise~Data~/);
    });

    it('should handle Promise with complex types', () => {
      const archJson = createMockArchJson([
        {
          id: 'Handler',
          name: 'Handler',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 1, column: 1 },
          members: [
            {
              name: 'process',
              type: 'method',
              visibility: '+',
              returnType: 'Promise<Map<string, any>>',
              parameters: [],
            },
          ],
        },
      ]);

      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: {
          packages: [{ name: 'Test', entities: ['Handler'] }],
          layout: { direction: 'TB', reasoning: 'test' },
        },
      });

      const code = generator.generate();

      // 不应该包含尖括号
      expect(code).not.toContain('<');
      expect(code).not.toContain('>');
      // Promise 应该使用 tilde 表示法
      expect(code).toMatch(/Promise~Map/);
    });
  });

  describe('sanitizeType - Function Types', () => {
    it('should simplify function types to "Function"', () => {
      const archJson = createMockArchJson([
        {
          id: 'Callback',
          name: 'Callback',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 1, column: 1 },
          members: [
            {
              name: 'onClick',
              type: 'property',
              visibility: '+',
              fieldType: '(event: MouseEvent) => void',
            },
            {
              name: 'validator',
              type: 'property',
              visibility: '+',
              fieldType: '(value: string) => boolean',
            },
          ],
        },
      ]);

      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: {
          packages: [{ name: 'Test', entities: ['Callback'] }],
          layout: { direction: 'TB', reasoning: 'test' },
        },
      });

      const code = generator.generate();

      // 函数类型应该被简化
      expect(code).not.toContain('=>');
      expect(code).toMatch(/\+\s*onClick:\s*Function/);
      expect(code).toMatch(/\+\s*validator:\s*Function/);
    });
  });

  describe('sanitizeType - Union and Intersection Types', () => {
    it('should simplify union types to "Any"', () => {
      const archJson = createMockArchJson([
        {
          id: 'Flexible',
          name: 'Flexible',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 1, column: 1 },
          members: [
            {
              name: 'value',
              type: 'property',
              visibility: '+',
              fieldType: 'string | number | boolean',
            },
          ],
        },
      ]);

      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: {
          packages: [{ name: 'Test', entities: ['Flexible'] }],
          layout: { direction: 'TB', reasoning: 'test' },
        },
      });

      const code = generator.generate();

      // 联合类型应该被简化
      expect(code).not.toContain('|');
      expect(code).toMatch(/\+\s*value:\s*any/);
    });

    it('should simplify intersection types to "object"', () => {
      const archJson = createMockArchJson([
        {
          id: 'Combined',
          name: 'Combined',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 1, column: 1 },
          members: [
            {
              name: 'data',
              type: 'property',
              visibility: '+',
              fieldType: 'A & B & C',
            },
          ],
        },
      ]);

      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: {
          packages: [{ name: 'Test', entities: ['Combined'] }],
          layout: { direction: 'TB', reasoning: 'test' },
        },
      });

      const code = generator.generate();

      // 交叉类型应该被简化
      expect(code).not.toContain('&');
      expect(code).toMatch(/\+\s*data:\s*object/);
    });
  });

  describe('sanitizeType - Array Types', () => {
    it('should handle array types correctly', () => {
      const archJson = createMockArchJson([
        {
          id: 'Arrays',
          name: 'Arrays',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 1, column: 1 },
          members: [
            { name: 'items', type: 'property', visibility: '+', fieldType: 'string[]' },
            { name: 'values', type: 'property', visibility: '+', fieldType: 'Array<number>' },
            { name: 'nested', type: 'property', visibility: '+', fieldType: 'Array<Array<string>>' },
          ],
        },
      ]);

      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: {
          packages: [{ name: 'Test', entities: ['Arrays'] }],
          layout: { direction: 'TB', reasoning: 'test' },
        },
      });

      const code = generator.generate();

      // 数组应该被正确表示
      expect(code).toMatch(/\+\s*items:/);
      expect(code).toMatch(/\+\s*values:/);
      expect(code).toMatch(/\+\s*nested:/);
      // 不应该包含方括号（Mermaid 不支持）
      expect(code).not.toMatch(/\w+\[\]/);
    });
  });

  describe('sanitizeType - TypeScript Advanced Types', () => {
    it('should simplify Partial<T> to "any"', () => {
      const archJson = createMockArchJson([
        {
          id: 'PartialUser',
          name: 'PartialUser',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 1, column: 1 },
          members: [
            { name: 'data', type: 'property', visibility: '+', fieldType: 'Partial<User>' },
          ],
        },
      ]);

      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: {
          packages: [{ name: 'Test', entities: ['PartialUser'] }],
          layout: { direction: 'TB', reasoning: 'test' },
        },
      });

      const code = generator.generate();

      // TypeScript 高级类型应该被简化
      expect(code).not.toContain('Partial<User>');
      expect(code).toMatch(/\+\s*data:\s*any/);
    });

    it('should simplify Pick<T, K> to "any"', () => {
      const archJson = createMockArchJson([
        {
          id: 'UserPick',
          name: 'UserPick',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 1, column: 1 },
          members: [
            { name: 'selected', type: 'property', visibility: '+', fieldType: 'Pick<User, "name" | "email">' },
          ],
        },
      ]);

      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: {
          packages: [{ name: 'Test', entities: ['UserPick'] }],
          layout: { direction: 'TB', reasoning: 'test' },
        },
      });

      const code = generator.generate();

      expect(code).not.toContain('Pick<User');
      expect(code).toMatch(/\+\s*selected:\s*any/);
    });

    it('should simplify Record<K, V> to "any"', () => {
      const archJson = createMockArchJson([
        {
          id: 'RecordMap',
          name: 'RecordMap',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 1, column: 1 },
          members: [
            { name: 'map', type: 'property', visibility: '+', fieldType: 'Record<string, number>' },
          ],
        },
      ]);

      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: {
          packages: [{ name: 'Test', entities: ['RecordMap'] }],
          layout: { direction: 'TB', reasoning: 'test' },
        },
      });

      const code = generator.generate();

      expect(code).not.toContain('Record<string, number>');
      expect(code).toMatch(/\+\s*map:\s*any/);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle CLI config types', () => {
      const archJson = createMockArchJson([
        {
          id: 'Config',
          name: 'ArchGuardConfig',
          type: 'interface',
          sourceLocation: { file: 'test.ts', line: 1, column: 1 },
          members: [
            { name: 'format', type: 'property', visibility: '+', fieldType: "'mermaid' | 'json'" },
            { name: 'mermaid', type: 'property', visibility: '+', fieldType: 'MermaidConfig | undefined' },
          ],
        },
      ]);

      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: {
          packages: [{ name: 'Test', entities: ['Config'] }],
          layout: { direction: 'TB', reasoning: 'test' },
        },
      });

      const code = generator.generate();

      // 不应该包含尖括号、管道符
      expect(code).not.toContain('<');
      expect(code).not.toContain('>');
      expect(code).not.toContain('|');
      // Mermaid 中 interface 也显示为 class
      expect(code).toContain('ArchGuardConfig {');
    });

    it('should handle complex method signatures from CLI module', () => {
      const archJson = createMockArchJson([
        {
          id: 'CommandHandler',
          name: 'AnalyzeCommandHandler',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 1, column: 1 },
          members: [
            {
              name: 'handle',
              type: 'method',
              visibility: '+',
              returnType: 'Promise<HandlerResult>',
              parameters: [
                { name: 'options', type: 'CommandOptions', optional: false },
              ],
            },
            {
              name: 'validate',
              type: 'method',
              visibility: '+',
              returnType: 'ValidationResult',
              parameters: [
                { name: 'config', type: 'ArchGuardConfig', optional: false },
              ],
            },
          ],
        },
      ]);

      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: {
          packages: [{ name: 'Test', entities: ['CommandHandler'] }],
          layout: { direction: 'TB', reasoning: 'test' },
        },
      });

      const code = generator.generate();

      // 不应该包含尖括号或复杂的 Promise 语法
      expect(code).not.toContain('<');
      expect(code).not.toContain('>');
      // 方法应该被正确生成
      expect(code).toContain('+handle(');
      expect(code).toContain('+validate(');
    });

    it('should handle generic classes with multiple type parameters', () => {
      const archJson = createMockArchJson([
        {
          id: 'Map',
          name: 'Map<K, V>',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 1, column: 1 },
          members: [
            {
              name: 'get',
              type: 'method',
              visibility: '+',
              returnType: 'V | undefined',
              parameters: [{ name: 'key', type: 'K', optional: false }],
            },
            {
              name: 'set',
              type: 'method',
              visibility: '+',
              returnType: 'void',
              parameters: [
                { name: 'key', type: 'K', optional: false },
                { name: 'value', type: 'V', optional: false },
              ],
            },
          ],
        },
      ]);

      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: {
          packages: [{ name: 'Test', entities: ['Map'] }],
          layout: { direction: 'TB', reasoning: 'test' },
        },
      });

      const code = generator.generate();

      // 类名应该移除泛型参数
      expect(code).toContain('class Map {');
      expect(code).not.toContain('class Map<K, V>');
      // 方法参数中的类型参数保留（但联合类型被简化为 any）
      expect(code).toMatch(/\+\s*get\(key:\s*K\)/);
      expect(code).toMatch(/\+\s*set\(key:\s*K,\s*value:\s*V\)/);
    });
  });

  describe('integration - Mermaid syntax validation', () => {
    it('should generate valid Mermaid syntax for complex real-world types', () => {
      const archJson = createMockArchJson([
        {
          id: 'ComplexClass',
          name: 'ComplexClass<TData, TResult>',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 1, column: 1 },
          members: [
            {
              name: 'process',
              type: 'method',
              visibility: '+',
              returnType: 'Promise<TResult[]>',
              parameters: [
                { name: 'data', type: 'TData[]', optional: false },
                { name: 'options', type: 'ProcessOptions | undefined', optional: true },
              ],
            },
          ],
          properties: [
            { name: 'cache', type: 'property', visibility: '-', fieldType: 'Map<string, Promise<TData>>' },
            { name: 'config', type: 'property', visibility: '+', fieldType: 'Required<Config>' },
          ],
        },
      ]);

      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: {
          packages: [{ name: 'Test', entities: ['ComplexClass'] }],
          layout: { direction: 'TB', reasoning: 'test' },
        },
      });

      const code = generator.generate();

      // 验证不包含无效的 Mermaid 语法
      expect(code).not.toMatch(/class\s+\w+<[^>]+>\s*{/); // 类名中的泛型
      expect(code).not.toContain('=>'); // 函数箭头
      expect(code).not.toContain('|'); // 联合类型（除注释外）
      expect(code).not.toContain('&'); // 交叉类型
      expect(code).not.toMatch(/<[^>]+>/); // 尖括号（除了tilde表示）

      // 验证基本的 Mermaid 结构
      expect(code).toContain('classDiagram');
      expect(code).toContain('class ComplexClass {');
    });
  });

  describe('sanitizeType - Nested Object Types (Bug Fix)', () => {
    it('should handle deeply nested object types in parameters', () => {
      // This is the cli-method bug: { paths: { json: string; mmd: string; ... } }
      const archJson = createMockArchJson([
        {
          id: 'DiagramProcessor',
          name: 'DiagramProcessor',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 1, column: 1 },
          members: [
            {
              name: 'generateOutput',
              type: 'method',
              visibility: '+',
              returnType: 'Promise<void>',
              parameters: [
                {
                  name: 'archJSON',
                  type: 'ArchJSON',
                  optional: false,
                },
                {
                  name: 'paths',
                  type: '{ paths: { json: string; mmd: string; png: string; svg: string } }',
                  optional: false,
                },
                {
                  name: 'format',
                  type: 'OutputFormat',
                  optional: false,
                },
              ],
            },
          ],
        },
      ]);

      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'method',
        grouping: {
          packages: [{ name: 'Test', entities: ['DiagramProcessor'] }],
          layout: { direction: 'TB', reasoning: 'test' },
        },
      });

      const code = generator.generate();

      // 不应该包含残余的对象类型片段（如 "mmd: string"）
      expect(code).not.toMatch(/mmd:\s*string/);
      expect(code).not.toMatch(/png:\s*string/);

      // 不应该包含参数类型中的花括号和分号
      expect(code).not.toMatch(/\(\s*[^)]*\{[^)]*\}\s*:/);

      // 应该生成有效的方法签名
      expect(code).toMatch(/\+\s*generateOutput\(/);
    });

    it('should handle nested object types in Promise return types', () => {
      // This is the mermaid-class bug: Promise<{overallValid: boolean; stages: Array<{...}>}>
      const archJson = createMockArchJson([
        {
          id: 'ValidationPipeline',
          name: 'ValidationPipeline',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 1, column: 1 },
          members: [
            {
              name: 'validateFull',
              type: 'method',
              visibility: '+',
              returnType: 'Promise<{overallValid: boolean; stages: Array<{name: string; result: any;}>}>',
              parameters: [
                { name: 'mermaidCode', type: 'string', optional: false },
                { name: 'archJson', type: 'ArchJSON', optional: false },
              ],
            },
          ],
        },
      ]);

      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: {
          packages: [{ name: 'Test', entities: ['ValidationPipeline'] }],
          layout: { direction: 'TB', reasoning: 'test' },
        },
      });

      const code = generator.generate();

      // 不应该包含残余的对象类型片段
      expect(code).not.toMatch(/stages:\s*Array/);
      expect(code).not.toMatch(/overallValid/);


      // Promise 应该被正确简化
      expect(code).toMatch(/Promise~/);
    });

    it('should handle triple-nested object types', () => {
      const archJson = createMockArchJson([
        {
          id: 'ComplexService',
          name: 'ComplexService',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 1, column: 1 },
          members: [
            {
              name: 'process',
              type: 'method',
              visibility: '+',
              returnType: 'Promise<{ status: boolean; data: Array<{ id: string; meta: { created: number } }> }>',
              parameters: [],
            },
          ],
        },
      ]);

      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'method',
        grouping: {
          packages: [{ name: 'Test', entities: ['ComplexService'] }],
          layout: { direction: 'TB', reasoning: 'test' },
        },
      });

      const code = generator.generate();

      // 不应该包含返回类型中的残余花括号
      expect(code).not.toMatch(/Promise~[^~]*}\s*~/);

      // 应该生成有效的方法签名
      expect(code).toMatch(/\+\s*process\(/);
    });

    it('should handle mixed nested objects and arrays', () => {
      const archJson = createMockArchJson([
        {
          id: 'MixedService',
          name: 'MixedService',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 1, column: 1 },
          members: [
            {
              name: 'config',
              type: 'property',
              visibility: '+',
              fieldType: '{ a: string; b: Array<{ c: number; d: { e: boolean } }> }',
            },
          ],
        },
      ]);

      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'class',
        grouping: {
          packages: [{ name: 'Test', entities: ['MixedService'] }],
          layout: { direction: 'TB', reasoning: 'test' },
        },
      });

      const code = generator.generate();

      // 属性应该被简化为 object
      expect(code).toMatch(/\+\s*config:\s*object/);
    });

    it('should handle object types with special characters inside', () => {
      const archJson = createMockArchJson([
        {
          id: 'SpecialService',
          name: 'SpecialService',
          type: 'class',
          sourceLocation: { file: 'test.ts', line: 1, column: 1 },
          members: [
            {
              name: 'getData',
              type: 'method',
              visibility: '+',
              returnType: 'Promise<{ "key-with-dash": string; key: { nested: { "special-key": number } } }>',
              parameters: [],
            },
          ],
        },
      ]);

      const generator = new ValidatedMermaidGenerator(archJson, {
        level: 'method',
        grouping: {
          packages: [{ name: 'Test', entities: ['SpecialService'] }],
          layout: { direction: 'TB', reasoning: 'test' },
        },
      });

      const code = generator.generate();

      // 不应该包含引号键
      expect(code).not.toMatch(/"key-with-dash"/);
      expect(code).not.toMatch(/"special-key"/);

      // 应该生成有效的方法签名
      expect(code).toMatch(/\+\s*getData\(/);
    });
  });
});
