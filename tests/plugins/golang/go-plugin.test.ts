/**
 * Tests for GoPlugin
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GoPlugin } from '../../../src/plugins/golang/index.js';

describe('GoPlugin', () => {
  let plugin: GoPlugin;

  beforeEach(async () => {
    plugin = new GoPlugin();
    await plugin.initialize({ workspaceRoot: '/tmp' });
  });

  describe('metadata', () => {
    it('should have correct metadata', () => {
      expect(plugin.metadata.name).toBe('golang');
      expect(plugin.metadata.displayName).toBe('Go (Golang)');
      expect(plugin.metadata.fileExtensions).toContain('.go');
      expect(plugin.metadata.capabilities.singleFileParsing).toBe(true);
      expect(plugin.metadata.capabilities.typeInference).toBe(true);
    });
  });

  describe('canHandle', () => {
    it('should handle .go files', () => {
      expect(plugin.canHandle('main.go')).toBe(true);
      expect(plugin.canHandle('/path/to/file.go')).toBe(true);
    });

    it('should not handle non-Go files', () => {
      expect(plugin.canHandle('main.ts')).toBe(false);
      expect(plugin.canHandle('main.js')).toBe(false);
    });
  });

  describe('parseCode', () => {
    it('should parse simple Go struct', () => {
      const code = `
package main

type User struct {
  Name string
  Age int
}
`;

      const result = plugin.parseCode(code, 'test.go');

      expect(result.language).toBe('go');
      expect(result.version).toBe('1.0');
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('User');
      expect(result.entities[0].type).toBe('struct');
      expect(result.entities[0].members).toHaveLength(2);
    });

    it('should parse interface and detect implementation', () => {
      const code = `
package main

type Runner interface {
  Start()
  Stop()
}

type Service struct {
  Name string
}

func (s Service) Start() {
}

func (s Service) Stop() {
}
`;

      const result = plugin.parseCode(code, 'test.go');

      expect(result.entities).toHaveLength(2);

      const iface = result.entities.find(e => e.name === 'Runner');
      expect(iface).toBeDefined();
      expect(iface?.type).toBe('interface');

      const struct = result.entities.find(e => e.name === 'Service');
      expect(struct).toBeDefined();
      expect(struct?.type).toBe('struct');

      // Check implementation relation
      expect(result.relations).toHaveLength(1);
      expect(result.relations[0].type).toBe('implementation');
      expect(result.relations[0].source).toBe('main.Service');
      expect(result.relations[0].target).toBe('main.Runner');
    });

    it('should handle multiple structs and interfaces', () => {
      const code = `
package main

type User struct {
  Name string
}

type Admin struct {
  User User
  Level int
}

type Authenticator interface {
  Login(username string, password string) bool
}
`;

      const result = plugin.parseCode(code, 'test.go');

      expect(result.entities).toHaveLength(3);
      expect(result.entities.filter(e => e.type === 'struct')).toHaveLength(2);
      expect(result.entities.filter(e => e.type === 'interface')).toHaveLength(1);
    });

    it('should extract field visibility', () => {
      const code = `
package main

type User struct {
  Name string
  age int
}
`;

      const result = plugin.parseCode(code, 'test.go');

      const user = result.entities[0];
      const nameField = user.members.find(m => m.name === 'Name');
      const ageField = user.members.find(m => m.name === 'age');

      expect(nameField?.visibility).toBe('public');
      expect(ageField?.visibility).toBe('private');
    });

    it('should extract method information', () => {
      const code = `
package main

type User struct {
  Name string
}

func (u User) GetName() string {
  return u.Name
}
`;

      const result = plugin.parseCode(code, 'test.go');

      const user = result.entities[0];
      const methods = user.members.filter(m => m.type === 'method');

      expect(methods).toHaveLength(1);
      expect(methods[0].name).toBe('GetName');
      expect(methods[0].returnType).toBe('string');
    });
  });

  describe('initialization', () => {
    it('should require initialization before use', async () => {
      const uninitializedPlugin = new GoPlugin();

      expect(() => {
        uninitializedPlugin.parseCode('package main', 'test.go');
      }).toThrow('GoPlugin not initialized');
    });

    it('should allow multiple initializations', async () => {
      await plugin.initialize({ workspaceRoot: '/tmp' });
      await plugin.initialize({ workspaceRoot: '/tmp' });

      // Should not throw
      const result = plugin.parseCode('package main', 'test.go');
      expect(result.language).toBe('go');
    });
  });

  describe('dispose', () => {
    it('should dispose resources', async () => {
      await plugin.dispose();

      expect(() => {
        plugin.parseCode('package main', 'test.go');
      }).toThrow('GoPlugin not initialized');
    });
  });
});
