/**
 * Bidirectional obfuscation mapping (Stage 59.2/59.3).
 *
 * Namespaces (proposal §5 step 6 — used only for scoring/reconciliation,
 * never enters any prompt):
 * - entities:  top-level class/interface/enum/type/function/const names
 * - members:   `Owner.member` qualified names (interface-member propagation
 *              yields one entry per affected declaration)
 * - files:     repo-relative original path -> obf-tree relative path
 * - strings:   string literal values + regex literal texts -> placeholders
 * - packages:  external bare specifiers -> pkgN
 * - locals:    reverse-only record of params/locals/import bindings etc.
 */

export interface BidiMap {
  forward: Record<string, string>;
  reverse: Record<string, string>;
}

export interface ObfuscationMapping {
  seed: number;
  entities: BidiMap;
  members: BidiMap;
  files: BidiMap;
  strings: BidiMap;
  packages: BidiMap;
  locals: { reverse: Record<string, string> };
}

function emptyBidi(): BidiMap {
  return { forward: {}, reverse: {} };
}

export class MappingBuilder {
  private readonly mapping: ObfuscationMapping;

  constructor(seed: number) {
    this.mapping = {
      seed,
      entities: emptyBidi(),
      members: emptyBidi(),
      files: emptyBidi(),
      strings: emptyBidi(),
      packages: emptyBidi(),
      locals: { reverse: {} },
    };
  }

  /** Add to a bidi namespace; qualifies the key on (rare) duplicate originals. */
  private add(ns: BidiMap, original: string, obf: string, qualifier?: string): void {
    let key = original;
    if (ns.forward[key] !== undefined && ns.forward[key] !== obf) {
      key = qualifier ? `${original}@${qualifier}` : original;
      if (ns.forward[key] !== undefined && ns.forward[key] !== obf) return;
    }
    ns.forward[key] = obf;
    if (ns.reverse[obf] === undefined) ns.reverse[obf] = key;
  }

  addEntity(original: string, obf: string, relFile: string): void {
    this.add(this.mapping.entities, original, obf, relFile);
  }

  addMember(ownerOriginal: string, ownerObf: string, original: string, obf: string, relFile: string): void {
    this.add(this.mapping.members, `${ownerOriginal}.${original}`, `${ownerObf}.${obf}`, relFile);
  }

  addFile(originalRel: string, obfRel: string): void {
    this.add(this.mapping.files, originalRel, obfRel);
  }

  addString(originalValue: string, placeholder: string): void {
    this.add(this.mapping.strings, originalValue, placeholder);
  }

  addPackage(specifier: string, obf: string): void {
    this.add(this.mapping.packages, specifier, obf);
  }

  addLocal(obf: string, original: string): void {
    if (this.mapping.locals.reverse[obf] === undefined) {
      this.mapping.locals.reverse[obf] = original;
    }
  }

  build(): ObfuscationMapping {
    return this.mapping;
  }
}

/** Stable serialization (insertion order is deterministic by construction). */
export function serializeMapping(mapping: ObfuscationMapping): string {
  return `${JSON.stringify(mapping, null, 2)}\n`;
}
