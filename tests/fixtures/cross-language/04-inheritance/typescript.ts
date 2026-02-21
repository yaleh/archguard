/**
 * Inheritance fixture for cross-language testing
 * Represents inheritance pattern where one class extends another
 */

export class Animal {
  public name: string;
  public age: number;

  constructor(name: string, age: number) {
    this.name = name;
    this.age = age;
  }

  public makeSound(): string {
    return "Some generic sound";
  }
}

export class Dog extends Animal {
  public breed: string;

  constructor(name: string, age: number, breed: string) {
    super(name, age);
    this.breed = breed;
  }

  public makeSound(): string {
    return "Woof!";
  }

  public fetch(): string {
    return `${this.name} is fetching!`;
  }
}
