import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── hoist mock functions so vi.mock factories can reference them ─────────────

const {
  mockDetectKotlin,
  mockDetectCpp,
  mockDetectJava,
  mockDetectProject,
  mockCreateProjectRoot,
  mockPlanDefault,
  mockDetectProjectLanguages,
} = vi.hoisted(() => ({
  mockDetectKotlin: vi.fn().mockResolvedValue([
    { name: 'kotlin/overview/package', sources: ['/src'], level: 'package', language: 'kotlin' },
  ]),
  mockDetectCpp: vi.fn().mockResolvedValue([
    { name: 'mymod/overview/package', sources: ['/src'], level: 'package', language: 'cpp' },
  ]),
  mockDetectJava: vi.fn().mockResolvedValue([
    { name: 'java/overview/package', sources: ['/src'], level: 'package', language: 'java' },
  ]),
  mockDetectProject: vi.fn().mockResolvedValue([
    { name: 'ts/overview/package', sources: ['/src'], level: 'package', language: 'typescript' },
  ]),
  mockCreateProjectRoot: vi.fn().mockReturnValue([
    { name: 'root/overview/package', sources: ['/src'], level: 'package' },
  ]),
  mockPlanDefault: vi.fn().mockResolvedValue([
    { name: 'default/overview/package', sources: ['/src'], level: 'package' },
  ]),
  mockDetectProjectLanguages: vi.fn().mockResolvedValue([{ language: 'typescript', score: 1 }]),
}));

vi.mock('@/cli/utils/kotlin-project-structure-detector.js', () => ({
  detectKotlinProjectStructure: mockDetectKotlin,
}));
vi.mock('@/cli/utils/cpp-project-structure-detector.js', () => ({
  detectCppProjectStructure: mockDetectCpp,
}));
vi.mock('@/cli/utils/java-project-structure-detector.js', () => ({
  detectJavaProjectStructure: mockDetectJava,
}));
vi.mock('@/cli/utils/project-structure-detector.js', () => ({
  detectProjectStructure: mockDetectProject,
}));
vi.mock('@/cli/utils/default-scope-planner.js', () => ({
  createProjectRootLanguageDiagrams: mockCreateProjectRoot,
  planDefaultDiagrams: mockPlanDefault,
}));
vi.mock('@/cli/utils/project-language-detector.js', () => ({
  detectProjectLanguages: mockDetectProjectLanguages,
}));

import {
  normalizeToDiagrams,
  filterByLevels,
  LANGUAGE_STRUCTURE_DETECTORS,
} from '@/cli/analyze/normalize-to-diagrams.js';
import type { Config } from '@/cli/config-loader.js';
import type { CLIOptions } from '@/types/config.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<Config>): Config {
  return { diagrams: [], ...overrides } as unknown as Config;
}

function makeOptions(overrides?: Partial<CLIOptions>): CLIOptions {
  return { format: 'mermaid', ...overrides } as CLIOptions;
}

// ── LANGUAGE_STRUCTURE_DETECTORS registry ────────────────────────────────────

describe('LANGUAGE_STRUCTURE_DETECTORS', () => {
  it('is exported and is a plain object', () => {
    expect(LANGUAGE_STRUCTURE_DETECTORS).toBeDefined();
    expect(typeof LANGUAGE_STRUCTURE_DETECTORS).toBe('object');
  });

  it('contains kotlin, cpp, java keys', () => {
    expect(LANGUAGE_STRUCTURE_DETECTORS).toHaveProperty('kotlin');
    expect(LANGUAGE_STRUCTURE_DETECTORS).toHaveProperty('cpp');
    expect(LANGUAGE_STRUCTURE_DETECTORS).toHaveProperty('java');
  });

  it('does NOT contain go, typescript, python (they use special paths)', () => {
    expect(LANGUAGE_STRUCTURE_DETECTORS).not.toHaveProperty('go');
    expect(LANGUAGE_STRUCTURE_DETECTORS).not.toHaveProperty('typescript');
    expect(LANGUAGE_STRUCTURE_DETECTORS).not.toHaveProperty('python');
  });

  it('values are functions', () => {
    for (const fn of Object.values(LANGUAGE_STRUCTURE_DETECTORS)) {
      expect(typeof fn).toBe('function');
    }
  });

  it('adding a custom language to the registry is possible without patching dispatch logic', () => {
    const mockRust = vi.fn().mockResolvedValue([]);
    // Consumers can extend the map at runtime; the dispatch reads the same map
    LANGUAGE_STRUCTURE_DETECTORS['rust'] = mockRust;
    expect(LANGUAGE_STRUCTURE_DETECTORS).toHaveProperty('rust');
    delete LANGUAGE_STRUCTURE_DETECTORS['rust']; // cleanup
  });
});

