/** Fixture: reference side, exercising criteria (i)-(iii). */
import { Greeter, topFn, arrowTop } from './a'; // (i) import position: no edge

export class Caller {
  private g: Greeter; // (i) type annotation: no edge

  constructor() {
    this.g = new Greeter(); // (ii) new => call edge to Greeter.constructor
  }

  run(): void {
    this.g.greet(); // (ii) obj.m() => call edge Caller.run -> Greeter.greet
    const xs = [1, 2];
    xs.map(this.callback); // (ii) value position => reference edge (not in main GT)
    function inner(): number {
      return topFn(); // (iii) nested: source is Caller.run.inner
    }
    inner();
  }

  callback(n: number): number {
    return n;
  }
}

export type GreeterCtor = typeof Greeter; // (i) typeof / pure type position: no edge

topFn(); // (iii) module top-level call: source <module-top>
arrowTop(); // top-level call to arrow const target
