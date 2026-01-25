# Phase 1: 代码指纹提取 (TDD)

**阶段名称**: Code Fingerprint Extraction
**预计时间**: 3-4 天
**开发方法**: TDD (Test-Driven Development)
**负责人**: 开发团队
**依赖**: Phase 0 (环境准备) 完成

---

## 📋 阶段目标

实现高效的 TypeScript 代码解析器，能够：
1. 提取类、接口、枚举定义
2. 识别成员（方法、属性、构造函数）
3. 解析类型信息和可见性
4. 处理装饰器和泛型
5. 生成标准化的 Arch-JSON 格式

**核心价值**: 为 AI 生成提供准确、结构化的输入数据

---

## 1. TDD 开发计划

### 1.1 测试用例设计

#### Story 1: 简单类提取

**测试**:
```typescript
// __tests__/parser/class-extractor.test.ts

describe('ClassExtractor - Simple Classes', () => {
  const extractor = new ClassExtractor();

  it('should extract empty class', () => {
    const code = 'class User {}';
    const result = extractor.extract(code);

    expect(result).toEqual({
      id: 'User',
      name: 'User',
      type: 'class',
      visibility: 'public',
      members: [],
      decorators: [],
      sourceLocation: {
        file: 'test.ts',
        startLine: 1,
        endLine: 1
      }
    });
  });

  it('should extract exported class', () => {
    const code = 'export class UserService {}';
    const result = extractor.extract(code);

    expect(result.name).toBe('UserService');
    expect(result.visibility).toBe('public');
  });

  it('should handle abstract class', () => {
    const code = 'abstract class BaseService {}';
    const result = extractor.extract(code);

    expect(result.isAbstract).toBe(true);
  });
});
```

**实现**:
```typescript
// src/parser/class-extractor.ts

import { Project, ClassDeclaration } from 'ts-morph';

export class ClassExtractor {
  private project: Project;

  constructor() {
    this.project = new Project();
  }

  extract(code: string, filePath: string = 'test.ts'): Entity {
    const sourceFile = this.project.createSourceFile(filePath, code);
    const classDecl = sourceFile.getClasses()[0];

    if (!classDecl) {
      throw new Error('No class found in code');
    }

    return this.extractClass(classDecl, filePath);
  }

  private extractClass(classDecl: ClassDeclaration, filePath: string): Entity {
    return {
      id: classDecl.getName() || 'Anonymous',
      name: classDecl.getName() || 'Anonymous',
      type: 'class',
      visibility: this.getVisibility(classDecl),
      isAbstract: classDecl.isAbstract(),
      members: [],
      decorators: [],
      sourceLocation: {
        file: filePath,
        startLine: classDecl.getStartLineNumber(),
        endLine: classDecl.getEndLineNumber()
      }
    };
  }

  private getVisibility(classDecl: ClassDeclaration): Visibility {
    // TypeScript 类默认是 public
    return classDecl.isExported() ? 'public' : 'internal';
  }
}
```

---

#### Story 2: 方法提取

**测试**:
```typescript
describe('ClassExtractor - Methods', () => {
  it('should extract simple method', () => {
    const code = `
      class UserService {
        findUser(id: string): User {
          return null;
        }
      }
    `;

    const result = extractor.extract(code);

    expect(result.members).toHaveLength(1);
    expect(result.members[0]).toMatchObject({
      name: 'findUser',
      type: 'method',
      visibility: 'public',
      parameters: [
        { name: 'id', type: 'string', isOptional: false }
      ],
      returnType: 'User',
      isAsync: false,
      isStatic: false
    });
  });

  it('should extract async method', () => {
    const code = `
      class UserService {
        async findUser(id: string): Promise<User> {
          return await db.query(id);
        }
      }
    `;

    const result = extractor.extract(code);

    expect(result.members[0].isAsync).toBe(true);
    expect(result.members[0].returnType).toBe('Promise<User>');
  });

  it('should extract static method', () => {
    const code = `
      class MathUtils {
        static add(a: number, b: number): number {
          return a + b;
        }
      }
    `;

    const result = extractor.extract(code);

    expect(result.members[0].isStatic).toBe(true);
  });

  it('should handle method visibility', () => {
    const code = `
      class UserService {
        public getUser() {}
        private validateUser() {}
        protected checkPermission() {}
      }
    `;

    const result = extractor.extract(code);

    expect(result.members[0].visibility).toBe('public');
    expect(result.members[1].visibility).toBe('private');
    expect(result.members[2].visibility).toBe('protected');
  });
});
```

