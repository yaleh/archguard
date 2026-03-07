import path from 'path';
import fs from 'fs-extra';
import { detectProjectStructure } from '../utils/project-structure-detector.js';
import { detectCppProjectStructure } from '../utils/cpp-project-structure-detector.js';
import type { Config } from '../config-loader.js';
import type { CLIOptions, DiagramConfig } from '../../types/config.js';

/**
 * Normalize CLI options to DiagramConfig[]
 */
export async function normalizeToDiagrams(
  config: Config,
  cliOptions: CLIOptions,
  rootDir?: string
): Promise<DiagramConfig[]> {
  const resolvedRoot = rootDir ?? process.cwd();

  if (config.diagrams && config.diagrams.length > 0) {
    return filterByLevels(config.diagrams as DiagramConfig[], cliOptions.diagrams);
  }

  if (cliOptions.sources && cliOptions.sources.length > 0) {
    const language = cliOptions.lang ?? (cliOptions.atlas ? 'go' : undefined);
    const atlasEnabled = language === 'go' && cliOptions.atlas !== false;

    if (atlasEnabled) {
      const diagram: DiagramConfig = {
        name: 'architecture',
        sources: cliOptions.sources,
        level: 'package',
        format: cliOptions.format,
        exclude: cliOptions.exclude,
        language,
        languageSpecific: {
          atlas: {
            enabled: true,
            functionBodyStrategy: cliOptions.atlasStrategy ?? 'selective',
            excludeTests: !cliOptions.atlasIncludeTests,
            protocols: cliOptions.atlasProtocols?.split(',').map((s) => s.trim()),
            layers: cliOptions.atlasLayers?.split(',').map((s) => s.trim()),
          },
        },
      };
      return [diagram];
    }

    if (language === 'go' && cliOptions.atlas === false) {
      const diagram: DiagramConfig = {
        name: 'architecture',
        sources: cliOptions.sources,
        level: 'class',
        format: cliOptions.format,
        exclude: cliOptions.exclude,
        language,
      };
      return [diagram];
    }

    if (language === 'cpp') {
      const sourcePath = path.resolve(cliOptions.sources[0]);
      const moduleName = path.basename(sourcePath);
      const diagrams = await detectCppProjectStructure(sourcePath, moduleName, {
        format: cliOptions.format,
        exclude: cliOptions.exclude,
      });
      return filterByLevels(diagrams, cliOptions.diagrams);
    }

    const externalSourceRoot = path.resolve(cliOptions.sources[0]);
    const diagrams = await detectProjectStructure(resolvedRoot, externalSourceRoot);
    return filterByLevels(diagrams, cliOptions.diagrams);
  }

  const inferredLanguage = cliOptions.lang ?? (cliOptions.atlas ? 'go' : await detectRootLanguage(resolvedRoot));
  if (inferredLanguage === 'go') {
    return [
      {
        name: 'architecture',
        sources: ['.'],
        level: 'package',
        format: cliOptions.format,
        exclude: cliOptions.exclude,
        language: 'go',
        languageSpecific: {
          atlas: {
            enabled: cliOptions.atlas !== false,
            functionBodyStrategy: cliOptions.atlasStrategy ?? 'selective',
            excludeTests: !cliOptions.atlasIncludeTests,
            protocols: cliOptions.atlasProtocols?.split(',').map((s) => s.trim()),
            layers: cliOptions.atlasLayers?.split(',').map((s) => s.trim()),
          },
        },
      },
    ];
  }

  const diagrams = await detectProjectStructure(resolvedRoot);
  return filterByLevels(diagrams, cliOptions.diagrams);
}

async function detectRootLanguage(rootDir: string): Promise<'go' | undefined> {
  if (await fs.pathExists(path.join(rootDir, 'go.mod'))) {
    return 'go';
  }
  return undefined;
}

export function filterByLevels(diagrams: DiagramConfig[], levels?: string[]): DiagramConfig[] {
  if (!levels || levels.length === 0) {
    return diagrams;
  }

  return diagrams.filter((d) => levels.includes(d.level ?? 'class'));
}
