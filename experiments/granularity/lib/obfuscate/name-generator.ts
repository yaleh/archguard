/**
 * Deterministic obfuscated-name generator (Stage 59.2).
 *
 * All names are pure functions of (seed, per-namespace counter). Targets are
 * collected in sorted (file path, position) order by the renamer, so two runs
 * over the same tree always produce identical names — byte determinism.
 *
 * Formats: entities `Xq7`, methods `m4`, properties `p2`, locals `v9`,
 * type params `t1`, external members `x3`, files `f5.ts`, dirs `d2`,
 * strings `s7`, regexes `r1`, packages `pkg3`.
 */

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';

/** Small deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class NameGenerator {
  private readonly counters = new Map<string, number>();

  constructor(private readonly seed: number) {}

  private next(ns: string): number {
    const n = (this.counters.get(ns) ?? 0) + 1;
    this.counters.set(ns, n);
    return n;
  }

  /** Entity name, e.g. `Xq7`: seeded letters + sequential index. */
  entity(): string {
    const i = this.next('entity');
    const rng = mulberry32(Math.imul(this.seed, 0x9e3779b9) ^ i);
    const u = UPPER[Math.floor(rng() * 26)];
    const l = LOWER[Math.floor(rng() * 26)];
    return `${u}${l}${i}`;
  }

  method(): string {
    return `m${this.next('member')}`;
  }

  property(): string {
    return `p${this.next('member')}`;
  }

  local(): string {
    return `v${this.next('local')}`;
  }

  typeParam(): string {
    return `t${this.next('typeParam')}`;
  }

  /** External (node_modules) member-access placeholder. */
  externalMember(): string {
    return `x${this.next('externalMember')}`;
  }

  file(): string {
    return `f${this.next('file')}`;
  }

  dir(): string {
    return `d${this.next('dir')}`;
  }

  str(): string {
    return `s${this.next('string')}`;
  }

  regex(): string {
    return `r${this.next('regex')}`;
  }

  pkg(): string {
    return `pkg${this.next('pkg')}`;
  }
}