**实现**:
```typescript
// src/parser/class-extractor.ts (扩展)

private extractClass(classDecl: ClassDeclaration, filePath: string): Entity {
  return {
    // ... 之前的字段
    members: this.extractMembers(classDecl)
  };
}

private extractMembers(classDecl: ClassDeclaration): Member[] {
  const members: Member[] = [];

  // 提取方法
  for (const method of classDecl.getMethods()) {
    members.push(this.extractMethod(method));
  }

  // 提取属性
  for (const property of classDecl.getProperties()) {
    members.push(this.extractProperty(property));
  }

  return members;
}

private extractMethod(method: MethodDeclaration): Member {
  return {
    name: method.getName(),
    type: 'method',
    visibility: this.getMemberVisibility(method),
    isStatic: method.isStatic(),
    isAsync: method.isAsync(),
    parameters: method.getParameters().map(p => ({
      name: p.getName(),
      type: p.getType().getText(),
      isOptional: p.isOptional()
    })),
    returnType: method.getReturnType().getText()
  };
}

private getMemberVisibility(node: any): Visibility {
  if (node.hasModifier('private')) return 'private';
  if (node.hasModifier('protected')) return 'protected';
  if (node.hasModifier('public')) return 'public';
  return 'public'; // TypeScript 默认
}
```

---

#### Story 3: 属性提取

**测试**:
```typescript
describe('ClassExtractor - Properties', () => {
  it('should extract simple property', () => {
    const code = `
      class User {
        name: string;
      }
    `;

    const result = extractor.extract(code);

    expect(result.members[0]).toMatchObject({
      name: 'name',
      type: 'property',
      fieldType: 'string',
      visibility: 'public',
      isReadonly: false
    });
  });

  it('should handle readonly properties', () => {
    const code = `
      class Config {
        readonly apiKey: string;
      }
    `;

    const result = extractor.extract(code);

    expect(result.members[0].isReadonly).toBe(true);
  });

  it('should extract property with initializer', () => {
    const code = `
      class Counter {
        count: number = 0;
      }
    `;

    const result = extractor.extract(code);

    expect(result.members[0].defaultValue).toBe('0');
  });
});
```

---

#### Story 4: 接口提取

**测试**:
```typescript
describe('InterfaceExtractor', () => {
  const extractor = new InterfaceExtractor();

  it('should extract simple interface', () => {
    const code = `
      interface User {
        id: string;
        name: string;
      }
    `;

    const result = extractor.extract(code);

    expect(result).toMatchObject({
      name: 'User',
      type: 'interface',
      members: [
        { name: 'id', fieldType: 'string' },
        { name: 'name', fieldType: 'string' }
      ]
    });
  });

  it('should handle method signatures', () => {
    const code = `
      interface UserRepository {
        findById(id: string): Promise<User>;
        save(user: User): Promise<void>;
      }
    `;

    const result = extractor.extract(code);

    expect(result.members).toHaveLength(2);
    expect(result.members[0].type).toBe('method');
  });

  it('should handle extends', () => {
    const code = `
      interface AdminUser extends User {
        role: string;
      }
    `;

    const result = extractor.extract(code);

    expect(result.extends).toContain('User');
  });
});
```

---

#### Story 5: 装饰器提取

