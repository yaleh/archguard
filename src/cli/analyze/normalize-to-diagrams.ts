import path from 'path';
import { detectProjectStructure } from '../utils/project-structure-detector.js';
import { detectCppProjectStructure } from '../utils/cpp-project-structure-detector.js';
import { detectJavaProjectStructure } from '../utils/java-project-structure-detector.js';
import { detectKotlinProjectStructure } from '../utils/kotlin-project-structure-detector.js';
import {
  createProjectRootLanguageDiagrams,
  planDefaultDiagrams,
} from '../utils/default-scope-planner.js';
import { detectProjectLanguages } from '../utils/project-language-detector.js';
import type { Config } from '../config-loader.js';
import type { CLIOptions, DiagramConfig } from '../../types/config.js';

/** Common options passed to every structure detector. */
interface DetectorOptions {
  label?: string;
  format?: DiagramConfig['format'];
  exclude?: string[];
  /** Used only by cpp when --sources is provided (basename of sourcePath). */
  moduleName?: string;
}

/**
 * A structure detector function: given a project root and common options,
 * it returns the list of DiagramConfig entries for that language.
 */
type StructureDetector = (
  root: string,
  options?: DetectorOptions
) => Promise<DiagramConfig[]> | DiagramConfig[];

/**
 * Registry of structure detectors keyed by language name.
 *
 * Languages whose project structure can be discovered via a single
 * `detectXxxProjectStructure(root, options)` call live here.
 *
 * Intentionally excluded:
 *  - `go`        — architecturally different (Atlas vs. standard diagram)
 *  - `typescript`/`python` — use the generic `createProjectRootLanguageDiagrams` fallback
 *
 * Export is intentional: consumers and tests can inspect or extend the map
 * without touching dispatch logic.
 */
export const LANGUAGE_STRUCTURE_DETECTORS: Record<string, StructureDetector> = {
  kotlin: (root, opts) =>
    detectKotlinProjectStructure(root, {
      label: opts?.label,
      format: opts?.format,
      exclude: opts?.exclude,
    }),
  cpp: (root, opts) =>
    detectCppProjectStructure(root, opts?.moduleName ?? path.basename(root), {
      format: opts?.format as string | undefined,
      exclude: opts?.exclude,
    }),
  java: (root, opts) =>
    detectJavaProjectStructure(root, {
      label: opts?.label,
      format: opts?.format,
      exclude: opts?.exclude,
    }),
};

/**
 * Languages that use `createProjectRootLanguageDiagrams` in the no-sources
 * path (instead of a dedicated structure detector).
 * cpp is also in this set because its no-sources path uses the generic fallback.
 */
const GENERIC_FALLBACK_LANGS = new Set(['typescript', 'python', 'cpp']);

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
    const language = cliOptions.lang;

    // Go: special Atlas diagram — not a structure-detector language
    if (language === 'go') {
      const diagram: DiagramConfig = {
        name: 'architecture',
        sources: cliOptions.sources,
        level: 'package',
        format: cliOptions.format,
        exclude: cliOptions.exclude,
        language,
        languageSpecific: {
          atlas: {
            functionBodyStrategy: cliOptions.atlasStrategy ?? 'selective',
            excludeTests: !cliOptions.atlasIncludeTests,
            protocols: cliOptions.atlasProtocols?.split(',').map((s) => s.trim()),
            layers: cliOptions.atlasLayers?.split(',').map((s) => s.trim()),
            entryPointPattern: cliOptions.atlasEntryPattern,
          },
        },
      };
      return [diagram];
    }

    // TypeScript / Python: generic fallback (label comes from the source path)
    if (language === 'python' || language === 'typescript') {
      const sourcePath = path.resolve(cliOptions.sources[0]);
      return filterByLevels(
        createProjectRootLanguageDiagrams(resolvedRoot, language, {
          label: path.basename(sourcePath),
          source: cliOptions.sources[0],
          format: cliOptions.format,
          exclude: cliOptions.exclude,
        }),
        cliOptions.diagrams
      );
    }

    // Registry lookup (kotlin / cpp / java + future languages)
    const detector = LANGUAGE_STRUCTURE_DETECTORS[language ?? ''];
    if (detector) {
      const sourcePath = path.resolve(cliOptions.sources[0]);
      return filterByLevels(
        await detector(sourcePath, {
          label: path.basename(sourcePath),
          moduleName: path.basename(sourcePath),
          format: cliOptions.format,
          exclude: cliOptions.exclude,
        }),
        cliOptions.diagrams
      );
    }

    // Unknown language: auto-detect project structure
    const externalSourceRoot = path.resolve(cliOptions.sources[0]);
    const diagrams = await detectProjectStructure(resolvedRoot, externalSourceRoot);
    return filterByLevels(diagrams, cliOptions.diagrams);
  }

  // ── No --sources path ─────────────────────────────────────────────────────

  // Go: special Atlas diagram
  if (cliOptions.lang === 'go') {
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
            functionBodyStrategy: cliOptions.atlasStrategy ?? 'selective',
            excludeTests: !cliOptions.atlasIncludeTests,
            protocols: cliOptions.atlasProtocols?.split(',').map((s) => s.trim()),
            layers: cliOptions.atlasLayers?.split(',').map((s) => s.trim()),
            entryPointPattern: cliOptions.atlasEntryPattern,
          },
        },
      },
    ];
  }

  // Languages that have a dedicated structure detector and aren't in the
  // generic-fallback set (kotlin / java)
  const lang = cliOptions.lang ?? '';
  if (LANGUAGE_STRUCTURE_DETECTORS[lang] && !GENERIC_FALLBACK_LANGS.has(lang)) {
    return filterByLevels(
      await LANGUAGE_STRUCTURE_DETECTORS[lang](resolvedRoot, {
        format: cliOptions.format,
        exclude: cliOptions.exclude,
      }),
      cliOptions.diagrams
    );
  }

  // TypeScript / Python / cpp (no-sources): generic fallback
  if (GENERIC_FALLBACK_LANGS.has(lang)) {
    return filterByLevels(
      createProjectRootLanguageDiagrams(resolvedRoot, lang as 'typescript' | 'python' | 'cpp', {
        format: cliOptions.format,
        exclude: cliOptions.exclude,
      }),
      cliOptions.diagrams
    );
  }

  // Auto-detect language then plan diagrams
  const candidates = await detectProjectLanguages(resolvedRoot);
  if (
    candidates.length === 1 &&
    candidates[0].language === 'typescript' &&
    candidates[0].score === 0
  ) {
    const fallbackDiagrams = await detectProjectStructure(resolvedRoot);
    return filterByLevels(fallbackDiagrams, cliOptions.diagrams);
  }

  const diagrams = await planDefaultDiagrams(resolvedRoot, {
    format: cliOptions.format,
    exclude: cliOptions.exclude,
  });
  return filterByLevels(diagrams, cliOptions.diagrams);
}

export function filterByLevels(diagrams: DiagramConfig[], levels?: string[]): DiagramConfig[] {
  if (!levels || levels.length === 0) {
    return diagrams;
  }

  return diagrams.filter((d) => levels.includes(d.level ?? 'class'));
}
