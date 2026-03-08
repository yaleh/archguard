import fs from 'fs-extra';
import path from 'path';

export type DetectedLanguage = 'typescript' | 'go' | 'java' | 'python' | 'cpp';

export interface LanguageCandidate {
  language: DetectedLanguage;
  score: number;
  evidence: string[];
  roots: string[];
}

const SKIP_DIRS = new Set([
  '.git',
  '.archguard',
  'node_modules',
  'build',
  'dist',
  'coverage',
  'vendor',
  'third_party',
  'thirdparty',
  'target',
  '__pycache__',
  '.venv',
  'venv',
]);

const LOW_PRIORITY_DIRS = new Set(['scripts', 'tests', 'test', 'examples', 'docs', 'doc', 'bench']);

const MARKERS: Record<DetectedLanguage, string[]> = {
  cpp: ['CMakeLists.txt', 'Makefile'],
  go: ['go.mod'],
  java: ['pom.xml', 'build.gradle'],
  python: ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'Pipfile'],
  typescript: ['package.json', 'tsconfig.json'],
};

const EXTENSIONS: Record<DetectedLanguage, string[]> = {
  cpp: ['.cpp', '.cxx', '.cc', '.hpp', '.hxx', '.h'],
  go: ['.go'],
  java: ['.java'],
  python: ['.py'],
  typescript: ['.ts', '.tsx'],
};

interface LanguageStats {
  totalFiles: number;
  priorityFiles: number;
  markerRoots: Map<string, number>;
  markerFiles: Set<string>;
  sourceRoots: Map<string, number>;
}

function createStats(): Record<DetectedLanguage, LanguageStats> {
  return {
    cpp: emptyStats(),
    go: emptyStats(),
    java: emptyStats(),
    python: emptyStats(),
    typescript: emptyStats(),
  };
}

function emptyStats(): LanguageStats {
  return {
    totalFiles: 0,
    priorityFiles: 0,
    markerRoots: new Map(),
    markerFiles: new Set(),
    sourceRoots: new Map(),
  };
}

export async function detectProjectLanguages(projectRoot: string): Promise<LanguageCandidate[]> {
  const resolvedRoot = path.resolve(projectRoot);
  const stats = createStats();

  await scanDirectory(resolvedRoot, resolvedRoot, stats, 0);

  const candidates = (Object.keys(stats) as DetectedLanguage[])
    .map((language) => buildCandidate(language, stats[language], resolvedRoot))
    .filter((candidate): candidate is LanguageCandidate => candidate !== null)
    .sort((a, b) => b.score - a.score || a.language.localeCompare(b.language));

  if (candidates.length > 0) {
    return candidates;
  }

  return [
    {
      language: 'typescript',
      score: 0,
      evidence: ['fallback: no strong language markers found'],
      roots: [resolvedRoot],
    },
  ];
}

export async function detectPrimaryLanguage(
  projectRoot: string
): Promise<LanguageCandidate | null> {
  const candidates = await detectProjectLanguages(projectRoot);
  return candidates[0] ?? null;
}

async function scanDirectory(
  currentDir: string,
  projectRoot: string,
  stats: Record<DetectedLanguage, LanguageStats>,
  depth: number
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  const relDir = path.relative(projectRoot, currentDir).replace(/\\/g, '/');
  const lowPriority = relDir
    .split('/')
    .filter(Boolean)
    .some((segment) => LOW_PRIORITY_DIRS.has(segment));

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) continue;
      await scanDirectory(fullPath, projectRoot, stats, depth + 1);
      continue;
    }

    if (!entry.isFile()) continue;

    for (const [language, markers] of Object.entries(MARKERS) as [DetectedLanguage, string[]][]) {
      if (markers.includes(entry.name)) {
        const markerDepth = path
          .relative(projectRoot, currentDir)
          .split(path.sep)
          .filter(Boolean).length;
        stats[language].markerRoots.set(
          currentDir,
          Math.min(
            stats[language].markerRoots.get(currentDir) ?? Number.MAX_SAFE_INTEGER,
            markerDepth
          )
        );
        stats[language].markerFiles.add(entry.name);
      }
    }

    const ext = path.extname(entry.name).toLowerCase();
    for (const [language, extensions] of Object.entries(EXTENSIONS) as [
      DetectedLanguage,
      string[],
    ][]) {
      if (!extensions.includes(ext)) continue;
      const languageStats = stats[language];
      languageStats.totalFiles += 1;
      if (!lowPriority) languageStats.priorityFiles += 1;
      const rootKey = chooseSourceRoot(projectRoot, currentDir, language, depth);
      languageStats.sourceRoots.set(rootKey, (languageStats.sourceRoots.get(rootKey) ?? 0) + 1);
    }
  }
}

function shouldSkipDirectory(name: string): boolean {
  return name.startsWith('.') || SKIP_DIRS.has(name) || name.startsWith('cmake-build-');
}

function chooseSourceRoot(
  projectRoot: string,
  currentDir: string,
  language: DetectedLanguage,
  depth: number
): string {
  if (language === 'cpp' || language === 'go' || language === 'python') {
    return projectRoot;
  }

  if (language === 'java') {
    const javaRoot = path.join(projectRoot, 'src', 'main', 'java');
    if (currentDir.startsWith(javaRoot)) return javaRoot;
    return projectRoot;
  }

  if (language === 'typescript') {
    let dir = currentDir;
    while (dir.startsWith(projectRoot)) {
      if (
        fs.existsSync(path.join(dir, 'tsconfig.json')) ||
        fs.existsSync(path.join(dir, 'package.json'))
      ) {
        return dir;
      }
      if (dir === projectRoot) break;
      dir = path.dirname(dir);
    }
  }

  return depth <= 1 ? currentDir : projectRoot;
}

function buildCandidate(
  language: DetectedLanguage,
  languageStats: LanguageStats,
  projectRoot: string
): LanguageCandidate | null {
  const markerCount = languageStats.markerFiles.size;
  const totalFiles = languageStats.totalFiles;
  const priorityFiles = languageStats.priorityFiles;
  if (markerCount === 0 && totalFiles === 0) {
    return null;
  }

  const rootMarkerCount = Array.from(languageStats.markerRoots.values()).filter(
    (depth) => depth === 0
  ).length;
  const nestedMarkerCount = markerCount - rootMarkerCount;
  const score = rootMarkerCount * 40 + nestedMarkerCount * 12 + priorityFiles * 3 + totalFiles;
  const roots =
    languageStats.markerRoots.size > 0
      ? Array.from(languageStats.markerRoots.entries())
          .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
          .map(([root]) => root)
      : Array.from(languageStats.sourceRoots.entries())
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([root]) => root);

  return {
    language,
    score,
    evidence: [
      ...(markerCount > 0
        ? [`markers: ${Array.from(languageStats.markerFiles).sort().join(', ')}`]
        : []),
      ...(rootMarkerCount > 0 ? [`rootMarkers=${rootMarkerCount}`] : []),
      `priorityFiles=${priorityFiles}`,
      `totalFiles=${totalFiles}`,
    ],
    roots: roots.length > 0 ? roots : [projectRoot],
  };
}