**测试**:
```typescript
describe('ClassExtractor - Decorators', () => {
  it('should extract class decorators', () => {
    const code = `
      @Injectable()
      class UserService {}
    `;

    const result = extractor.extract(code);

    expect(result.decorators).toHaveLength(1);
    expect(result.decorators[0]).toMatchObject({
      name: 'Injectable',
      arguments: {}
    });
  });

  it('should extract decorator with arguments', () => {
    const code = `
      @Component({
        selector: 'app-user',
        template: './user.html'
      })
      class UserComponent {}
    `;

    const result = extractor.extract(code);

    expect(result.decorators[0].arguments).toEqual({
      selector: 'app-user',
      template: './user.html'
    });
  });

  it('should extract method decorators', () => {
    const code = `
      class UserService {
        @Cache(60)
        findUser(id: string): User {
          return null;
        }
      }
    `;

    const result = extractor.extract(code);

    expect(result.members[0].decorators).toHaveLength(1);
    expect(result.members[0].decorators[0].name).toBe('Cache');
  });
});
```

---

#### Story 6: 关系提取

**测试**:
```typescript
describe('RelationExtractor', () => {
  it('should detect inheritance', () => {
    const code = `
      class AdminUser extends User {
        role: string;
      }
    `;

    const relations = extractor.extractRelations(code);

    expect(relations).toContainEqual({
      from: 'AdminUser',
      to: 'User',
      type: 'inheritance'
    });
  });

  it('should detect interface implementation', () => {
    const code = `
      class UserService implements IUserService {
        findUser() {}
      }
    `;

    const relations = extractor.extractRelations(code);

    expect(relations).toContainEqual({
      from: 'UserService',
      to: 'IUserService',
      type: 'implementation'
    });
  });

  it('should detect composition', () => {
    const code = `
      class UserService {
        private db: Database;

        constructor(db: Database) {
          this.db = db;
        }
      }
    `;

    const relations = extractor.extractRelations(code);

    expect(relations).toContainEqual({
      from: 'UserService',
      to: 'Database',
      type: 'composition'
    });
  });

  it('should detect dependency', () => {
    const code = `
      class UserService {
        findUser(id: string): User {
          return new User();
        }
      }
    `;

    const relations = extractor.extractRelations(code);

    expect(relations).toContainEqual({
      from: 'UserService',
      to: 'User',
      type: 'dependency'
    });
  });
});
```

---

### 1.2 TDD 红-绿-重构循环

#### 循环 1: ClassExtractor 基础

**🔴 Red** (写测试):
```bash
npm test -- class-extractor.test.ts
# FAIL: ClassExtractor is not defined
```

**🟢 Green** (实现):
```typescript
export class ClassExtractor {
  extract(code: string): Entity {
    // 最小实现
    return {
      id: 'User',
      name: 'User',
      type: 'class',
      // ...
    };
  }
}
```

**♻️ Refactor** (重构):
```typescript
// 提取重复代码
private createEntity(name: string): Entity {
  return {
    id: name,
    name,
    type: 'class',
    visibility: 'public',
    members: [],
    decorators: [],
    sourceLocation: this.createDefaultLocation()
  };
}
```

#### 循环 2-N: 迭代添加功能

每个新功能都重复 红-绿-重构：
1. 写失败的测试
2. 写最小代码让测试通过
3. 重构改进代码质量

---

## 2. 实现计划

### Day 1: 基础结构

**上午** (2-3h):
- ✅ 设计 Arch-JSON Schema
- ✅ 创建类型定义文件
- ✅ 编写 ClassExtractor 框架

**下午** (3-4h):
- ✅ 实现简单类提取
- ✅ TDD: 测试 + 实现循环
- ✅ 代码审查和重构

**交付物**:
- `src/types/arch-json.ts` - 类型定义
- `src/parser/class-extractor.ts` - 类提取器
- `__tests__/parser/class-extractor.test.ts` - 测试

