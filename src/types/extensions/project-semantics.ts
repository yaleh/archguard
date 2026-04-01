import { z } from 'zod';

export const PROJECT_SEMANTICS_VERSION = '1.0' as const;

export interface ProjectSemanticsInput {
  nonProductionPatterns?: string[];
  barrelFiles?: string[];
  additionalTestPatterns?: string[];
  customAssertionPatterns?: string[];
  architecturalLayers?: Record<string, string>;
  suggestedDepth?: number;
}

export interface ProjectSemantics {
  version: typeof PROJECT_SEMANTICS_VERSION;
  nonProductionPatterns: string[];
  barrelFiles: string[];
  additionalTestPatterns: string[];
  customAssertionPatterns: string[];
  architecturalLayers?: Record<string, string>;
  suggestedDepth?: number;
  confidence: number;
  _dirTreeHash?: string;
  _generatedAt?: string;
}

function isUnsafePathLikeValue(value: string): boolean {
  return value.includes('..') || value.includes('\0') || value.startsWith('/');
}

const SafePathLikeStringSchema = z.string().superRefine((value, ctx) => {
  if (isUnsafePathLikeValue(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Unsafe path-like value is not allowed',
    });
  }
});

export const ProjectSemanticsInputSchema = z
  .object({
    nonProductionPatterns: z.array(SafePathLikeStringSchema).optional(),
    barrelFiles: z.array(SafePathLikeStringSchema).optional(),
    additionalTestPatterns: z.array(SafePathLikeStringSchema).optional(),
    customAssertionPatterns: z.array(SafePathLikeStringSchema).optional(),
    architecturalLayers: z.record(SafePathLikeStringSchema, z.string()).optional(),
    suggestedDepth: z.number().int().min(1).max(5).optional(),
  })
  .strict();

export const ProjectSemanticsSchema = z.object({
  version: z.literal(PROJECT_SEMANTICS_VERSION),
  nonProductionPatterns: z.array(z.string()),
  barrelFiles: z.array(z.string()),
  additionalTestPatterns: z.array(z.string()),
  customAssertionPatterns: z.array(z.string()),
  architecturalLayers: z.record(z.string(), z.string()).optional(),
  suggestedDepth: z.number().int().min(1).max(5).optional(),
  confidence: z.number().min(0).max(1),
  _dirTreeHash: z.string().optional(),
  _generatedAt: z.string().optional(),
});

export const PartialProjectSemanticsSchema = ProjectSemanticsInputSchema;

type ProjectSemanticsMergeInput = ProjectSemanticsInput | Partial<ProjectSemantics> | undefined;

function sanitizeStringArray(values?: string[]): string[] | undefined {
  if (!values) return undefined;

  return values.filter((value) => !isUnsafePathLikeValue(value));
}

function sanitizeLayers(
  layers?: Record<string, string>
): Record<string, string> | undefined {
  if (!layers) return undefined;

  const sanitized = Object.entries(layers).reduce<Record<string, string>>((acc, [key, value]) => {
    if (!isUnsafePathLikeValue(key)) {
      acc[key] = value;
    }
    return acc;
  }, {});

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

export function sanitizeProjectSemantics(raw: ProjectSemantics): ProjectSemantics {
  return {
    ...raw,
    nonProductionPatterns: sanitizeStringArray(raw.nonProductionPatterns) ?? [],
    barrelFiles: sanitizeStringArray(raw.barrelFiles) ?? [],
    additionalTestPatterns: sanitizeStringArray(raw.additionalTestPatterns) ?? [],
    customAssertionPatterns: sanitizeStringArray(raw.customAssertionPatterns) ?? [],
    architecturalLayers: sanitizeLayers(raw.architecturalLayers),
  };
}

function sanitizeProjectSemanticsInput(raw?: ProjectSemanticsMergeInput): Partial<ProjectSemantics> {
  if (!raw) return {};

  return {
    ...raw,
    nonProductionPatterns: sanitizeStringArray(raw.nonProductionPatterns),
    barrelFiles: sanitizeStringArray(raw.barrelFiles),
    additionalTestPatterns: sanitizeStringArray(raw.additionalTestPatterns),
    customAssertionPatterns: sanitizeStringArray(raw.customAssertionPatterns),
    architecturalLayers: sanitizeLayers(raw.architecturalLayers),
  };
}

function mergeArrayField(
  ...sources: Array<string[] | undefined>
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    for (const value of source ?? []) {
      if (value.startsWith('!')) {
        const excluded = value.slice(1);
        if (!excluded) continue;
        seen.delete(excluded);
        const index = merged.indexOf(excluded);
        if (index >= 0) {
          merged.splice(index, 1);
        }
        continue;
      }

      if (seen.has(value)) continue;
      seen.add(value);
      merged.push(value);
    }
  }

  return merged;
}

export function mergeProjectSemantics(
  user?: ProjectSemanticsMergeInput,
  llm?: ProjectSemanticsMergeInput,
  defaults?: ProjectSemanticsMergeInput
): Partial<ProjectSemantics> {
  const sanitizedDefaults = sanitizeProjectSemanticsInput(defaults);
  const sanitizedLlm = sanitizeProjectSemanticsInput(llm);
  const sanitizedUser = sanitizeProjectSemanticsInput(user);

  const architecturalLayers = {
    ...(sanitizedDefaults.architecturalLayers ?? {}),
    ...(sanitizedLlm.architecturalLayers ?? {}),
    ...(sanitizedUser.architecturalLayers ?? {}),
  };

  return {
    version:
      sanitizedUser.version ??
      sanitizedLlm.version ??
      sanitizedDefaults.version ??
      PROJECT_SEMANTICS_VERSION,
    nonProductionPatterns: mergeArrayField(
      sanitizedDefaults.nonProductionPatterns,
      sanitizedLlm.nonProductionPatterns,
      sanitizedUser.nonProductionPatterns
    ),
    barrelFiles: mergeArrayField(
      sanitizedDefaults.barrelFiles,
      sanitizedLlm.barrelFiles,
      sanitizedUser.barrelFiles
    ),
    additionalTestPatterns: mergeArrayField(
      sanitizedDefaults.additionalTestPatterns,
      sanitizedLlm.additionalTestPatterns,
      sanitizedUser.additionalTestPatterns
    ),
    customAssertionPatterns: mergeArrayField(
      sanitizedDefaults.customAssertionPatterns,
      sanitizedLlm.customAssertionPatterns,
      sanitizedUser.customAssertionPatterns
    ),
    architecturalLayers: Object.keys(architecturalLayers).length > 0 ? architecturalLayers : undefined,
    suggestedDepth:
      sanitizedUser.suggestedDepth ??
      sanitizedLlm.suggestedDepth ??
      sanitizedDefaults.suggestedDepth,
    confidence:
      sanitizedUser.confidence ??
      sanitizedLlm.confidence ??
      sanitizedDefaults.confidence,
    _dirTreeHash:
      sanitizedUser._dirTreeHash ??
      sanitizedLlm._dirTreeHash ??
      sanitizedDefaults._dirTreeHash,
    _generatedAt:
      sanitizedUser._generatedAt ??
      sanitizedLlm._generatedAt ??
      sanitizedDefaults._generatedAt,
  };
}
