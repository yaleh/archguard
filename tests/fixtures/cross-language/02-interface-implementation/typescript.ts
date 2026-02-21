/**
 * Interface implementation fixture for cross-language testing
 * Represents an interface with a concrete implementation
 */

export interface IRepository {
  findById(id: string): string | null;
  save(id: string, data: string): void;
}

export class InMemoryRepository implements IRepository {
  private data: Map<string, string>;

  constructor() {
    this.data = new Map();
  }

  public findById(id: string): string | null {
    return this.data.get(id) ?? null;
  }

  public save(id: string, data: string): void {
    this.data.set(id, data);
  }
}