**验收标准**:
- [ ] 能提取空类和简单类
- [ ] 测试覆盖率 > 80%
- [ ] 所有测试通过

---

### Day 2: 成员提取

**上午**:
- ✅ 实现方法提取
- ✅ 参数和返回值类型解析
- ✅ 可见性识别

**下午**:
- ✅ 实现属性提取
- ✅ 处理 readonly、static 修饰符
- ✅ 添加默认值解析

**交付物**:
- 扩展 `ClassExtractor` 支持成员
- 新增测试覆盖方法和属性

**验收标准**:
- [ ] 能提取所有方法和属性
- [ ] 正确识别可见性
- [ ] 测试覆盖率 > 80%

---

### Day 3: 接口和装饰器

**上午**:
- ✅ 实现 InterfaceExtractor
- ✅ 接口成员提取
- ✅ extends 关系识别

**下午**:
- ✅ 实现装饰器提取
- ✅ 解析装饰器参数
- ✅ 支持类和方法装饰器

**交付物**:
- `src/parser/interface-extractor.ts`
- `src/parser/decorator-extractor.ts`
- 对应测试文件

**验收标准**:
- [ ] 能提取接口定义
- [ ] 能识别装饰器及其参数
- [ ] 测试覆盖率 > 80%

---

### Day 4: 关系提取和整合

**上午**:
- ✅ 实现 RelationExtractor
- ✅ 识别继承、实现、组合
- ✅ 依赖关系分析

**下午**:
- ✅ 整合所有提取器
- ✅ 实现 TypeScriptParser 主类
- ✅ 批量文件处理

**交付物**:
- `src/parser/relation-extractor.ts`
- `src/parser/typescript-parser.ts` - 主解析器
- 集成测试

**验收标准**:
- [ ] 能识别所有关系类型
- [ ] 能解析整个项目
- [ ] 集成测试通过

---

## 3. 代码结构

```
src/
├─ types/
│  └─ arch-json.ts           # ArchJSON 类型定义
├─ parser/
│  ├─ class-extractor.ts     # 类提取器
│  ├─ interface-extractor.ts # 接口提取器
│  ├─ decorator-extractor.ts # 装饰器提取器
│  ├─ relation-extractor.ts  # 关系提取器
│  └─ typescript-parser.ts   # 主解析器
└─ utils/
   ├─ file-utils.ts          # 文件操作工具
   └─ type-utils.ts          # 类型处理工具

__tests__/
├─ parser/
│  ├─ class-extractor.test.ts
│  ├─ interface-extractor.test.ts
│  ├─ decorator-extractor.test.ts
│  ├─ relation-extractor.test.ts
│  └─ typescript-parser.test.ts
├─ integration/
│  └─ parser.integration.test.ts
└─ fixtures/
   ├─ simple-class.ts
   ├─ complex-class.ts
   └─ interface-example.ts
```

---

## 4. 关键代码示例

### 4.1 Arch-JSON 类型定义

```typescript
// src/types/arch-json.ts

export interface ArchJSON {
  version: string;
  language: 'typescript';
  timestamp: string;
  sourceFiles: string[];
  entities: Entity[];
  relations: Relation[];
}

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  visibility: Visibility;
  isAbstract?: boolean;
  members: Member[];
  decorators: Decorator[];
  genericParams?: string[];
  extends?: string[];
  implements?: string[];
  sourceLocation: SourceLocation;
}

export type EntityType = 'class' | 'interface' | 'enum' | 'type';
export type Visibility = 'public' | 'private' | 'protected' | 'internal';

export interface Member {
  name: string;
  type: MemberType;
  visibility: Visibility;
  isStatic?: boolean;
  isAsync?: boolean;
  isReadonly?: boolean;

  // Method specific
  parameters?: Parameter[];
  returnType?: string;

  // Property specific
  fieldType?: string;
  defaultValue?: string;

  decorators?: Decorator[];
}

export type MemberType = 'method' | 'property' | 'constructor';

export interface Parameter {
  name: string;
  type: string;
  isOptional: boolean;
  defaultValue?: string;
}

export interface Decorator {
  name: string;
  arguments: Record<string, any>;
}

export interface Relation {
  from: string;
  to: string;
  type: RelationType;
  label?: string;
}

export type RelationType =
  | 'inheritance'
  | 'implementation'
  | 'composition'
  | 'aggregation'
  | 'dependency';

export interface SourceLocation {
  file: string;
  startLine: number;
  endLine: number;
}
```

