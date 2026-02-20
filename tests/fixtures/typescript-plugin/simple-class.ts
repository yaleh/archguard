/**
 * Simple TypeScript class for testing
 */
export class SimpleClass {
  private value: string;

  constructor(value: string) {
    this.value = value;
  }

  getValue(): string {
    return this.value;
  }

  setValue(newValue: string): void {
    this.value = newValue;
  }
}