// ── normalizeToDiagrams with --sources: language dispatch ────────────────────

describe('normalizeToDiagrams — with sources', () => {
  const root = '/project';

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default resolved values after clearAllMocks
    mockDetectKotlin.mockResolvedValue([
      { name: 'kotlin/overview/package', sources: ['/src'], level: 'package', language: 'kotlin' },
    ]);
    mockDetectCpp.mockResolvedValue([
      { name: 'mymod/overview/package', sources: ['/src'], level: 'package', language: 'cpp' },
    ]);
    mockDetectJava.mockResolvedValue([
      { name: 'java/overview/package', sources: ['/src'], level: 'package', language: 'java' },
    ]);
    mockDetectProject.mockResolvedValue([
      { name: 'ts/overview/package', sources: ['/src'], level: 'package', language: 'typescript' },
    ]);
    mockCreateProjectRoot.mockReturnValue([
      { name: 'root/overview/package', sources: ['/src'], level: 'package' },
    ]);
  });

  it('routes kotlin → detectKotlinProjectStructure', async () => {
    const result = await normalizeToDiagrams(
      makeConfig(),
      makeOptions({ sources: ['/src'], lang: 'kotlin' }),
      root
    );
    expect(mockDetectKotlin).toHaveBeenCalledOnce();
    expect(result.length).toBeGreaterThan(0);
  });

  it('routes cpp → detectCppProjectStructure', async () => {
    const result = await normalizeToDiagrams(
      makeConfig(),
      makeOptions({ sources: ['/src'], lang: 'cpp' }),
      root
    );
    expect(mockDetectCpp).toHaveBeenCalledOnce();
    expect(result.length).toBeGreaterThan(0);
  });

  it('routes java → detectJavaProjectStructure', async () => {
    const result = await normalizeToDiagrams(
      makeConfig(),
      makeOptions({ sources: ['/src'], lang: 'java' }),
      root
    );
    expect(mockDetectJava).toHaveBeenCalledOnce();
    expect(result.length).toBeGreaterThan(0);
  });

  it('unknown lang falls back to detectProjectStructure', async () => {
    const result = await normalizeToDiagrams(
      makeConfig(),
      makeOptions({ sources: ['/src'], lang: undefined }),
      root
    );
    expect(mockDetectProject).toHaveBeenCalledOnce();
    expect(result.length).toBeGreaterThan(0);
  });

  it('typescript routes to createProjectRootLanguageDiagrams (not the registry)', async () => {
    await normalizeToDiagrams(
      makeConfig(),
      makeOptions({ sources: ['/src'], lang: 'typescript' }),
      root
    );
    expect(mockCreateProjectRoot).toHaveBeenCalledOnce();
    expect(mockDetectKotlin).not.toHaveBeenCalled();
    expect(mockDetectJava).not.toHaveBeenCalled();
    expect(mockDetectCpp).not.toHaveBeenCalled();
  });

  it('python routes to createProjectRootLanguageDiagrams (not the registry)', async () => {
    await normalizeToDiagrams(
      makeConfig(),
      makeOptions({ sources: ['/src'], lang: 'python' }),
      root
    );
    expect(mockCreateProjectRoot).toHaveBeenCalledOnce();
    expect(mockDetectKotlin).not.toHaveBeenCalled();
  });

  it('go returns atlas diagram (special path, not registry)', async () => {
    const result = await normalizeToDiagrams(
      makeConfig(),
      makeOptions({ sources: ['/src'], lang: 'go' }),
      root
    );
    expect(result).toHaveLength(1);
    expect(result[0].languageSpecific?.atlas).toBeDefined();
    expect(mockDetectKotlin).not.toHaveBeenCalled();
  });
});

// ── normalizeToDiagrams without --sources: language dispatch ─────────────────

