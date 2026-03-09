import type { ArchJSON } from '../types/index.js';
import { isExternalDependency } from './external-dependencies.js';

export function validateGeneratorInput(archJson: ArchJSON, verbose: boolean): void {
  const entityIds = new Set(archJson.entities.map((entity) => entity.id));
  const filteredWarnings: string[] = [];

  for (const relation of archJson.relations) {
    const sourceExists = entityIds.has(relation.source);
    const targetExists = entityIds.has(relation.target);

    if (!sourceExists || !targetExists) {
      const sourceIsExternal = !sourceExists && isExternalDependency(relation.source);
      const targetIsExternal = !targetExists && isExternalDependency(relation.target);

      if (!sourceIsExternal || !targetIsExternal) {
        const warningParts: string[] = [];
        if (!sourceExists && !sourceIsExternal) warningParts.push(`source: ${relation.source}`);
        if (!targetExists && !targetIsExternal) warningParts.push(`target: ${relation.target}`);
        if (warningParts.length > 0) {
          filteredWarnings.push(
            `  - ${relation.source} -> ${relation.target} (${warningParts.join(', ')})`
          );
        }
      }
    }
  }

  if (filteredWarnings.length > 0) {
    console.warn(`⚠️  Warning: ${filteredWarnings.length} relation(s) reference undefined entities:`);
    console.warn(filteredWarnings.join('\n'));
  }

  if (verbose) {
    const filteredCount = archJson.relations.filter(
      (relation) =>
        (!entityIds.has(relation.source) && isExternalDependency(relation.source)) ||
        (!entityIds.has(relation.target) && isExternalDependency(relation.target))
    ).length;
    if (filteredCount > 0) {
      console.debug(`🔇 Filtered ${filteredCount} external dependency warning(s)`);
    }
  }

  for (const entity of archJson.entities) {
    if (entity.name.includes('\n') || entity.name.includes('"')) {
      throw new Error(`Invalid entity name: ${entity.name}`);
    }
  }
}
