/** Fixture: declaration side. Line positions are asserted in callgraph tests. */
export class Greeter {
  greet(): string {
    return this.helper(); // call edge: Greeter.greet -> Greeter.helper
  }

  helper(): string {
    return 'hi';
  }
}

export function topFn(): number {
  return 1;
}

export const arrowTop = (): number => 2;