describe('normalizeToDiagrams — without sources', () => {
  const root = '/project';

  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectKotlin.mockResolvedValue([
      { name: 'kotlin/overview/package', sources: ['/src'], level: 'package', language: 'kotlin' },
    ]);
    mockDetectJava.mockResolvedValue([
      { name: 'java/overview/package', sources: ['/src'], level: 'package', language: 'java' },
    ]);
    mockCreateProjectRoot.mockReturnValue([
      { name: 'root/overview/package', sources: ['/src'], level: 'package' },
    ]);
    mockPlanDefault.mockResolvedValue([
      { name: 'default/overview/package', sources: ['/src'], level: 'package' },
    ]);
    mockDetectProjectLanguages.mockResolvedValue([{ language: 'typescript', score: 1 }]);
  });

  it('routes kotlin → detectKotlinProjectStructure', async () => {
    const result = await normalizeToDiagrams(
      makeConfig(),
      makeOptions({ lang: 'kotlin' }),
      root
    );
    expect(mockDetectKotlin).toHaveBeenCalledOnce();
    expect(result.length).toBeGreaterThan(0);
  });

  it('routes java → detectJavaProjectStructure', async () => {
    const result = await normalizeToDiagrams(
      makeConfig(),
      makeOptions({ lang: 'java' }),
      root
    );
    expect(mockDetectJava).toHaveBeenCalledOnce();
    expect(result.length).toBeGreaterThan(0);
  });

  it('routes cpp → createProjectRootLanguageDiagrams (no-sources path uses generic fallback for cpp)', async () => {
    await normalizeToDiagrams(
      makeConfig(),
      makeOptions({ lang: 'cpp' }),
      root
    );
    expect(mockCreateProjectRoot).toHaveBeenCalledOnce();
    expect(mockDetectCpp).not.toHaveBeenCalled();
  });

  it('typescript routes to createProjectRootLanguageDiagrams', async () => {
    await normalizeToDiagrams(
      makeConfig(),
      makeOptions({ lang: 'typescript' }),
      root
    );
    expect(mockCreateProjectRoot).toHaveBeenCalledOnce();
  });

  it('python routes to createProjectRootLanguageDiagrams', async () => {
    await normalizeToDiagrams(
      makeConfig(),
      makeOptions({ lang: 'python' }),
      root
    );
    expect(mockCreateProjectRoot).toHaveBeenCalledOnce();
  });

  it('go returns atlas diagram (special path)', async () => {
    const result = await normalizeToDiagrams(
      makeConfig(),
      makeOptions({ lang: 'go' }),
      root
    );
    expect(result).toHaveLength(1);
    expect(result[0].languageSpecific?.atlas).toBeDefined();
  });

  it('no lang → planDefaultDiagrams (via language detection)', async () => {
    // detectProjectLanguages returns non-zero-score ts → planDefaultDiagrams
    await normalizeToDiagrams(makeConfig(), makeOptions(), root);
    expect(mockPlanDefault).toHaveBeenCalledOnce();
  });
});

// ── filterByLevels ────────────────────────────────────────────────────────────

describe('filterByLevels', () => {
  const diagrams = [
    { name: 'a', sources: ['.'], level: 'package' as const },
    { name: 'b', sources: ['.'], level: 'class' as const },
    { name: 'c', sources: ['.'], level: 'method' as const },
  ];

  it('returns all diagrams when levels is undefined', () => {
    expect(filterByLevels(diagrams)).toHaveLength(3);
  });

  it('returns all diagrams when levels is empty', () => {
    expect(filterByLevels(diagrams, [])).toHaveLength(3);
  });

  it('filters to matching level', () => {
    const result = filterByLevels(diagrams, ['package']);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('a');
  });

  it('filters to multiple levels', () => {
    const result = filterByLevels(diagrams, ['package', 'method']);
    expect(result).toHaveLength(2);
  });

  it('treats undefined level as class', () => {
    const withUndefined = [{ name: 'x', sources: ['.'] }] as any[];
    expect(filterByLevels(withUndefined, ['class'])).toHaveLength(1);
    expect(filterByLevels(withUndefined, ['package'])).toHaveLength(0);
  });
});

// ─── Phase 104: atlasEntryPattern → AtlasConfig.entryPointPattern ───────────

describe('normalizeToDiagrams — atlasEntryPattern wiring', () => {
  const root = '/project';

  it('maps atlasEntryPattern to AtlasConfig.entryPointPattern (with --sources)', async () => {
    const result = await normalizeToDiagrams(
      makeConfig(),
      makeOptions({ sources: ['/src'], lang: 'go', atlasEntryPattern: 'MyRegister' }),
      root
    );
    expect(result).toHaveLength(1);
    expect(result[0].languageSpecific?.atlas?.entryPointPattern).toBe('MyRegister');
  });

  it('maps atlasEntryPattern to AtlasConfig.entryPointPattern (without --sources)', async () => {
    const result = await normalizeToDiagrams(
      makeConfig(),
      makeOptions({ lang: 'go', atlasEntryPattern: 'AddTool|Register' }),
      root
    );
    expect(result).toHaveLength(1);
    expect(result[0].languageSpecific?.atlas?.entryPointPattern).toBe('AddTool|Register');
  });

  it('entryPointPattern is undefined when atlasEntryPattern not set', async () => {
    const result = await normalizeToDiagrams(
      makeConfig(),
      makeOptions({ lang: 'go' }),
      root
    );
    expect(result[0].languageSpecific?.atlas?.entryPointPattern).toBeUndefined();
  });
});
