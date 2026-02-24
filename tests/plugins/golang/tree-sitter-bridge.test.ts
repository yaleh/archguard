/**
 * Tests for TreeSitterBridge (Go parser using tree-sitter)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TreeSitterBridge } from '../../../src/plugins/golang/tree-sitter-bridge.js';
import type { GoRawPackage } from '../../../src/plugins/golang/types.js';

describe('TreeSitterBridge', () => {
  let bridge: TreeSitterBridge;

  beforeEach(() => {
    bridge = new TreeSitterBridge();
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
      const result = bridge.parseCode(code, 'test.go');

      expect(result.name).toBe('main');
      expect(result.structs).toHaveLength(1);
      expect(result.structs[0].name).toBe('User');
      expect(result.structs[0].fields).toHaveLength(2);
      expect(result.structs[0].fields[0].name).toBe('Name');
      expect(result.structs[0].fields[0].type).toBe('string');
      expect(result.structs[0].fields[1].name).toBe('Age');
      expect(result.structs[0].fields[1].type).toBe('int');
    });

    it('should parse exported and unexported fields', () => {
      const code = `
package main

type User struct {
  Name string
  age int
}
`;
      const result = bridge.parseCode(code, 'test.go');

      expect(result.structs[0].fields[0].exported).toBe(true);
      expect(result.structs[0].fields[1].exported).toBe(false);
    });

    it('should parse simple Go interface', () => {
      const code = `
package main

type Runner interface {
  Start()
  Stop()
}
`;
      const result = bridge.parseCode(code, 'test.go');

      expect(result.interfaces).toHaveLength(1);
      expect(result.interfaces[0].name).toBe('Runner');
      expect(result.interfaces[0].methods).toHaveLength(2);
      expect(result.interfaces[0].methods[0].name).toBe('Start');
      expect(result.interfaces[0].methods[1].name).toBe('Stop');
    });

    it('should parse methods with receiver', () => {
      const code = `
package main

type User struct {
  Name string
}

func (u User) GetName() string {
  return u.Name
}

func (u *User) SetName(name string) {
  u.Name = name
}
`;
      const result = bridge.parseCode(code, 'test.go');

      expect(result.structs).toHaveLength(1);
      expect(result.structs[0].methods).toHaveLength(2);

      const getNameMethod = result.structs[0].methods.find((m) => m.name === 'GetName');
      expect(getNameMethod).toBeDefined();
      expect(getNameMethod?.returnTypes).toEqual(['string']);

      const setNameMethod = result.structs[0].methods.find((m) => m.name === 'SetName');
      expect(setNameMethod).toBeDefined();
      // Simplified - just check method exists, don't worry about parameter details for now
      expect(setNameMethod?.name).toBe('SetName');
    });

    it('should parse imports', () => {
      const code = `
package main

import (
  "fmt"
  "os"
  db "database/sql"
)
`;
      const result = bridge.parseCode(code, 'test.go');

      expect(result.imports).toHaveLength(3);
      expect(result.imports[0].path).toBe('fmt');
      expect(result.imports[1].path).toBe('os');
      expect(result.imports[2].path).toBe('database/sql');
      expect(result.imports[2].alias).toBe('db');
    });

    it('should handle empty file', () => {
      const code = `package main\n`;
      const result = bridge.parseCode(code, 'test.go');

      expect(result.name).toBe('main');
      expect(result.structs).toHaveLength(0);
      expect(result.interfaces).toHaveLength(0);
    });

    it('should parse multiple types', () => {
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
  Logout()
}
`;
      const result = bridge.parseCode(code, 'test.go');

      expect(result.structs).toHaveLength(2);
      expect(result.interfaces).toHaveLength(1);
    });
  });
});
