/**
 * `archguard config doctor codebase-memory` — read-only backend diagnostics.
 *
 * The doctor probes the Codebase Memory backend WITHOUT mutating the user's
 * environment. It performs exactly one read (`list_projects`) and derives a
 * structured report from it:
 *
 *   1. binary locatable — is `codebase-memory-mcp` (or the configured command)
 *      on PATH / executable?  Inferred from whether `list_projects` could be
 *      spawned at all.
 *   2. list_projects executable — did the CLI return parseable JSON?
 *   3. project resolution — does the current `projectRoot` resolve to a unique
 *      Codebase Memory project?
 *   4. index status — is that project indexed?  When not, an `index_repository`
 *      next step is surfaced (the doctor never runs it).
 *
 * Hard guarantees:
 *   - No install, no index, no config writes. Only `list_projects` is called.
 *   - Plain `archguard mcp` startup does NOT trigger this check; it runs only
 *     when the user explicitly invokes the doctor subcommand.
 *
 * See: docs/proposals/proposal-codebase-memory-backend-adapter.md (doctor契约).
 *
 * @module cli/commands/doctor
 */

import { Command } from 'commander';
import path from 'node:path';
import { ConfigLoader } from '@/cli/config-loader.js';
import { CodebaseMemoryClient } from '@/integrations/codebase-memory/client.js';
import {
  resolveProject,
  type CodebaseMemoryProjectInfo,
} from '@/integrations/codebase-memory/project-resolver.js';
import { type BackendDiagnostic } from '@/integrations/codebase-memory/types.js';

/** Binary-locatability section of the doctor report. */
export interface DoctorBinaryReport {
  /** Whether the backend binary could be located / spawned. */
  found: boolean;
  /** The command / path that was probed. */
  command: string;
}

/** Project-resolution section of the doctor report. */
export interface DoctorProjectReport {
  /** Whether a unique Codebase Memory project was resolved. */
  found: boolean;
  /** The repository root that was probed. */
  root: string;
  /** Resolved project name, when found. */
  name?: string;
  /** Whether the resolved project is indexed, when known. */
  indexed?: boolean;
}

/** Structured, read-only doctor report. */
export interface DoctorReport {
  /** True only when the binary is found, the project resolves, and it is indexed. */
  ok: boolean;
  /** Always `codebase-memory` for this doctor. */
  backend: 'codebase-memory';
  /** Binary locatability section. */
  binary: DoctorBinaryReport;
  /** Project-resolution section. */
  project: DoctorProjectReport;
  /** Concrete commands / steps the user can run to recover. */
  nextSteps: string[];
  /** Normalized diagnostics gathered while probing, if any. */
  diagnostics?: BackendDiagnostic[];
}

/** Build the actionable `index_repository` next-step command. */
function indexNextStep(projectRoot: string): string {
  return `codebase-memory-mcp cli index_repository '${JSON.stringify({
    repo_path: path.resolve(projectRoot),
  })}'`;
}

/** Normalize a path for comparison (resolve + strip trailing separators). */
function normalizePath(p: string): string {
  return path.resolve(p);
}

/**
 * Look up the indexed flag for a resolved project by re-reading the
 * `list_projects` payload. Returns `undefined` when the flag is not reported.
 */
function lookupIndexed(
  projects: CodebaseMemoryProjectInfo[],
  projectName: string,
  projectRoot: string
): boolean | undefined {
  const target = normalizePath(projectRoot);
  const match =
    projects.find((p) => typeof p.root === 'string' && normalizePath(p.root) === target) ??
    projects.find((p) => p.name === projectName);
  return match?.indexed;
}

/**
 * Run the read-only Codebase Memory doctor against a client + repository root.
 *
 * This is the pure core used by both the CLI subcommand and unit tests. It
 * issues at most one `list_projects` call and derives the full structured
 * report from it — it never invokes any mutating tool.
 *
 * @param client - a {@link CodebaseMemoryClient} (real or mocked).
 * @param projectRoot - the repository root to probe.
 */
