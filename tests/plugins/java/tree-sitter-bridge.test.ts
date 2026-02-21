import { describe, it, expect, beforeEach } from 'vitest';
import { TreeSitterBridge } from '@/plugins/java/tree-sitter-bridge.js';

describe('JavaTreeSitterBridge', () => {
  let bridge: TreeSitterBridge;

  beforeEach(() => {
    bridge = new TreeSitterBridge();
  });

  describe('Simple Class Parsing', () => {
    it('should parse a simple Java class', () => {
      const code = `
package com.example;

public class User {
  private String name;
  private int age;

  public User(String name, int age) {
    this.name = name;
    this.age = age;
  }

  public String getName() {
    return name;
  }
}
      `;

      const result = bridge.parseCode(code, 'User.java');

      expect(result.name).toBe('com.example');
      expect(result.classes).toHaveLength(1);

      const userClass = result.classes[0];
      expect(userClass.name).toBe('User');
      expect(userClass.packageName).toBe('com.example');
      expect(userClass.modifiers).toContain('public');
      expect(userClass.fields).toHaveLength(2);
      expect(userClass.methods).toHaveLength(1);
      expect(userClass.constructors).toHaveLength(1);
      expect(userClass.isAbstract).toBe(false);
    });

    it('should extract fields correctly', () => {
      const code = `
package com.example;

public class User {
  private String name;
  private int age;
}
      `;

      const result = bridge.parseCode(code, 'User.java');
      const userClass = result.classes[0];

      expect(userClass.fields).toHaveLength(2);

      const nameField = userClass.fields.find(f => f.name === 'name');
      expect(nameField).toBeDefined();
      expect(nameField?.type).toBe('String');
      expect(nameField?.modifiers).toContain('private');

      const ageField = userClass.fields.find(f => f.name === 'age');
      expect(ageField).toBeDefined();
      expect(ageField?.type).toBe('int');
      expect(ageField?.modifiers).toContain('private');
    });

    it('should extract methods correctly', () => {
      const code = `
package com.example;

public class User {
  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }
}
      `;

      const result = bridge.parseCode(code, 'User.java');
      const userClass = result.classes[0];

      expect(userClass.methods).toHaveLength(2);

      const getName = userClass.methods.find(m => m.name === 'getName');
      expect(getName).toBeDefined();
      expect(getName?.returnType).toBe('String');
      expect(getName?.parameters).toHaveLength(0);
      expect(getName?.modifiers).toContain('public');

      const setName = userClass.methods.find(m => m.name === 'setName');
      expect(setName).toBeDefined();
      expect(setName?.returnType).toBe('void');
      expect(setName?.parameters).toHaveLength(1);
      expect(setName?.parameters[0].name).toBe('name');
      expect(setName?.parameters[0].type).toBe('String');
    });

    it('should extract constructors correctly', () => {
      const code = `
package com.example;

public class User {
  public User(String name, int age) {
    this.name = name;
    this.age = age;
  }
}
      `;

      const result = bridge.parseCode(code, 'User.java');
      const userClass = result.classes[0];

      expect(userClass.constructors).toHaveLength(1);

      const constructor = userClass.constructors[0];
      expect(constructor.parameters).toHaveLength(2);
      expect(constructor.parameters[0].name).toBe('name');
      expect(constructor.parameters[0].type).toBe('String');
      expect(constructor.parameters[1].name).toBe('age');
      expect(constructor.parameters[1].type).toBe('int');
      expect(constructor.modifiers).toContain('public');
    });
  });

  describe('Interface Parsing', () => {
    it('should parse Java interface', () => {
      const code = `
package com.example;

public interface Service {
  void start();
  void stop();
  boolean isRunning();
}
      `;

      const result = bridge.parseCode(code, 'Service.java');

      expect(result.interfaces).toHaveLength(1);

      const service = result.interfaces[0];
      expect(service.name).toBe('Service');
      expect(service.packageName).toBe('com.example');
      expect(service.methods).toHaveLength(3);
      expect(service.modifiers).toContain('public');
    });

    it('should parse interface with extends', () => {
      const code = `
package com.example;

public interface ExtendedService extends Service, AnotherService {
  void pause();
}
      `;

      const result = bridge.parseCode(code, 'ExtendedService.java');

      const service = result.interfaces[0];
      expect(service.extends).toHaveLength(2);
      expect(service.extends).toContain('Service');
      expect(service.extends).toContain('AnotherService');
    });
  });

  describe('Class Inheritance', () => {
    it('should handle class inheritance', () => {
      const code = `
package com.example;

public class AdminUser extends User implements Service {
  private String role;
}
      `;

      const result = bridge.parseCode(code, 'AdminUser.java');
      const adminUser = result.classes[0];

      expect(adminUser.superClass).toBe('User');
      expect(adminUser.interfaces).toHaveLength(1);
      expect(adminUser.interfaces).toContain('Service');
    });

    it('should detect abstract classes', () => {
      const code = `
package com.example;

public abstract class AbstractService implements Service {
  public abstract void initialize();
}
      `;

      const result = bridge.parseCode(code, 'AbstractService.java');
      const abstractService = result.classes[0];

      expect(abstractService.isAbstract).toBe(true);
      expect(abstractService.modifiers).toContain('abstract');
    });

    it('should detect abstract methods', () => {
      const code = `
package com.example;

public abstract class AbstractService {
  public abstract void initialize();
  public void start() {}
}
      `;

      const result = bridge.parseCode(code, 'AbstractService.java');
      const abstractService = result.classes[0];

      const initMethod = abstractService.methods.find(m => m.name === 'initialize');
      expect(initMethod?.isAbstract).toBe(true);

      const startMethod = abstractService.methods.find(m => m.name === 'start');
      expect(startMethod?.isAbstract).toBe(false);
    });
  });

  describe('Annotations', () => {
    it('should parse class annotations', () => {
      const code = `
package com.example;

@Deprecated
public class LegacyService {
}
      `;

      const result = bridge.parseCode(code, 'LegacyService.java');
      const legacyService = result.classes[0];

      expect(legacyService.annotations).toHaveLength(1);
      expect(legacyService.annotations[0].name).toBe('Deprecated');
    });

    it('should parse method annotations', () => {
      const code = `
package com.example;

public class Service {
  @Override
  @Deprecated
  public void stop() {}
}
      `;

      const result = bridge.parseCode(code, 'Service.java');
      const service = result.classes[0];
      const stopMethod = service.methods[0];

      expect(stopMethod.annotations).toHaveLength(2);
      const annotationNames = stopMethod.annotations.map(a => a.name);
      expect(annotationNames).toContain('Override');
      expect(annotationNames).toContain('Deprecated');
    });
  });

  describe('Enum Parsing', () => {
    it('should parse Java enum', () => {
      const code = `
package com.example;

public enum Status {
  ACTIVE,
  INACTIVE,
  PENDING
}
      `;

      const result = bridge.parseCode(code, 'Status.java');

      expect(result.enums).toHaveLength(1);

      const status = result.enums[0];
      expect(status.name).toBe('Status');
      expect(status.packageName).toBe('com.example');
      expect(status.values).toHaveLength(3);
      expect(status.values).toContain('ACTIVE');
      expect(status.values).toContain('INACTIVE');
      expect(status.values).toContain('PENDING');
    });
  });

  describe('Access Modifiers', () => {
    it('should detect public modifier', () => {
      const code = `
package com.example;

public class PublicClass {
  public String publicField;
  public void publicMethod() {}
}
      `;

      const result = bridge.parseCode(code, 'PublicClass.java');
      const cls = result.classes[0];

      expect(cls.modifiers).toContain('public');
      expect(cls.fields[0].modifiers).toContain('public');
      expect(cls.methods[0].modifiers).toContain('public');
    });

    it('should detect private modifier', () => {
      const code = `
package com.example;

class PrivateClass {
  private String privateField;
  private void privateMethod() {}
}
      `;

      const result = bridge.parseCode(code, 'PrivateClass.java');
      const cls = result.classes[0];

      expect(cls.fields[0].modifiers).toContain('private');
      expect(cls.methods[0].modifiers).toContain('private');
    });

    it('should detect protected modifier', () => {
      const code = `
package com.example;

class TestClass {
  protected String protectedField;
  protected void protectedMethod() {}
}
      `;

      const result = bridge.parseCode(code, 'TestClass.java');
      const cls = result.classes[0];

      expect(cls.fields[0].modifiers).toContain('protected');
      expect(cls.methods[0].modifiers).toContain('protected');
    });

    it('should detect static modifier', () => {
      const code = `
package com.example;

class TestClass {
  public static String staticField;
  public static void staticMethod() {}
}
      `;

      const result = bridge.parseCode(code, 'TestClass.java');
      const cls = result.classes[0];

      expect(cls.fields[0].modifiers).toContain('static');
      expect(cls.methods[0].modifiers).toContain('static');
    });

    it('should detect final modifier', () => {
      const code = `
package com.example;

class TestClass {
  public final String finalField = "test";
  public final void finalMethod() {}
}
      `;

      const result = bridge.parseCode(code, 'TestClass.java');
      const cls = result.classes[0];

      expect(cls.fields[0].modifiers).toContain('final');
      expect(cls.methods[0].modifiers).toContain('final');
    });
  });

  describe('Package Detection', () => {
    it('should detect package from package declaration', () => {
      const code = `
package com.example.service;

public class TestClass {
}
      `;

      const result = bridge.parseCode(code, 'TestClass.java');

      expect(result.name).toBe('com.example.service');
      expect(result.classes[0].packageName).toBe('com.example.service');
    });

    it('should handle default package', () => {
      const code = `
public class TestClass {
}
      `;

      const result = bridge.parseCode(code, 'TestClass.java');

      expect(result.name).toBe('');
      expect(result.classes[0].packageName).toBe('');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid Java code gracefully', () => {
      const code = `
package com.example;

public class Invalid {
  // incomplete class
      `;

      expect(() => {
        bridge.parseCode(code, 'Invalid.java');
      }).not.toThrow();
    });

    it('should return empty result for empty code', () => {
      const result = bridge.parseCode('', 'Empty.java');

      expect(result.classes).toHaveLength(0);
      expect(result.interfaces).toHaveLength(0);
      expect(result.enums).toHaveLength(0);
    });
  });
});
