import { describe, it, expect, afterEach } from 'vitest';
import { EntityTypeRegistry, globalEntityTypeRegistry } from '@/core/entity-type-registry.js';
import type { CustomEntityTypeDeclaration } from '@/core/interfaces/language-plugin.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDecl(
  type: string,
  overrides: Partial<CustomEntityTypeDeclaration> = {}
): CustomEntityTypeDeclaration {
  return {
    type,
    display: type.replace(/_/g, ' '),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EntityTypeRegistry', () => {
  afterEach(() => {
    // Ensure globalEntityTypeRegistry is clean between tests
    globalEntityTypeRegistry.clear();
  });

  // Test 1: register() stores a CustomEntityTypeDeclaration; get() retrieves it by type string
  it('register() stores a declaration and get() retrieves it by type string', () => {
    const registry = new EntityTypeRegistry();
    const decl = makeDecl('lock_domain', { mermaidShape: 'component', attributes: ['irq_safe'] });
    registry.register(decl);
    expect(registry.get('lock_domain')).toEqual(decl);
  });

  // Test 2: get() returns undefined for an unregistered type
  it('get() returns undefined for an unregistered type', () => {
    const registry = new EntityTypeRegistry();
    expect(registry.get('unknown_type')).toBeUndefined();
  });

  // Test 3: listCustomTypes() returns all registered type strings
  it('listCustomTypes() returns all registered type strings', () => {
    const registry = new EntityTypeRegistry();
    registry.register(makeDecl('lock_domain'));
    registry.register(makeDecl('entry_point'));
    registry.register(makeDecl('service'));
    const types = registry.listCustomTypes();
    expect(types).toHaveLength(3);
    expect(types).toContain('lock_domain');
    expect(types).toContain('entry_point');
    expect(types).toContain('service');
  });

  // Test 4: listCustomTypes() returns [] when nothing is registered
  it('listCustomTypes() returns [] when nothing is registered', () => {
    const registry = new EntityTypeRegistry();
    expect(registry.listCustomTypes()).toEqual([]);
  });

  // Test 5: clear() removes all entries; subsequent get() returns undefined
  it('clear() removes all entries and subsequent get() returns undefined', () => {
    const registry = new EntityTypeRegistry();
    registry.register(makeDecl('lock_domain'));
    registry.register(makeDecl('service'));
    registry.clear();
    expect(registry.listCustomTypes()).toEqual([]);
    expect(registry.get('lock_domain')).toBeUndefined();
    expect(registry.get('service')).toBeUndefined();
  });

  // Test 6: Registering same type twice: second register() overwrites first
  it('registering same type twice overwrites with the second registration', () => {
    const registry = new EntityTypeRegistry();
    const first = makeDecl('lock_domain', { mermaidShape: 'component' });
    const second = makeDecl('lock_domain', { mermaidShape: 'service' });
    registry.register(first);
    registry.register(second);
    expect(registry.get('lock_domain')).toEqual(second);
    expect(registry.listCustomTypes()).toHaveLength(1);
  });

  // Test 7: globalEntityTypeRegistry is a singleton (same reference from two imports)
  it('globalEntityTypeRegistry is a singleton — same reference from two imports', async () => {
    // Import the module again to verify the singleton
    const mod1 = await import('@/core/entity-type-registry.js');
    const mod2 = await import('@/core/entity-type-registry.js');
    expect(mod1.globalEntityTypeRegistry).toBe(mod2.globalEntityTypeRegistry);
  });

  // Test 16 (Phase 4): globalEntityTypeRegistry.clear() in afterEach has no side effects on isolation
  it('globalEntityTypeRegistry.clear() in afterEach leaves the registry empty for the next test', () => {
    // Register something
    globalEntityTypeRegistry.register(makeDecl('test_type_isolation'));
    expect(globalEntityTypeRegistry.get('test_type_isolation')).toBeDefined();
    // afterEach will clear this; subsequent tests start empty
    // Verify clear() works inline as well
    globalEntityTypeRegistry.clear();
    expect(globalEntityTypeRegistry.get('test_type_isolation')).toBeUndefined();
    expect(globalEntityTypeRegistry.listCustomTypes()).toEqual([]);
  });
});
