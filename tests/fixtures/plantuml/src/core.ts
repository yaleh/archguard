export interface Timestamped {
  createdAt: Date;
}

export abstract class BaseEntity<T> {
  protected createdAt: Date = new Date();
  abstract getId(): string;
}

export enum Role {
  Admin,
  Member,
}