### 4.2 主解析器

```typescript
// src/parser/typescript-parser.ts

import { Project } from 'ts-morph';
import { ClassExtractor } from './class-extractor';
import { InterfaceExtractor } from './interface-extractor';
import { RelationExtractor } from './relation-extractor';
import { ArchJSON } from '../types/arch-json';

export class TypeScriptParser {
  private project: Project;
  private classExtractor: ClassExtractor;
  private interfaceExtractor: InterfaceExtractor;
  private relationExtractor: RelationExtractor;

  constructor() {
    this.project = new Project();
    this.classExtractor = new ClassExtractor();
    this.interfaceExtractor = new InterfaceExtractor();
    this.relationExtractor = new RelationExtractor();
  }

  async parseProject(rootDir: string): Promise<ArchJSON> {
    // 添加源文件
    this.project.addSourceFilesAtPaths(`${rootDir}/**/*.ts`);

    const entities: Entity[] = [];
    const relations: Relation[] = [];
    const sourceFiles: string[] = [];

    // 遍历所有源文件
    for (const sourceFile of this.project.getSourceFiles()) {
      const filePath = sourceFile.getFilePath();
      sourceFiles.push(filePath);

      // 提取类
      for (const classDecl of sourceFile.getClasses()) {
        const entity = this.classExtractor.extractClass(classDecl, filePath);
        entities.push(entity);
      }

      // 提取接口
      for (const interfaceDecl of sourceFile.getInterfaces()) {
        const entity = this.interfaceExtractor.extractInterface(interfaceDecl, filePath);
        entities.push(entity);
      }

      // 提取关系
      const fileRelations = this.relationExtractor.extract(sourceFile);
      relations.push(...fileRelations);
    }

    return {
      version: '1.0',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      sourceFiles,
      entities,
      relations
    };
  }

  async parseFile(filePath: string): Promise<ArchJSON> {
    const sourceFile = this.project.addSourceFileAtPath(filePath);

    // ... 类似逻辑

    return archJson;
  }
}
```

---

## 5. 性能优化

### 5.1 性能目标

| 场景 | 文件数 | 目标时间 | 内存限制 |
|------|--------|---------|---------|
| 小项目 | < 50 | < 0.5s | < 50MB |
| 中项目 | 50-200 | < 1.5s | < 150MB |
| 大项目 | 200-500 | < 3s | < 300MB |

### 5.2 优化策略

#### 并行处理

```typescript
async parseProject(rootDir: string): Promise<ArchJSON> {
  const sourceFiles = this.project.getSourceFiles();

  // 并行处理文件
  const results = await Promise.all(
    sourceFiles.map(sf => this.parseSourceFile(sf))
  );

  // 合并结果
  return this.mergeResults(results);
}
```

#### 增量解析

```typescript
class ParserCache {
  private cache = new Map<string, { hash: string; result: Entity[] }>();

  shouldParse(filePath: string, currentHash: string): boolean {
    const cached = this.cache.get(filePath);
    return !cached || cached.hash !== currentHash;
  }

  getCached(filePath: string): Entity[] | null {
    return this.cache.get(filePath)?.result || null;
  }

  setCached(filePath: string, hash: string, result: Entity[]): void {
    this.cache.set(filePath, { hash, result });
  }
}
```

---

## 6. 验收测试

### 6.1 单元测试检查清单

