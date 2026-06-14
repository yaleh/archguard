/**
 * ArchJSON Mapper - Convert Go raw data to ArchJSON format
 */

import type { ArchJSON, Entity, Relation, Member } from '@/types/index.js';
import type { GoRawPackage, GoRawStruct, GoRawInterface, InferredImplementation } from './types.js';
import type { FlowGraph } from '@/types/extensions/go-atlas.js';
import { BaseArchJsonMapper } from '@/plugins/shared/mapper-utils.js';

export class ArchJsonMapper extends BaseArchJsonMapper<GoRawPackage> {
  /**
   * Map Go packages to ArchJSON entities
   */
  mapEntities(packages: GoRawPackage[]): Entity[] {
    const entities: Entity[] = [];
    const seenIds = new Set<string>();

    for (const pkg of packages) {
      const pkgId = pkg.fullName || pkg.name;

      // Map structs
      for (const struct of pkg.structs) {
        const entity = this.mapStruct(struct, pkgId);
        this.pushUniqueEntity(entities, seenIds, entity);
      }

      // Map interfaces
      for (const iface of pkg.interfaces) {
        const entity = this.mapInterface(iface, pkgId);
        this.pushUniqueEntity(entities, seenIds, entity);
      }
    }

    return entities;
  }

  /**
   * Scan implementation relation targets and return any interface entities
   * that are referenced but not yet present in the entities array.
   * External dependency interfaces (not found in any package) are skipped silently.
   */
  mapMissingInterfaceEntities(
    entities: Entity[],
    relations: Relation[],
    packages: GoRawPackage[]
  ): Entity[] {
    const existingIds = new Set(entities.map((e) => e.id));
    const added: Entity[] = [];
    const addedIds = new Set<string>();

    // Build a lookup: "pkgFullName.TypeName" → { iface, pkgId }
    const ifaceLookup = new Map<string, { iface: GoRawInterface; pkgId: string }>();
    for (const pkg of packages) {
      const pkgId = pkg.fullName || pkg.name;
      for (const iface of pkg.interfaces) {
        ifaceLookup.set(`${pkgId}.${iface.name}`, { iface, pkgId });
      }
    }

    // Scan implementation relation targets
    for (const rel of relations) {
      if (rel.type !== 'implementation') continue;
      const targetId = rel.target;
      if (existingIds.has(targetId) || addedIds.has(targetId)) continue;

      const entry = ifaceLookup.get(targetId);
      if (entry) {
        const entity = this.mapInterface(entry.iface, entry.pkgId);
        added.push(entity);
        addedIds.add(targetId);
      }
      // If not found in packages (external dep), skip silently
    }

    return added;
  }

  /**
   * Map Go struct to Entity
   */
  private mapStruct(struct: GoRawStruct, packageName: string): Entity {
    const members: Member[] = [];

    // Map fields
    for (const field of struct.fields) {
      members.push({
        name: field.name,
        type: 'field',
        visibility: this.mapExportedVisibility(field.exported),
        fieldType: field.type,
      });
    }

    // Map methods
    for (const method of struct.methods) {
      members.push({
        name: method.name,
        type: 'method',
        visibility: this.mapExportedVisibility(method.exported),
        returnType: method.returnTypes.join(', ') || 'void',
        parameters: this.mapParameters(method.parameters),
      });
    }

    return {
      id: this.createEntityId(packageName, struct.name),
      name: struct.name,
      type: 'struct',
      visibility: this.mapExportedVisibility(struct.exported),
      members,
      sourceLocation: struct.location,
      attributes: { package: packageName },
    };
  }

  /**
   * Map Go interface to Entity
   */
  private mapInterface(iface: GoRawInterface, packageName: string): Entity {
    const members: Member[] = [];

    // Map methods
    for (const method of iface.methods) {
      members.push({
        name: method.name,
        type: 'method',
        visibility: this.mapExportedVisibility(method.exported),
        returnType: method.returnTypes.join(', ') || 'void',
        parameters: this.mapParameters(method.parameters),
      });
    }

    return {
      id: this.createEntityId(packageName, iface.name),
      name: iface.name,
      type: 'interface',
      visibility: this.mapExportedVisibility(iface.exported),
      members,
      sourceLocation: iface.location,
      attributes: { package: packageName },
    };
  }

  /**
   * Map interface implementations and package import dependencies to Relations.
   *
   * @param moduleName - The Go module name from go.mod (e.g. "github.com/org/app").
   *   When non-empty, same-module imports are resolved to dependency relations.
   *   When empty (default), no dependency edges are emitted (backward-compat).
   */
  mapRelations(
    packages: GoRawPackage[],
    implementations: InferredImplementation[],
    moduleName = ''
  ): Relation[] {
    const relations: Relation[] = [];
    const seen = new Set<string>();

    // Map implementations
    for (let i = 0; i < implementations.length; i++) {
      const impl = implementations[i];
      const source = `${impl.structPackageId}.${impl.structName}`;
      const target = `${impl.interfacePackageId}.${impl.interfaceName}`;
      this.pushUniqueRelation(
        relations,
        seen,
        this.createExplicitRelation('implementation', source, target, {
          confidence: impl.confidence,
          inferenceSource: impl.source,
        })
      );
    }

    // Build dependency edges from package imports (only when moduleName is known)
    if (moduleName) {
      const prefix = moduleName + '/';
      const knownFullNames = new Set(packages.map((p) => p.fullName || p.name));

      for (const pkg of packages) {
        const source = pkg.fullName || pkg.name;
        for (const imp of pkg.imports) {
          if (!imp.path.startsWith(prefix)) continue;
          const target = imp.path.slice(prefix.length);
          if (target === source) continue; // self-import guard
          if (!knownFullNames.has(target)) continue; // unknown package — skip
          this.pushUniqueRelation(
            relations,
            seen,
            this.createExplicitRelation('dependency', source, target, {
              inferenceSource: 'explicit',
            })
          );
        }
      }
    }

    return relations;
  }

  /**
   * Map Go Atlas FlowGraph CallEdges to ArchJSON Relation[] with type='call'.
   *
   * Must be called AFTER buildAtlasFromRawData() completes.
   * Each edge `from`/`to` is split on '.' to extract package (source/target)
   * and method name (sourceMethod/targetMethod). Edges without a package prefix
   * (no dot) are skipped. Duplicate from/to pairs are deduplicated.
   */
  public mapCallRelations(flowGraph: FlowGraph | undefined): Relation[] {
    if (!flowGraph) return [];
    const relations: Relation[] = [];
    const seen = new Set<string>();

    for (const chain of flowGraph.callChains) {
      for (const edge of chain.calls) {
        const fromParts = edge.from.split('.');
        const sourceMethod = fromParts.at(-1) ?? edge.from;
        const sourceClass = fromParts.slice(0, -1).join('.');

        const toParts = edge.to.split('.');
        const targetMethod = toParts.at(-1) ?? edge.to;
        const targetClass = toParts.slice(0, -1).join('.');

        // Skip entries without package prefix
        if (!sourceClass || !targetClass) continue;

        const id = `call:${edge.from}:${edge.to}`;
        if (seen.has(id)) continue;
        seen.add(id);

        relations.push({
          id,
          type: 'call',
          source: sourceClass,
          target: targetClass,
          sourceMethod,
          targetMethod,
          callType: edge.type === 'indirect' ? 'interface' : (edge.type as 'direct' | 'interface'),
          confidence: edge.confidence,
          inferenceSource: 'gopls',
        });
      }
    }
    return relations;
  }
}
