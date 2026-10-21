/**
 * Deterministic PlantUML generator.
 *
 * Produces a `@startuml` / `@enduml`-wrapped class diagram from ArchJSON plus a
 * format-neutral `GroupingDecision` (the same decision the Mermaid path uses).
 * No LLM, no rendering: the same input always yields byte-identical output.
 */

import type { ArchJSON, Entity } from '../types/index.js';
import type { DetailLevel } from '../types/config.js';
import type { GroupingDecision } from '../mermaid/types.js';
import {
  entityAlias,
  entityDisplayName,
  escapeId,
  generateClassDefinition,
  generatePackageHeader,
  generateRelationLine,
  normalizeEntityName,
  type PlantUmlEntityOptions,
} from './generator-formatting.js';

export interface PlantUmlGeneratorOptions {
  /** Detail level: package level emits entity shells, class/method emit members. */
  level: DetailLevel;
  /** Format-neutral grouping decision. */
  grouping: GroupingDecision;
  includePrivate?: boolean;
  includeProtected?: boolean;
}

function isFunctionEntity(entity: Entity): boolean {
  return entity.type === 'function';
}

/**
 * Emit deterministic PlantUML source for one diagram.
 */
export class PlantUmlGenerator {
  private readonly archJson: ArchJSON;
  private readonly options: Required<
    Pick<PlantUmlGeneratorOptions, 'level' | 'grouping' | 'includePrivate' | 'includeProtected'>
  >;

  constructor(archJson: ArchJSON, options: PlantUmlGeneratorOptions) {
    this.archJson = archJson;
    this.options = {
      level: options.level,
      grouping: options.grouping,
      includePrivate: options.includePrivate ?? true,
      includeProtected: options.includeProtected ?? true,
    };
  }

  /**
   * Generate the `.puml` text. Empty ArchJSON yields a legal empty diagram
   * (`@startuml\n@enduml\n`).
   */
  generate(): string {
    const lines: string[] = ['@startuml'];

    const entities = this.archJson.entities.filter((entity) => !isFunctionEntity(entity));
    if (entities.length === 0) {
      lines.push('@enduml');
      return `${lines.join('\n')}\n`;
    }

    const aliases = this.buildAliases(entities);
    const entityOptions: PlantUmlEntityOptions = {
      includePrivate: this.options.includePrivate,
      includeProtected: this.options.includeProtected,
      withMembers: this.options.level !== 'package',
      aliases,
    };

    this.emitGroups(entities, aliases, entityOptions, lines);

    const endpointAliases = this.buildEndpointAliases(entities, aliases);
    for (const relation of this.archJson.relations) {
      const line = generateRelationLine(relation, endpointAliases);
      if (line !== null) lines.push(line);
    }

    lines.push('@enduml');
    return `${lines.join('\n')}\n`;
  }

  /**
   * Emit package blocks in grouping order, then any entity the grouping did
   * not mention at top level (so no entity is silently dropped).
   */
  private emitGroups(
    entities: readonly Entity[],
    aliases: ReadonlyMap<string, string>,
    entityOptions: PlantUmlEntityOptions,
    lines: string[]
  ): void {
    const byId = new Map(entities.map((entity) => [entity.id, entity] as const));
    const emitted = new Set<string>();
    const groups = this.options.grouping.packages;

    if (groups.length === 0) {
      for (const entity of entities) {
        lines.push(...generateClassDefinition(entity, 0, entityOptions));
        emitted.add(entity.id);
      }
      return;
    }

    for (const group of groups) {
      const groupEntities = group.entities
        .map((id) => byId.get(id))
        .filter((entity): entity is Entity => entity !== undefined && !emitted.has(entity.id));
      if (groupEntities.length === 0) continue;

      lines.push(generatePackageHeader(group.name, 0));
      for (const entity of groupEntities) {
        lines.push(...generateClassDefinition(entity, 1, entityOptions));
        emitted.add(entity.id);
      }
      lines.push('}');
    }

    for (const entity of entities) {
      if (emitted.has(entity.id)) continue;
      lines.push(...generateClassDefinition(entity, 0, entityOptions));
    }
  }

  /**
   * Assign collision-free aliases in ArchJSON order. `User Profile` and
   * `User_Profile` must not collide, otherwise relations could bind to the
   * wrong entity.
   */
  private buildAliases(entities: readonly Entity[]): Map<string, string> {
    const aliases = new Map<string, string>();
    const used = new Set<string>();

    for (const entity of entities) {
      const base = entityAlias(entity.name) || escapeId(entityDisplayName(entity.name));
      let candidate = base;
      let suffix = 2;
      while (used.has(candidate)) {
        candidate = `${base}_${suffix}`;
        suffix += 1;
      }
      used.add(candidate);
      aliases.set(entity.id, candidate);
    }

    return aliases;
  }

  /**
   * Map every identifier a relation may use (entity id, raw name, normalized
   * display name) to the emitted alias.
   */
  private buildEndpointAliases(
    entities: readonly Entity[],
    aliases: ReadonlyMap<string, string>
  ): Map<string, string> {
    const endpointAliases = new Map<string, string>();

    for (const entity of entities) {
      const alias = aliases.get(entity.id);
      if (!alias) continue;
      if (!endpointAliases.has(entity.id)) endpointAliases.set(entity.id, alias);

      const normalized = normalizeEntityName(entity.name);
      const display = entityDisplayName(entity.name);
      if (!endpointAliases.has(entity.name)) endpointAliases.set(entity.name, alias);
      if (!endpointAliases.has(normalized)) endpointAliases.set(normalized, alias);
      if (!endpointAliases.has(display)) endpointAliases.set(display, alias);
    }

    return endpointAliases;
  }
}