- [ ] ClassExtractor
  - [ ] 简单类提取
  - [ ] 方法提取（各种修饰符）
  - [ ] 属性提取
  - [ ] 构造函数提取
  - [ ] 装饰器提取
  - [ ] 泛型类支持

- [ ] InterfaceExtractor
  - [ ] 简单接口
  - [ ] 方法签名
  - [ ] extends 关系

- [ ] RelationExtractor
  - [ ] 继承关系
  - [ ] 实现关系
  - [ ] 组合关系
  - [ ] 依赖关系

### 6.2 集成测试

```typescript
// __tests__/integration/archguard-self-test.ts

describe('ArchGuard Self Test', () => {
  it('should parse ArchGuard project itself', async () => {
    const parser = new TypeScriptParser();
    const archJson = await parser.parseProject('./src');

    // 验证基本结构
    expect(archJson.entities.length).toBeGreaterThan(5);
    expect(archJson.relations.length).toBeGreaterThan(0);

    // 验证特定类存在
    const classExtractor = archJson.entities.find(
      e => e.name === 'ClassExtractor'
    );
    expect(classExtractor).toBeDefined();
    expect(classExtractor.type).toBe('class');

    // 验证成员
    expect(classExtractor.members.length).toBeGreaterThan(0);

    // 验证关系
    const relations = archJson.relations.filter(
      r => r.from === 'TypeScriptParser'
    );
    expect(relations.length).toBeGreaterThan(0);
  });

  it('should match schema', async () => {
    const parser = new TypeScriptParser();
    const archJson = await parser.parseProject('./src');

    // 使用 JSON Schema 验证
    const valid = validateArchJSON(archJson);
    expect(valid).toBe(true);
  });
});
```

### 6.3 性能测试

```typescript
// __tests__/performance/parser-benchmark.test.ts

describe('Parser Performance', () => {
  it('should parse 100 files in < 2s', async () => {
    const parser = new TypeScriptParser();
    const start = Date.now();

    await parser.parseProject('./src');

    const duration = Date.now() - start;
    expect(duration).toBeLessThan(2000);
  });

  it('should use < 200MB memory', async () => {
    const parser = new TypeScriptParser();
    const startMem = process.memoryUsage().heapUsed;

    await parser.parseProject('./src');

    const endMem = process.memoryUsage().heapUsed;
    const usedMB = (endMem - startMem) / 1024 / 1024;

    expect(usedMB).toBeLessThan(200);
  });
});
```

---

## 7. 交付标准

### 7.1 代码质量

- [ ] ESLint: 0 errors, 0 warnings
- [ ] TypeScript: 0 type errors
- [ ] 测试覆盖率: ≥ 80%
- [ ] 代码重复率: < 3%

### 7.2 功能完整性

- [ ] 支持所有 TypeScript 基础类型
- [ ] 正确提取类、接口、枚举
- [ ] 识别所有成员类型
- [ ] 处理装饰器
- [ ] 提取所有关系类型

### 7.3 性能达标

- [ ] ArchGuard 项目自测 < 2s
- [ ] 内存使用 < 200MB
- [ ] 缓存命中提升 > 50%

### 7.4 文档

- [ ] API 文档（JSDoc）
- [ ] 使用示例
- [ ] 测试说明
- [ ] 性能报告

---

## 8. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| ts-morph API 不熟悉 | 高 | 中 | 提前学习文档，准备示例代码 |
| 性能不达标 | 中 | 高 | 早期性能测试，及时优化 |
| 边缘情况未覆盖 | 中 | 中 | 使用真实项目测试，持续补充测试 |
| 类型提取不准确 | 低 | 高 | 严格测试，多项目验证 |

---

## 9. 下一步

Phase 1 完成后：
1. 代码审查和反馈
2. 性能优化
3. 准备 Phase 2: AI 集成
4. 更新项目文档

---

**版本**: 1.0
**状态**: ✅ 准备开始
**负责人**: 开发团队
