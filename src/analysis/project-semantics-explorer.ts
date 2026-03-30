import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import {
  ProjectSemanticsSchema,
  sanitizeProjectSemantics,
  type ProjectSemantics,
} from '@/types/extensions/project-semantics.js';
import {
  KNOWN_PROJECT_CONFIG_FILES,
  collectDirectoryTree,
} from './project-semantics-cache.js';

const README_CANDIDATES = ['README.md', 'README.txt', 'Readme.md'];
const DEFAULT_TIMEOUT_MS = 30_000;

async function readReadmeExcerpt(projectRoot: string): Promise<string> {
  for (const candidate of README_CANDIDATES) {
    try {
      const contents = await fs.readFile(path.join(projectRoot, candidate), 'utf8');
      return contents.split(/\r?\n/).slice(0, 50).join('\n');
    } catch {
      // Try the next README candidate.
    }
  }

  return '(no README found)';
}

async function listConfigFiles(projectRoot: string): Promise<string[]> {
  const discovered = await Promise.all(
    KNOWN_PROJECT_CONFIG_FILES.map(async (fileName) => {
      try {
        await fs.access(path.join(projectRoot, fileName));
        return fileName;
      } catch {
        return null;
      }
    })
  );

  return discovered.filter((fileName) => fileName !== null);
}

function extractCliOutput(stdoutOrResult: unknown, stderrMaybe?: string): { stdout: string; stderr: string } {
  if (typeof stdoutOrResult === 'string') {
    return { stdout: stdoutOrResult, stderr: stderrMaybe ?? '' };
  }

  if (
    stdoutOrResult &&
    typeof stdoutOrResult === 'object' &&
    'stdout' in stdoutOrResult &&
    'stderr' in stdoutOrResult
  ) {
    return {
      stdout: String((stdoutOrResult as { stdout: unknown }).stdout ?? ''),
      stderr: String((stdoutOrResult as { stderr: unknown }).stderr ?? ''),
    };
  }

  return { stdout: '', stderr: stderrMaybe ?? '' };
}

export class ProjectSemanticsExplorer {
  constructor(
    private cliCommand: string,
    private cliArgs: string[],
    private timeoutMs: number = DEFAULT_TIMEOUT_MS
  ) {}

  async explore(projectRoot: string): Promise<ProjectSemantics | null> {
    const [tree, configFiles, readmeExcerpt] = await Promise.all([
      collectDirectoryTree(projectRoot, 3),
      listConfigFiles(projectRoot),
      readReadmeExcerpt(projectRoot),
    ]);

    const prompt = this.buildPrompt(tree, configFiles, readmeExcerpt);

    try {
      const stdout = await this.invokeCli(projectRoot, prompt);
      const parsed = ProjectSemanticsSchema.safeParse(JSON.parse(stdout));
      if (!parsed.success) {
        return null;
      }

      const sanitized = sanitizeProjectSemantics(parsed.data);
      if (sanitized.confidence < 0.5) {
        return null;
      }

      return sanitized;
    } catch {
      return null;
    }
  }

  private buildPrompt(tree: string, configFiles: string[], readmeExcerpt: string): string {
    return [
      'You are analyzing a software project to extract structural conventions.',
      '',
      'Project tree (depth 3):',
      tree,
      '',
      'Config files found:',
      configFiles.length > 0 ? configFiles.join('\n') : '(none found)',
      '',
      'README excerpt (first 50 lines):',
      readmeExcerpt,
      '',
      'Respond with JSON only using this shape:',
      '{',
      '  "version": "1.0",',
      '  "nonProductionPatterns": ["playground"],',
      '  "barrelFiles": ["src/index.ts"],',
      '  "additionalTestPatterns": ["**/*.integration.ts"],',
      '  "customAssertionPatterns": ["\\\\bverify\\\\s*\\\\("],',
      '  "architecturalLayers": { "src/domain": "domain" },',
      '  "suggestedDepth": 1,',
      '  "confidence": 0.85',
      '}',
      '',
      'Example output:',
      '{',
      '  "version": "1.0",',
      '  "nonProductionPatterns": ["examples", "tools/codegen", "testutil"],',
      '  "barrelFiles": [],',
      '  "additionalTestPatterns": ["**/*_bench_test.go"],',
      '  "customAssertionPatterns": ["\\\\brequire\\\\.Equal\\\\s*\\\\(", "\\\\bassert\\\\.NoError\\\\s*\\\\("],',
      '  "confidence": 0.85',
      '}',
      '',
      'Guidelines:',
      '- nonProductionPatterns: prefixes for demos, playgrounds, samples, scripts, generators, or test utilities.',
      '- barrelFiles: likely barrel/re-export file candidates based on name and location only.',
      '- additionalTestPatterns: extra test file globs beyond language defaults.',
      '- customAssertionPatterns: regex strings for project-specific assertion helpers.',
      '- architecturalLayers: include only when the layering is clear from the directory structure.',
      '- confidence: number between 0 and 1.',
    ].join('\n');
  }

  private invokeCli(projectRoot: string, prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.cliCommand,
        this.cliArgs,
        {
          cwd: projectRoot,
          timeout: this.timeoutMs,
          maxBuffer: 1024 * 1024,
        },
        (error, stdoutOrResult, stderrMaybe) => {
          if (error) {
            reject(error);
            return;
          }

          const { stdout } = extractCliOutput(stdoutOrResult, stderrMaybe);
          resolve(stdout.trim());
        }
      );

      child.stdin?.end(prompt);
    });
  }
}
