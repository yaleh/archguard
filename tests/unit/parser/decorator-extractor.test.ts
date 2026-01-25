/**
 * Unit tests for Decorator Extraction - Story 4
 * Testing decorator extraction from classes, methods, and properties
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ClassExtractor } from '@/parser/class-extractor';

describe('Decorator Extraction - Class Decorators', () => {
  let extractor: ClassExtractor;

  beforeEach(() => {
    extractor = new ClassExtractor();
  });

  it('should extract simple class decorator', () => {
    const code = `
      @Injectable()
      class UserService {}
    `;

    const result = extractor.extract(code);

    expect(result.decorators).toHaveLength(1);
    expect(result.decorators?.[0]?.name).toBe('Injectable');
  });

  it('should extract decorator without parentheses', () => {
    const code = `
      @Sealed
      class Config {}
    `;

    const result = extractor.extract(code);

    expect(result.decorators).toHaveLength(1);
    expect(result.decorators?.[0]?.name).toBe('Sealed');
  });

  it('should extract multiple class decorators', () => {
    const code = `
      @Injectable()
      @Singleton()
      class UserService {}
    `;

    const result = extractor.extract(code);

    expect(result.decorators).toHaveLength(2);
    expect(result.decorators?.[0]?.name).toBe('Injectable');
    expect(result.decorators?.[1]?.name).toBe('Singleton');
  });

  it('should extract decorator arguments as text', () => {
    const code = `
      @Component({
        selector: 'app-user',
        template: './user.html'
      })
      class UserComponent {}
    `;

    const result = extractor.extract(code);

    expect(result.decorators).toHaveLength(1);
    expect(result.decorators?.[0]?.name).toBe('Component');
    // Arguments stored as array of text
    expect(result.decorators?.[0]?.arguments).toBeDefined();
  });
});

describe('Decorator Extraction - Method Decorators', () => {
  let extractor: ClassExtractor;

  beforeEach(() => {
    extractor = new ClassExtractor();
  });

  it('should extract method decorators', () => {
    const code = `
      class UserService {
        @Cache(60)
        findUser(id: string): User {
          return null;
        }
      }
    `;

    const result = extractor.extract(code);

    expect(result.members[0]?.decorators).toHaveLength(1);
    expect(result.members[0]?.decorators?.[0]?.name).toBe('Cache');
  });

  it('should extract multiple method decorators', () => {
    const code = `
      class UserService {
        @Log()
        @Validate()
        @Cache(60)
        findUser(id: string): User {
          return null;
        }
      }
    `;

    const result = extractor.extract(code);

    expect(result.members[0]?.decorators).toHaveLength(3);
    expect(result.members[0]?.decorators?.[0]?.name).toBe('Log');
    expect(result.members[0]?.decorators?.[1]?.name).toBe('Validate');
    expect(result.members[0]?.decorators?.[2]?.name).toBe('Cache');
  });
});

describe('Decorator Extraction - Property Decorators', () => {
  let extractor: ClassExtractor;

  beforeEach(() => {
    extractor = new ClassExtractor();
  });

  it('should extract property decorators', () => {
    const code = `
      class User {
        @Required()
        name: string;
      }
    `;

    const result = extractor.extract(code);

    expect(result.members[0]?.decorators).toHaveLength(1);
    expect(result.members[0]?.decorators?.[0]?.name).toBe('Required');
  });

  it('should extract multiple property decorators', () => {
    const code = `
      class User {
        @Required()
        @MaxLength(100)
        name: string;
      }
    `;

    const result = extractor.extract(code);

    expect(result.members[0]?.decorators).toHaveLength(2);
    expect(result.members[0]?.decorators?.[0]?.name).toBe('Required');
    expect(result.members[0]?.decorators?.[1]?.name).toBe('MaxLength');
  });
});

describe('Decorator Extraction - Mixed', () => {
  let extractor: ClassExtractor;

  beforeEach(() => {
    extractor = new ClassExtractor();
  });

  it('should extract decorators from class, properties, and methods', () => {
    const code = `
      @Injectable()
      class UserService {
        @Inject()
        private db: Database;

        @Cache(60)
        async findUser(id: string): Promise<User> {
          return await this.db.query(id);
        }
      }
    `;

    const result = extractor.extract(code);

    // Class decorator
    expect(result.decorators).toHaveLength(1);
    expect(result.decorators?.[0]?.name).toBe('Injectable');

    // Property decorator
    const dbProperty = result.members.find((m) => m.name === 'db');
    expect(dbProperty?.decorators).toHaveLength(1);
    expect(dbProperty?.decorators?.[0]?.name).toBe('Inject');

    // Method decorator
    const findUserMethod = result.members.find((m) => m.name === 'findUser');
    expect(findUserMethod?.decorators).toHaveLength(1);
    expect(findUserMethod?.decorators?.[0]?.name).toBe('Cache');
  });
});
