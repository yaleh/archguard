import { describe, it, expect } from 'vitest';
import { TreeSitterBridge } from '@/plugins/java/tree-sitter-bridge.js';
import { ArchJsonMapper } from '@/plugins/java/archjson-mapper.js';

describe('Java call edge extraction', () => {
  const bridge = new TreeSitterBridge();
  const mapper = new ArchJsonMapper();

  it('extracts method_invocation call sites from method body', () => {
    const code = `
package com.example;
public class OrderService {
  private PaymentService paymentService;
  public void placeOrder(String item) {
    paymentService.charge(item);
  }
}`;
    const pkg = bridge.parseCode(code, 'OrderService.java');
    const method = pkg.classes[0].methods[0];
    expect(method.callSites).toBeDefined();
    expect(method.callSites.length).toBeGreaterThanOrEqual(1);
    const site = method.callSites[0];
    expect(site.receiverName).toBe('paymentService');
    expect(site.receiverType).toBe('PaymentService');
    expect(site.methodName).toBe('charge');
    expect(site.callerMethod).toBe('placeOrder');
  });

  it('resolves receiver type from constructor parameter when field type is unknown', () => {
    const code = `
package com.example;
public class Service {
  private Repo repo;
  public Service(Repo repo) { this.repo = repo; }
  public void process() { repo.save(); }
}`;
    const pkg = bridge.parseCode(code, 'Service.java');
    const method = pkg.classes[0].methods.find((m) => m.name === 'process');
    expect(method.callSites).toBeDefined();
    const site = method.callSites.find((s) => s.methodName === 'save');
    expect(site).toBeDefined();
    expect(site.receiverType).toBe('Repo');
  });

  it('skips calls with unresolvable receiver (confidence=0.5 fallback)', () => {
    const code = `
package com.example;
public class Foo {
  public void doIt() { unknownVar.someMethod(); }
}`;
    const pkg = bridge.parseCode(code, 'Foo.java');
    const method = pkg.classes[0].methods[0];
    const site = method.callSites?.find((s) => s.methodName === 'someMethod');
    // unresolvable → site still emitted but receiverType is undefined
    expect(site).toBeDefined();
    expect(site.receiverType).toBeUndefined();
  });

  it('skips this-object calls (same-class invocations)', () => {
    const code = `
package com.example;
public class Bar {
  public void a() { this.b(); }
  public void b() {}
}`;
    const pkg = bridge.parseCode(code, 'Bar.java');
    const method = pkg.classes[0].methods.find((m) => m.name === 'a');
    // this.b() → same-class call, should be skipped
    expect(method.callSites?.filter((s) => s.methodName === 'b').length ?? 0).toBe(0);
  });

  it('mapCallRelations emits call relations for known entities', () => {
    const code = `
package com.example;
public class A {
  private B b;
  public void run() { b.doWork(); }
}`;
    const pkg = bridge.parseCode(code, 'A.java');
    const entityNames = new Set(['B']);
    const relations = mapper.mapCallRelations([pkg], entityNames);
    expect(relations.length).toBeGreaterThanOrEqual(1);
    const rel = relations[0];
    expect(rel.type).toBe('call');
    expect(rel.sourceMethod).toBe('run');
    expect(rel.targetMethod).toBe('doWork');
    expect(rel.inferenceSource).toBe('tree-sitter');
  });

  it('mapCallRelations skips call sites whose receiver type is not in entityNames', () => {
    const code = `
package com.example;
public class A {
  private ExternalLib lib;
  public void run() { lib.fetch(); }
}`;
    const pkg = bridge.parseCode(code, 'A.java');
    const entityNames = new Set<string>(); // empty — ExternalLib unknown
    const relations = mapper.mapCallRelations([pkg], entityNames);
    expect(relations.length).toBe(0);
  });
});
