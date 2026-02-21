/**
 * Simple class fixture for cross-language testing
 * Represents a basic User class with fields and methods
 */

export class User {
  private id: string;
  public name: string;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  public getName(): string {
    return this.name;
  }

  public setId(newId: string): void {
    this.id = newId;
  }
}
