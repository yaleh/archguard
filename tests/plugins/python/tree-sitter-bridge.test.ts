/**
 * TreeSitterBridge tests for Python parser
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TreeSitterBridge } from '@/plugins/python/tree-sitter-bridge.js';
import fs from 'fs-extra';
import path from 'path';

describe('PythonTreeSitterBridge', () => {
  let bridge: TreeSitterBridge;

  beforeEach(() => {
    bridge = new TreeSitterBridge();
  });

  describe('Simple class parsing', () => {
    it('should parse simple Python class with methods', () => {
      const code = `
class User:
    def __init__(self, name: str, age: int):
        self.name = name
        self.age = age

    def get_name(self) -> str:
        return self.name
      `;

      const result = bridge.parseCode(code, 'user.py');

      expect(result.name).toBe('user');
      expect(result.classes).toHaveLength(1);

      const userClass = result.classes[0];
      expect(userClass.name).toBe('User');
      expect(userClass.moduleName).toBe('user');
      expect(userClass.methods).toHaveLength(2);
      expect(userClass.methods[0].name).toBe('__init__');
      expect(userClass.methods[1].name).toBe('get_name');
    });

    it('should extract method parameters with type hints', () => {
      const code = `
class User:
    def __init__(self, name: str, age: int):
        pass
      `;

      const result = bridge.parseCode(code, 'user.py');
      const initMethod = result.classes[0].methods[0];

      expect(initMethod.parameters).toHaveLength(3); // self + 2 params
      expect(initMethod.parameters[0].name).toBe('self');
      expect(initMethod.parameters[1].name).toBe('name');
      expect(initMethod.parameters[1].type).toBe('str');
      expect(initMethod.parameters[2].name).toBe('age');
      expect(initMethod.parameters[2].type).toBe('int');
    });

    it('should extract return type from method', () => {
      const code = `
class User:
    def get_name(self) -> str:
        return self.name
      `;

      const result = bridge.parseCode(code, 'user.py');
      const method = result.classes[0].methods[0];

      expect(method.returnType).toBe('str');
    });
  });

  describe('Class inheritance', () => {
    it('should detect single inheritance', () => {
      const code = `
class User:
    pass

class AdminUser(User):
    pass
      `;

      const result = bridge.parseCode(code, 'users.py');

      expect(result.classes).toHaveLength(2);
      expect(result.classes[0].name).toBe('User');
      expect(result.classes[0].baseClasses).toEqual([]);
      expect(result.classes[1].name).toBe('AdminUser');
      expect(result.classes[1].baseClasses).toEqual(['User']);
    });

    it('should detect multiple inheritance', () => {
      const code = `
class AdminUser(User, Auditable):
    def __init__(self, name: str, role: str):
        super().__init__(name)
        self.role = role
      `;

      const result = bridge.parseCode(code, 'admin.py');

      expect(result.classes[0].baseClasses).toEqual(['User', 'Auditable']);
    });
  });

  describe('Decorators', () => {
    it('should detect @property decorator', () => {
      const code = `
class Service:
    @property
    def name(self) -> str:
        return self._name
      `;

      const result = bridge.parseCode(code, 'service.py');
      const method = result.classes[0].methods[0];

      expect(method.isProperty).toBe(true);
      expect(method.decorators).toHaveLength(1);
      expect(method.decorators[0].name).toBe('property');
    });

    it('should detect @classmethod decorator', () => {
      const code = `
class Service:
    @classmethod
    def create(cls, name: str):
        return cls()
      `;

      const result = bridge.parseCode(code, 'service.py');
      const method = result.classes[0].methods[0];

      expect(method.isClassMethod).toBe(true);
      expect(method.decorators[0].name).toBe('classmethod');
    });

    it('should detect @staticmethod decorator', () => {
      const code = `
class Service:
    @staticmethod
    def validate(value: str) -> bool:
        return len(value) > 0
      `;

      const result = bridge.parseCode(code, 'service.py');
      const method = result.classes[0].methods[0];

      expect(method.isStaticMethod).toBe(true);
      expect(method.decorators[0].name).toBe('staticmethod');
    });

    it('should detect custom decorators', () => {
      const code = `
class API:
    @route("/users")
    @authenticate
    def get_users(self):
        pass
      `;

      const result = bridge.parseCode(code, 'api.py');
      const method = result.classes[0].methods[0];

      expect(method.decorators).toHaveLength(2);
      expect(method.decorators[0].name).toBe('route');
      expect(method.decorators[1].name).toBe('authenticate');
    });
  });

  describe('Module-level functions', () => {
    it('should parse module-level functions', () => {
      const code = `
def calculate(x: int, y: int) -> int:
    """Calculate sum of x and y."""
    return x + y

def process(data: str) -> str:
    return data.strip()
      `;

      const result = bridge.parseCode(code, 'utils.py');

      expect(result.functions).toHaveLength(2);
      expect(result.functions[0].name).toBe('calculate');
      expect(result.functions[0].moduleName).toBe('utils');
      expect(result.functions[0].parameters).toHaveLength(2);
      expect(result.functions[0].returnType).toBe('int');
      expect(result.functions[1].name).toBe('process');
    });

    it('should detect async functions', () => {
      const code = `
async def fetch_data(url: str) -> dict:
    """Fetch data asynchronously."""
    pass
      `;

      const result = bridge.parseCode(code, 'async_utils.py');

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].isAsync).toBe(true);
    });
  });

  describe('Async methods', () => {
    it('should detect async methods in classes', () => {
      const code = `
class AsyncService:
    async def process(self, data: str) -> str:
        return data
      `;

      const result = bridge.parseCode(code, 'service.py');
      const method = result.classes[0].methods[0];

      expect(method.isAsync).toBe(true);
    });
  });

  describe('Private methods', () => {
    it('should detect private methods with __ prefix', () => {
      const code = `
class Service:
    def __private_method(self):
        pass

    def public_method(self):
        pass
      `;

      const result = bridge.parseCode(code, 'service.py');

      expect(result.classes[0].methods[0].isPrivate).toBe(true);
      expect(result.classes[0].methods[1].isPrivate).toBe(false);
    });
  });

  describe('Docstrings', () => {
    it('should extract class docstrings', () => {
      const code = `
class User:
    """This is a user class."""
    pass
      `;

      const result = bridge.parseCode(code, 'user.py');

      expect(result.classes[0].docstring).toBe('This is a user class.');
    });

    it('should extract method docstrings', () => {
      const code = `
def calculate(x: int) -> int:
    """Calculate something."""
    return x * 2
      `;

      const result = bridge.parseCode(code, 'calc.py');

      expect(result.functions[0].docstring).toBe('Calculate something.');
    });
  });

  describe('Parameter types', () => {
    it('should detect *args parameter', () => {
      const code = `
def process(*args):
    pass
      `;

      const result = bridge.parseCode(code, 'utils.py');
      const param = result.functions[0].parameters[0];

      expect(param.name).toBe('args');
      expect(param.isVarArgs).toBe(true);
    });

    it('should detect **kwargs parameter', () => {
      const code = `
def process(**kwargs):
    pass
      `;

      const result = bridge.parseCode(code, 'utils.py');
      const param = result.functions[0].parameters[0];

      expect(param.name).toBe('kwargs');
      expect(param.isKwArgs).toBe(true);
    });

    it('should handle default parameter values', () => {
      const code = `
def greet(name: str = "World"):
    pass
      `;

      const result = bridge.parseCode(code, 'greet.py');
      const param = result.functions[0].parameters[0];

      expect(param.name).toBe('name');
      expect(param.defaultValue).toBe('"World"');
    });
  });

  describe('Real fixtures', () => {
    it('should parse simple-class.py fixture', async () => {
      const fixturePath = path.join(
        __dirname,
        '../../fixtures/python/simple-class.py'
      );
      const code = await fs.readFile(fixturePath, 'utf-8');

      const result = bridge.parseCode(code, fixturePath);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe('User');
      expect(result.classes[0].methods.length).toBeGreaterThanOrEqual(2);
    });

    it('should parse inheritance.py fixture', async () => {
      const fixturePath = path.join(
        __dirname,
        '../../fixtures/python/inheritance.py'
      );
      const code = await fs.readFile(fixturePath, 'utf-8');

      const result = bridge.parseCode(code, fixturePath);

      expect(result.classes.length).toBeGreaterThanOrEqual(2);
      const adminUser = result.classes.find(c => c.name === 'AdminUser');
      expect(adminUser).toBeDefined();
      expect(adminUser?.baseClasses.length).toBeGreaterThan(0);
    });

    it('should parse decorators.py fixture', async () => {
      const fixturePath = path.join(
        __dirname,
        '../../fixtures/python/decorators.py'
      );
      const code = await fs.readFile(fixturePath, 'utf-8');

      const result = bridge.parseCode(code, fixturePath);

      const serviceClass = result.classes[0];
      const propertyMethod = serviceClass.methods.find(m => m.name === 'name');
      const classMethod = serviceClass.methods.find(m => m.name === 'create');
      const staticMethod = serviceClass.methods.find(m => m.name === 'validate');

      expect(propertyMethod?.isProperty).toBe(true);
      expect(classMethod?.isClassMethod).toBe(true);
      expect(staticMethod?.isStaticMethod).toBe(true);
    });

    it('should parse async-functions.py fixture', async () => {
      const fixturePath = path.join(
        __dirname,
        '../../fixtures/python/async-functions.py'
      );
      const code = await fs.readFile(fixturePath, 'utf-8');

      const result = bridge.parseCode(code, fixturePath);

      expect(result.functions.length).toBeGreaterThan(0);
      const asyncFunc = result.functions.find(f => f.name === 'fetch_data');
      expect(asyncFunc?.isAsync).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty class', () => {
      const code = `
class Empty:
    pass
      `;

      const result = bridge.parseCode(code, 'empty.py');

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].methods).toHaveLength(0);
    });

    it('should handle invalid Python code gracefully', () => {
      const code = `
class Broken
    def invalid syntax
      `;

      expect(() => {
        bridge.parseCode(code, 'broken.py');
      }).not.toThrow();
    });

    it('should handle empty code', () => {
      const result = bridge.parseCode('', 'empty.py');

      expect(result.classes).toHaveLength(0);
      expect(result.functions).toHaveLength(0);
    });
  });
});
