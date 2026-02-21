/**
 * Composition fixture for cross-language testing
 * Represents composition pattern where one class contains another
 */

export class Address {
  public street: string;
  public city: string;

  constructor(street: string, city: string) {
    this.street = street;
    this.city = city;
  }

  public getFullAddress(): string {
    return `${this.street}, ${this.city}`;
  }
}

export class Person {
  public name: string;
  public address: Address;

  constructor(name: string, address: Address) {
    this.name = name;
    this.address = address;
  }

  public getPersonInfo(): string {
    return `${this.name} lives at ${this.address.getFullAddress()}`;
  }
}