export async function runCodebaseMemoryDoctor(
  client: CodebaseMemoryClient,
  projectRoot: string
): Promise<DoctorReport> {
  const command = client.getCommand();
  const nextSteps: string[] = [];
  const diagnostics: BackendDiagnostic[] = [];

  // Step 1+2: probe binary + list_projects executability in one read.
  const listed = await client.call<{ projects?: CodebaseMemoryProjectInfo[] }>('list_projects');

  if (listed.ok !== true) {
    diagnostics.push(listed.diagnostic);
    if (listed.diagnostic.nextSteps) {
      nextSteps.push(...listed.diagnostic.nextSteps);
    }
    // `binary-missing` means the binary itself could not be spawned; any other
    // failure (timeout / parse / backend error) means the binary IS present but
    // the call failed — distinguish so the report is accurate.
    const binaryFound = listed.diagnostic.code !== 'binary-missing';
    return {
      ok: false,
      backend: 'codebase-memory',
      binary: { found: binaryFound, command },
      project: { found: false, root: projectRoot },
      nextSteps,
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
    };
  }

  // Binary is present and list_projects returned parseable JSON.
  const projects = listed.data.projects ?? [];

  // Step 3: resolve the project for this repository root.
  const resolution = await resolveProject(client, projectRoot);
  if (resolution.ok !== true) {
    diagnostics.push(resolution.diagnostic);
    if (resolution.diagnostic.nextSteps) {
      nextSteps.push(...resolution.diagnostic.nextSteps);
    }
    return {
      ok: false,
      backend: 'codebase-memory',
      binary: { found: true, command },
      project: { found: false, root: projectRoot },
      nextSteps,
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
    };
  }

  // Step 4: project resolved — check index status.
  const indexed = lookupIndexed(projects, resolution.project, projectRoot);
  const project: DoctorProjectReport = {
    found: true,
    root: projectRoot,
    name: resolution.project,
  };
  if (indexed !== undefined) {
    project.indexed = indexed;
  }

  // Indexed === false is the only state that adds a next step; `undefined`
  // (flag not reported) is treated as "no concrete evidence of staleness".
  const ok = indexed !== false;
  if (indexed === false) {
    nextSteps.push(indexNextStep(projectRoot));
  }

  return {
    ok,
    backend: 'codebase-memory',
    binary: { found: true, command },
    project,
    nextSteps,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

/** Resolve the configured Codebase Memory command from the loaded config. */
async function resolveCommandFromConfig(configPath: string): Promise<{
  command: string;
  timeoutMs: number;
}> {
  const loader = new ConfigLoader();
  const config = await loader.load({}, configPath);
  const cbm = config.queryBackends?.codebaseMemory;
  return {
    command: cbm?.command ?? 'codebase-memory-mcp',
    timeoutMs: cbm?.timeoutMs ?? 10000,
  };
}

/**
 * Build the `config` parent command exposing the read-only
 * `doctor codebase-memory` subcommand.
 */
export function createConfigCommand(): Command {
  const config = new Command('config');
  config.description('Inspect and diagnose ArchGuard configuration (read-only)');

  const doctor = new Command('doctor');
  doctor.description('Diagnose backend availability without modifying anything');

  doctor
    .command('codebase-memory')
    .description(
      'Read-only check: binary on PATH, list_projects executable, project resolution, index status'
    )
    .option('--config <path>', 'Config file path', 'archguard.config.json')
    .option('--project-root <dir>', 'Repository root to probe', process.cwd())
    .option('--json', 'Emit the structured report as JSON', false)
    .action(async (options: { config: string; projectRoot: string; json: boolean }) => {
      const { command, timeoutMs } = await resolveCommandFromConfig(options.config);
      const client = new CodebaseMemoryClient({ command, timeoutMs });
      const report = await runCodebaseMemoryDoctor(client, options.projectRoot);

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printHumanReport(report);
      }

      if (!report.ok) {
        process.exit(1);
      }
    });

  config.addCommand(doctor);
  return config;
}

/** Print a concise, human-friendly rendering of the doctor report. */
function printHumanReport(report: DoctorReport): void {
  const tick = (b: boolean): string => (b ? 'OK  ' : 'FAIL');

  console.log(`Codebase Memory doctor (read-only)`);
  console.log(`${tick(report.binary.found)} binary: ${report.binary.command}`);
  console.log(
    `${tick(report.project.found)} project: ${
      report.project.found ? report.project.name : `not resolved (${report.project.root})`
    }`
  );
  if (report.project.found && report.project.indexed !== undefined) {
    console.log(`${tick(report.project.indexed)} indexed: ${report.project.indexed}`);
  }

  for (const diag of report.diagnostics ?? []) {
    console.log(`- [${diag.severity}] ${diag.message}`);
  }

  if (report.nextSteps.length > 0) {
    console.log('\nNext steps:');
    for (const step of report.nextSteps) {
      console.log(`  ${step}`);
    }
  }

  console.log(`\nResult: ${report.ok ? 'ok' : 'needs attention'}`);
}
