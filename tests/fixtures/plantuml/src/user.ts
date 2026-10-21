import { BaseEntity, Role, Timestamped } from './core.js';

export class UserProfile extends BaseEntity<string> implements Timestamped {
  private cache: Map<string, string> = new Map();
  createdAt: Date = new Date();
  role: Role = Role.Member;

  getId(): string {
    return 'user';
  }

  display(): string {
    return this.cache.get('name') ?? '';
  }

  money(): Wallet {
    return new Wallet();
  }
}

export class Wallet {
  balance = 0;
}

export class Money$ {
  amount = 0;
}
