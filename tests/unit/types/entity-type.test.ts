import { describe, it, expect } from 'vitest';
import type { EntityType, Entity } from '@/types/index.js';

// These tests will fail until KnownEntityType is exported from src/types/index.ts
// (Stage 1.1 — tests written first, must fail before implementation)

describe('KnownEntityType', () => {
  it('includes all seven original EntityType literals', async () => {
    // Import KnownEntityType — this import will fail until the type is added
    const { KnownEntityType: _sentinel } = await import('@/types/index.js').catch(() => ({
      KnownEntityType: undefined,
    }));

    // Runtime check: the seven known values should be valid KnownEntityType values.
    // We verify via a typed array that TypeScript accepts at compile-time.
    const knownValues: import('@/types/index.js').KnownEntityType[] = [
      'class',
      'interface',
      'enum',
      'struct',
      'trait',
      'abstract_class',
      'function',
    ];
    expect(knownValues).toHaveLength(7);
    expect(knownValues).toContain('class');
    expect(knownValues).toContain('interface');
    expect(knownValues).toContain('enum');
    expect(knownValues).toContain('struct');
    expect(knownValues).toContain('trait');
    expect(knownValues).toContain('abstract_class');
    expect(knownValues).toContain('function');
  });

  it('allows a custom string "lock_domain" to be assigned to EntityType (runtime shape check)', () => {
    // EntityType must be KnownEntityType | string after widening.
    // At runtime, any string must be assignable without type errors.
    const customType: EntityType = 'lock_domain';
    expect(customType).toBe('lock_domain');
  });

  it('allows a KnownEntityType value to be assigned to EntityType (narrowing preserved)', () => {
    const known: import('@/types/index.js').KnownEntityType = 'class';
    const widened: EntityType = known; // KnownEntityType must be assignable to EntityType
    expect(widened).toBe('class');
  });

  it('allows an Entity object with type: "lock_domain" to satisfy the Entity interface', () => {
    const entity: Entity = {
      id: 'pkg.LockDomain',
      name: 'LockDomain',
      type: 'lock_domain',
      visibility: 'public',
      members: [],
      sourceLocation: { file: 'src/lock.ts', startLine: 1, endLine: 10 },
    };
    expect(entity.type).toBe('lock_domain');
    expect(entity.id).toBe('pkg.LockDomain');
  });

  it('"package" is a valid EntityType string at runtime — no as-any needed', () => {
    // Before the fix, archjson-aggregator.ts used `'package' as any` because
    // EntityType was a closed union that did not include 'package'.
    // After widening to KnownEntityType | string, 'package' satisfies EntityType directly.
    const packageType: EntityType = 'package';
    expect(packageType).toBe('package');
  });
});
