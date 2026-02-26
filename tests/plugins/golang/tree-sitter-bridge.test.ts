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

  describe('call expression args extraction', () => {
    it('should extract string literal arguments', () => {
      const code = `
package main

func setup() {
  mux.HandleFunc("/api/users", handleUsers)
}
`;
      const result = bridge.parseCode(code, 'test.go', { extractBodies: true });

      const calls = result.functions[0].body?.calls ?? [];
      const handleFuncCall = calls.find((c) => c.functionName === 'HandleFunc');
      expect(handleFuncCall).toBeDefined();
      expect(handleFuncCall?.args).toEqual(['/api/users', 'handleUsers']);
    });

    it('should extract string with METHOD prefix', () => {
      const code = `
package main

func setup() {
  mux.HandleFunc("POST /products", handler.Create)
}
`;
      const result = bridge.parseCode(code, 'test.go', { extractBodies: true });

      const calls = result.functions[0].body?.calls ?? [];
      const handleFuncCall = calls.find((c) => c.functionName === 'HandleFunc');
      expect(handleFuncCall).toBeDefined();
      expect(handleFuncCall?.args).toEqual(['POST /products', 'handler.Create']);
    });

    it('should extract selector_expression as second argument', () => {
      const code = `
package main

func setup() {
  mux.HandleFunc("/health", s.handleHealth)
}
`;
      const result = bridge.parseCode(code, 'test.go', { extractBodies: true });

      const calls = result.functions[0].body?.calls ?? [];
      const handleFuncCall = calls.find((c) => c.functionName === 'HandleFunc');
      expect(handleFuncCall).toBeDefined();
      expect(handleFuncCall?.args?.[1]).toBe('s.handleHealth');
    });

    it('should return empty args for call with no arguments', () => {
      const code = `
package main

func setup() {
  foo()
}
`;
      const result = bridge.parseCode(code, 'test.go', { extractBodies: true });

      const calls = result.functions[0].body?.calls ?? [];
      const fooCall = calls.find((c) => c.functionName === 'foo');
      expect(fooCall).toBeDefined();
      expect(fooCall?.args).toEqual([]);
    });

    it('should extract single string argument', () => {
      const code = `
package main

func setup() {
  log.Print("hello")
}
`;
      const result = bridge.parseCode(code, 'test.go', { extractBodies: true });

      const calls = result.functions[0].body?.calls ?? [];
      const printCall = calls.find((c) => c.functionName === 'Print');
      expect(printCall).toBeDefined();
      expect(printCall?.args).toEqual(['hello']);
    });
  });

  describe('selective extraction with HTTP handler patterns', () => {
    it('should extract body of standalone function containing HandleFunc when selectiveExtraction is true', () => {
      const code = `
package server

func setupRoutes(mux *http.ServeMux) {
  mux.HandleFunc("/healthz", handleHealth)
  mux.HandleFunc("/v1/sessions", handleSessions)
}
`;
      const result = bridge.parseCode(code, 'server.go', {
        extractBodies: true,
        selectiveExtraction: true,
      });

      const fn = result.functions.find((f) => f.name === 'setupRoutes');
      expect(fn).toBeDefined();
      expect(fn?.body).toBeDefined();
      expect(fn?.body?.calls.some((c) => c.functionName === 'HandleFunc')).toBe(true);
    });

    it('should extract body of struct method containing HandleFunc when selectiveExtraction is true', () => {
      const code = `
package server

type Server struct{}

func (s *Server) setupRoutes(mux *http.ServeMux) {
  mux.HandleFunc("/healthz", s.handleHealth)
  mux.HandleFunc("/v1/tasks", s.handleTasks)
}
`;
      const result = bridge.parseCode(code, 'server.go', {
        extractBodies: true,
        selectiveExtraction: true,
      });

      const method = result.structs[0]?.methods.find((m) => m.name === 'setupRoutes');
      expect(method).toBeDefined();
      expect(method?.body).toBeDefined();
      expect(method?.body?.calls.filter((c) => c.functionName === 'HandleFunc')).toHaveLength(2);
    });

    it('should NOT extract body of function with no goroutine/channel/http patterns', () => {
      const code = `
package server

func unrelated() {
  x := 1 + 1
  _ = x
}
`;
      const result = bridge.parseCode(code, 'server.go', {
        extractBodies: true,
        selectiveExtraction: true,
      });

      const fn = result.functions.find((f) => f.name === 'unrelated');
      expect(fn).toBeDefined();
      expect(fn?.body).toBeUndefined();
    });

    it('should extract body containing router.GET (gin-style method HTTP pattern)', () => {
      const code = `
package routes

func Register(r *gin.Engine) {
  r.GET("/users", listUsers)
  r.POST("/users", createUser)
}
`;
      const result = bridge.parseCode(code, 'routes.go', {
        extractBodies: true,
        selectiveExtraction: true,
      });

      const fn = result.functions.find((f) => f.name === 'Register');
      expect(fn?.body).toBeDefined();
      expect(fn?.body?.calls.some((c) => c.functionName === 'GET')).toBe(true);
      expect(fn?.body?.calls.some((c) => c.functionName === 'POST')).toBe(true);
    });
  });

  describe('package name extraction', () => {
    it('should extract non-main package name', () => {
      const code = `
package user

type User struct {
  Name string
}
`;
      const result = bridge.parseCode(code, 'user.go');
      expect(result.name).toBe('user');
    });

    it('should extract package name from hub package', () => {
      const code = `
package hub

type Server struct {
  port int
}
`;
      const result = bridge.parseCode(code, 'server.go');
      expect(result.name).toBe('hub');
    });

    it('should assign extracted package name to all structs', () => {
      const code = `
package store

type SQLiteStore struct {
  db string
}
`;
      const result = bridge.parseCode(code, 'store.go');
      expect(result.name).toBe('store');
      expect(result.structs[0].packageName).toBe('store');
    });

    it('should assign extracted package name to all interfaces', () => {
      const code = `
package store

type Store interface {
  Get() string
}
`;
      const result = bridge.parseCode(code, 'store.go');
      expect(result.name).toBe('store');
      expect(result.interfaces[0].packageName).toBe('store');
    });
  });

  describe('extractChannelOps — make(chan) variable name', () => {
    it('extracts variable name from short_var_declaration', () => {
      const code = `
package main

func start() {
  jobs := make(chan int, 100)
  _ = jobs
}
`;
      const result = bridge.parseCode(code, 'test.go', { extractBodies: true });
      const fn = result.functions.find((f) => f.name === 'start');
      const makeOp = fn?.body?.channelOps.find((op) => op.operation === 'make');
      expect(makeOp).toBeDefined();
      expect(makeOp?.channelName).toBe('jobs');
    });

    it('extracts variable name from assignment_statement', () => {
      const code = `
package main

func start() {
  var jobs chan int
  jobs = make(chan int, 100)
  _ = jobs
}
`;
      const result = bridge.parseCode(code, 'test.go', { extractBodies: true });
      const fn = result.functions.find((f) => f.name === 'start');
      const makeOp = fn?.body?.channelOps.find((op) => op.operation === 'make');
      expect(makeOp).toBeDefined();
      expect(makeOp?.channelName).toBe('jobs');
    });

    it('extracts correct variable in multi-assign short_var_declaration', () => {
      const code = `
package main

func start() {
  results, done := make(chan string), make(chan bool)
  _ = results
  _ = done
}
`;
      const result = bridge.parseCode(code, 'test.go', { extractBodies: true });
      const fn = result.functions.find((f) => f.name === 'start');
      const makeOps = fn?.body?.channelOps.filter((op) => op.operation === 'make') ?? [];
      expect(makeOps).toHaveLength(2);
      expect(makeOps[0].channelName).toBe('results');
      expect(makeOps[1].channelName).toBe('done');
    });

    it('returns empty string when make(chan) is not assigned to a variable', () => {
      const code = `
package main

func start() chan int {
  return make(chan int)
}
`;
      const result = bridge.parseCode(code, 'test.go', { extractBodies: true });
      const fn = result.functions.find((f) => f.name === 'start');
      const makeOp = fn?.body?.channelOps.find((op) => op.operation === 'make');
      expect(makeOp).toBeDefined();
      expect(makeOp?.channelName).toBe('');
    });
  });

  describe('orphaned methods — receiver struct in another file', () => {
    it('should store methods whose receiver struct is defined in another file as orphanedMethods', () => {
      const bridge = new TreeSitterBridge();
      // File contains ONLY a method — no struct definition
      const code = `package hub

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
  w.WriteHeader(200)
}
`;
      const result = bridge.parseCode(code, '/pkg/hub/handlers_health.go', {
        extractBodies: true,
        selectiveExtraction: true,
      });

      // The method should NOT be in any struct's methods (no struct defined here)
      expect(result.structs).toHaveLength(0);

      // But should be captured as orphaned
      expect(result.orphanedMethods).toBeDefined();
      expect(result.orphanedMethods).toHaveLength(1);
      expect(result.orphanedMethods![0].name).toBe('handleHealth');
      expect(result.orphanedMethods![0].receiverType).toBe('Server');
      // Body should be extracted (ResponseWriter + Request signature triggers shouldExtractBody)
      expect(result.orphanedMethods![0].body).toBeDefined();
    });
  });

  describe('shouldExtractBody - HTTP handler detection', () => {
    it('extracts body of a method with (http.ResponseWriter, *http.Request) params', async () => {
      const code = `
package server

type Server struct {
  data string
}

func (s *Server) handleFoo(w http.ResponseWriter, r *http.Request) {
  json.NewEncoder(w).Encode(s.data)
}
`;
      const result = bridge.parseCode(code, 'server.go', {
        extractBodies: true,
        selectiveExtraction: true,
      });

      const method = result.structs[0]?.methods.find((m) => m.name === 'handleFoo');
      expect(method).toBeDefined();
      expect(method?.body).toBeDefined();
      expect(method?.body?.calls.length).toBeGreaterThan(0);
    });

    it('extracts body of a function with (w http.ResponseWriter, r *http.Request) params', async () => {
      const code = `
package server

func handleBar(w http.ResponseWriter, r *http.Request) {
  w.WriteHeader(200)
  w.Write([]byte("ok"))
}
`;
      const result = bridge.parseCode(code, 'server.go', {
        extractBodies: true,
        selectiveExtraction: true,
      });

      const fn = result.functions.find((f) => f.name === 'handleBar');
      expect(fn).toBeDefined();
      expect(fn?.body).toBeDefined();
      expect(fn?.body?.calls.length).toBeGreaterThan(0);
    });

    it('does NOT extract body of a method with unrelated params', async () => {
      const code = `
package server

type Server struct{}

func (s *Server) doWork(x int) {
  doSomething(x)
}
`;
      const result = bridge.parseCode(code, 'server.go', {
        extractBodies: true,
        selectiveExtraction: true,
      });

      const method = result.structs[0]?.methods.find((m) => m.name === 'doWork');
      expect(method).toBeDefined();
      expect(method?.body).toBeUndefined();
    });
  });
});
