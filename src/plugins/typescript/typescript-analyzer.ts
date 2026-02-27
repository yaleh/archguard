/**
 * TypeScriptAnalyzer
 *
 * Orchestrates TypeScript-specific analysis on top of the parsed ArchJSON.
 * Currently builds the TsModuleGraph using existing ts-morph SourceFile[].
 */

import type { SourceFile } from 'ts-morph';
import type { TsAnalysis } from '@/types/extensions.js';
import { TS_ANALYSIS_EXTENSION_VERSION } from '@/types/extensions.js';
import type { Entity } from '@/types/index.js';
import { ModuleGraphBuilder } from './builders/module-graph-builder.js';

export class TypeScriptAnalyzer {
  private moduleGraphBuilder = new ModuleGraphBuilder();

  /**
   * Run TypeScript analysis and return TsAnalysis extension data.
   *
   * @param projectRoot - Absolute path to the project root
   * @param sourceFiles - ts-morph SourceFile[] from the shared Project instance
   * @param entities - Entity list from the parsed ArchJSON
   */
  analyze(projectRoot: string, sourceFiles: SourceFile[], entities: Entity[]): TsAnalysis {
    const moduleGraph = this.moduleGraphBuilder.build(projectRoot, sourceFiles, entities);
    return {
      version: TS_ANALYSIS_EXTENSION_VERSION,
      moduleGraph,
    };
  }
}
