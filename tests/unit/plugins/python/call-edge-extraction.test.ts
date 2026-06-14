import { describe, it, expect } from 'vitest';
import { TreeSitterBridge } from '@/plugins/python/tree-sitter-bridge.js';
import { ArchJsonMapper } from '@/plugins/python/archjson-mapper.js';

describe('Python call edge extraction', () => {
  const bridge = new TreeSitterBridge();
  const mapper = new ArchJsonMapper();

  it('extracts self.field.method() call sites from method body', () => {
    const code = `
class OrderService:
    def __init__(self):
        self.payment_service = None

    def place_order(self, item):
        self.payment_service.charge(item)
`;
    const modules = bridge.parseCode(code, 'order_service.py');
    const method = modules.classes[0].methods.find(m => m.name === 'place_order')!;
    expect(method.callSites).toBeDefined();
    expect(method.callSites!.length).toBeGreaterThanOrEqual(1);
    const site = method.callSites![0];
    expect(site.receiverField).toBe('payment_service');
    expect(site.methodName).toBe('charge');
    expect(site.callerMethod).toBe('place_order');
  });

  it('skips standalone function calls (non-method)', () => {
    const code = `
class Foo:
    def bar(self):
        standalone_func()
        print("hello")
`;
    const modules = bridge.parseCode(code, 'foo.py');
    const method = modules.classes[0].methods.find(m => m.name === 'bar')!;
    // standalone calls should not appear in callSites
    expect(method.callSites?.length ?? 0).toBe(0);
  });

  it('skips self.method() calls (same-class calls)', () => {
    const code = `
class Foo:
    def a(self):
        self.b()
    def b(self):
        pass
`;
    const modules = bridge.parseCode(code, 'foo.py');
    const method = modules.classes[0].methods.find(m => m.name === 'a')!;
    // self.b() → same-class call (self, not a field), should be skipped
    expect(method.callSites?.length ?? 0).toBe(0);
  });

  it('mapCallRelations emits call relations for known entity field names', () => {
    const code = `
class OrderService:
    def __init__(self):
        self.payment_service = None
    def place_order(self, item):
        self.payment_service.charge(item)
`;
    const modules = [bridge.parseCode(code, 'order_service.py')];
    const entityFieldNames = new Set(['payment_service']);
    const relations = mapper.mapCallRelations(modules, entityFieldNames);
    expect(relations.length).toBeGreaterThanOrEqual(1);
    const rel = relations[0];
    expect(rel.type).toBe('call');
    expect(rel.sourceMethod).toBe('place_order');
    expect(rel.targetMethod).toBe('charge');
    expect(rel.inferenceSource).toBe('tree-sitter' as any);
  });

  it('mapCallRelations skips call sites where field is not in known set', () => {
    const code = `
class Foo:
    def __init__(self):
        self.external = None
    def run(self):
        self.external.fetch()
`;
    const modules = [bridge.parseCode(code, 'foo.py')];
    const entityFieldNames = new Set<string>(); // empty
    const relations = mapper.mapCallRelations(modules, entityFieldNames);
    expect(relations.length).toBe(0);
  });
});
