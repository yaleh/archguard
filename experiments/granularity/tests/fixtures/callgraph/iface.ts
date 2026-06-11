/** Fixture: interface dispatch, criterion (iv). One interface, two implementations. */
export interface Runner {
  run(): void;
}

export class FastRunner implements Runner {
  run(): void {
    // fast
  }
}

export class SlowRunner implements Runner {
  run(): void {
    // slow
  }
}

export function drive(r: Runner): void {
  r.run(); // (iv) via interface-typed receiver
}

export function direct(): void {
  new FastRunner().run(); // concrete dispatch: NOT via interface
}
