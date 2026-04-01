import path from 'node:path';
import os from 'node:os';
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

function findBalancedJsonCandidates(raw: string): string[] {
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];

    if (start === -1) {
      if (char === '{' || char === '[') {
        start = index;
        depth = 1;
        inString = false;
        escapeNext = false;
      }
      continue;
    }

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{' || char === '[') {
      depth += 1;
      continue;
    }

    if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) {
        candidates.push(raw.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return candidates;
}

function extractAssistantTranscriptSection(raw: string): string | null {
  const normalized = raw.replace(/\r\n/g, '\n');
  const markerPattern = /(?:^|\n)(assistant|codex)\n/g;
  let lastMatch: RegExpExecArray | null = null;

  while (true) {
    const match = markerPattern.exec(normalized);
    if (!match) break;
    lastMatch = match;
  }

  if (!lastMatch) {
    return null;
  }

  return normalized.slice(lastMatch.index + lastMatch[0].length).trim();
}

function extractProjectSemanticsJson(
  lastMessage: string | null,
  stdout: string,
  stderr: string
): ProjectSemantics | null {
  const directCandidates = [lastMessage?.trim(), stdout.trim(), stderr.trim()].filter(
    (value): value is string => Boolean(value && value.length > 0)
  );
  const transcriptCandidates = [stdout, stderr]
    .map(extractAssistantTranscriptSection)
    .filter((value): value is string => value !== null && value.length > 0);
  const allCandidates = [
    ...directCandidates,
    ...transcriptCandidates.flatMap((value) => findBalancedJsonCandidates(value)),
  ];

  for (let index = allCandidates.length - 1; index >= 0; index--) {
    const candidate = allCandidates[index];
    try {
      const parsedJson = JSON.parse(candidate) as Record<string, unknown>;
      if (parsedJson.architecturalLayers === null) {
        delete parsedJson.architecturalLayers;
      }
      if (parsedJson.suggestedDepth === null) {
        delete parsedJson.suggestedDepth;
      }
      const parsed = ProjectSemanticsSchema.safeParse(parsedJson);
      if (parsed.success) {
        return parsed.data;
      }
    } catch {
      // Try the next candidate block.
    }
  }

  return null;
}

function injectCodexStructuredArgs(cliArgs: string[], injectedArgs: string[]): string[] {
  const stdinPromptIndex = cliArgs.lastIndexOf('-');
  if (stdinPromptIndex === -1) {
    return [...cliArgs, ...injectedArgs];
  }

  return [
    ...cliArgs.slice(0, stdinPromptIndex),
    ...injectedArgs,
    ...cliArgs.slice(stdinPromptIndex),
  ];
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
      const { lastMessage, stdout, stderr } = await this.invokeCli(projectRoot, prompt);
      const parsed = extractProjectSemanticsJson(lastMessage, stdout, stderr);
      if (!parsed) {
        return null;
      }

      const sanitized = sanitizeProjectSemantics(parsed);
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
      'Do not use tools, do not run commands, and do not inspect files beyond the provided inputs.',
      'Base the answer only on the directory tree, config file list, and README excerpt below.',
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

  private async invokeCli(
    projectRoot: string,
    prompt: string
  ): Promise<{ lastMessage: string | null; stdout: string; stderr: string }> {
    const useCodexOutputFile =
      path.basename(this.cliCommand).toLowerCase().includes('codex') &&
      this.cliArgs.includes('exec') &&
      !this.cliArgs.includes('--output-last-message') &&
      !this.cliArgs.includes('-o');
    const outputDir = useCodexOutputFile
      ? await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-project-semantics-'))
      : null;
    const outputFile = outputDir ? path.join(outputDir, 'last-message.txt') : null;
    const schemaFile = outputDir ? path.join(outputDir, 'project-semantics.schema.json') : null;
    if (schemaFile) {
      await fs.writeFile(
        schemaFile,
        JSON.stringify(
          {
            type: 'object',
            additionalProperties: false,
            required: [
              'version',
              'nonProductionPatterns',
              'barrelFiles',
              'additionalTestPatterns',
              'customAssertionPatterns',
              'architecturalLayers',
              'suggestedDepth',
              'confidence',
            ],
            properties: {
              version: { type: 'string', enum: ['1.0'] },
              nonProductionPatterns: { type: 'array', items: { type: 'string' } },
              barrelFiles: { type: 'array', items: { type: 'string' } },
              additionalTestPatterns: { type: 'array', items: { type: 'string' } },
              customAssertionPatterns: { type: 'array', items: { type: 'string' } },
              architecturalLayers: {
                anyOf: [
                  {
                    type: 'object',
                    additionalProperties: { type: 'string' },
                  },
                  { type: 'null' },
                ],
              },
              suggestedDepth: {
                anyOf: [
                  { type: 'integer', minimum: 1, maximum: 5 },
                  { type: 'null' },
                ],
              },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
          null,
          2
        )
      );
    }
    const cliArgs =
      outputFile !== null && schemaFile !== null
        ? injectCodexStructuredArgs(this.cliArgs, [
            '--output-schema',
            schemaFile,
            '--output-last-message',
            outputFile,
          ])
        : [...this.cliArgs];

    return new Promise((resolve, reject) => {
      const child = execFile(
        this.cliCommand,
        cliArgs,
        {
          cwd: projectRoot,
          timeout: this.timeoutMs,
          maxBuffer: 1024 * 1024,
        },
        (error, stdoutOrResult, stderrMaybe) => {
          (async () => {
            try {
              if (error) {
                reject(error);
                return;
              }

              const output = extractCliOutput(stdoutOrResult, stderrMaybe);
              const lastMessage =
                outputFile !== null
                  ? await fs.readFile(outputFile, 'utf8').catch(() => null)
                  : null;
              resolve({
                lastMessage: lastMessage?.trim() ?? null,
                stdout: output.stdout.trim(),
                stderr: output.stderr.trim(),
              });
            } finally {
              if (outputDir) {
                await fs.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
              }
            }
          })().catch(reject);
        }
      );

      child.stdin?.end(prompt);
    });
  }
}
