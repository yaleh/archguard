import { describe, it, expect } from 'vitest';
import { BaseExtractor } from '@/parser/base-extractor.js';
import { ClassExtractor } from '@/parser/class-extractor.js';
import { EnumExtractor } from '@/parser/enum-extractor.js';
import { InterfaceExtractor } from '@/parser/interface-extractor.js';
import { RelationExtractor } from '@/parser/relation-extractor.js';

// Concrete subclass to test abstract base
class ConcreteExtractor extends BaseExtractor {}

describe('BaseExtractor', () => {
  it('provides a protected project instance accessible via subclass', () => {
    const extractor = new ConcreteExtractor();
    // Access via type assertion to verify the protected field exists at runtime
    expect((extractor as any).project).toBeDefined();
  });

  it('subclass instances are instanceof BaseExtractor', () => {
    expect(new ConcreteExtractor()).toBeInstanceOf(BaseExtractor);
    expect(new ClassExtractor()).toBeInstanceOf(BaseExtractor);
    expect(new EnumExtractor()).toBeInstanceOf(BaseExtractor);
    expect(new InterfaceExtractor()).toBeInstanceOf(BaseExtractor);
    expect(new RelationExtractor()).toBeInstanceOf(BaseExtractor);
  });

  it('each subclass has its own project instance', () => {
    const a = new ConcreteExtractor();
    const b = new ConcreteExtractor();
    expect((a as any).project).not.toBe((b as any).project);
  });
});
