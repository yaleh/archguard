import path from 'path';
import type { DiagramConfig } from '@/types/config.js';
import type { DetectedLanguage, LanguageCandidate } from './project-language-detector.js';
import { detectProjectLanguages } from './project-language-detector.js';

export type QueryRole = 'primary' | 'secondary';

export interface PlannedScope {
  language: DetectedLanguage;
  label: string;
  role?: QueryRole;
  sources: string[];
}

interface DiagramOptions {
  format?: DiagramConfig['format'];
  exclude?: string[];
}

export async function planDefaultScopes(projectRoot: string): Promise<PlannedScope[]> {
  const candidates = await detectProjectLanguages(projectRoot);
  const rootCounts = new Map<string, number>();

  return candidates.map((candidate, index) => {
    const role: QueryRole = index === 0 ? 'primary' : 'secondary';
    const scopeRoot = selectScopeRoot(candidate, projectRoot);
    const relativeRoot = path.relative(projectRoot, scopeRoot).replace(/\\/g, '/');
    const isProjectRoot = !relativeRoot || relativeRoot === '';
    const base = isProjectRoot ? path.basename(projectRoot) : path.basename(scopeRoot);
    const rootUsage = rootCounts.get(scopeRoot) ?? 0;
    rootCounts.set(scopeRoot, rootUsage + 1);
    const label =
      isProjectRoot && role === 'primary' && rootUsage === 0
        ? base
        : `${base}-${candidate.language}`;

    return {
      language: candidate.language,
      label,
      role,
      sources: [isProjectRoot ? '.' : relativeRoot],
    };
  });
}

export async function planDefaultDiagrams(
  projectRoot: string,
  options?: DiagramOptions
): Promise<DiagramConfig[]> {
  const scopes = await planDefaultScopes(projectRoot);
  return scopes.flatMap((scope) => createScopeDiagrams(scope, options));
}

export function createProjectRootLanguageDiagrams(
  projectRoot: string,
  language: DetectedLanguage,
  options?: DiagramOptions & { label?: string; role?: QueryRole; source?: string }
): DiagramConfig[] {
  const label = options?.label ?? path.basename(projectRoot);
  const source = options?.source ?? '.';
  return createScopeDiagrams(
    {
      language,
      label,
      role: options?.role,
      sources: [source],
    },
    options
  );
}

function createScopeDiagrams(scope: PlannedScope, options?: DiagramOptions): DiagramConfig[] {
  const common: Partial<DiagramConfig> = {
    language: scope.language,
    ...(options?.format !== undefined && { format: options.format }),
    ...(options?.exclude !== undefined && { exclude: options.exclude }),
    ...(scope.role ? { queryRole: scope.role } : {}),
  };

  if (scope.language === 'go') {
    return [
      {
        ...common,
        name: `${scope.label}/overview/package`,
        sources: scope.sources,
        level: 'package',
        languageSpecific: {
          atlas: {
            enabled: true,
            functionBodyStrategy: 'selective',
            excludeTests: true,
          },
        },
      } as DiagramConfig,
    ];
  }

  return [
    {
      ...common,
      name: `${scope.label}/overview/package`,
      sources: scope.sources,
      level: 'package',
    } as DiagramConfig,
    {
      ...common,
      name: `${scope.label}/class/all-classes`,
      sources: scope.sources,
      level: 'class',
    } as DiagramConfig,
  ];
}

function selectScopeRoot(candidate: LanguageCandidate, projectRoot: string): string {
  if (candidate.language === 'cpp' || candidate.language === 'go') {
    return projectRoot;
  }

  return candidate.roots[0] ?? projectRoot;
}
