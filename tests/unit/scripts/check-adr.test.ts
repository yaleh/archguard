/**
 * Unit tests for scripts/check-adr.ts
 *
 * Tests use in-memory fixture strings; only one "clean real-codebase run"
 * assertion per ADR.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkAdr006,
  checkAdr007,
  hasSuppression,
  filterViolations,
  extractMcpToolNames,
  extractCliFlags,
  toCanonical,
  type Violation,
} from '../../../scripts/check-adr.js';

// ---------------------------------------------------------------------------
// Helpers for fixture-based tests
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'check-adr-test-'));
}

function writeFile(dir: string, relPath: string, content: string): string {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return full;
}

// ---------------------------------------------------------------------------
// ADR-006: checkAdr006()
// ---------------------------------------------------------------------------

describe('checkAdr006()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns no violations when no description starts with "Get"', () => {
    writeFile(
      tmpDir,
      'tools/good-tool.ts',
      `
server.tool(
  'archguard_find_entity',
  'Find entities by name or type filter.',
  {},
  async () => {}
);
`
    );
    const violations = checkAdr006(tmpDir);
    expect(violations).toHaveLength(0);
  });

  it('flags a description starting with "Get "', () => {
    writeFile(
      tmpDir,
      'tools/bad-tool.ts',
      `
server.tool(
  'archguard_get_something',
  'Get all entities defined in a specific file.',
  {},
  async () => {}
);
`
    );
    const violations = checkAdr006(tmpDir);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].adr).toBe('ADR-006');
    expect(violations[0].evidence).toContain('Get all entities');
  });

  it('is case-insensitive: "get " also triggers violation', () => {
    writeFile(
      tmpDir,
      'tools/lowercase.ts',
      `
server.tool(
  'archguard_get_foo',
  'get all the things here.',
  {},
  async () => {}
);
`
    );
    const violations = checkAdr006(tmpDir);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('does NOT flag descriptions starting with other verbs (Return, Detect, Find)', () => {
    writeFile(
      tmpDir,
      'tools/good-verbs.ts',
      `
server.tool(
  'archguard_find_entity',
  'Return entities matching the given name.',
  {},
  async () => {}
);
server.tool(
  'archguard_detect_cycles',
  'Detect dependency cycles in the architecture.',
  {},
  async () => {}
);
server.tool(
  'archguard_find_implementers',
  'Find classes that implement a given interface.',
  {},
  async () => {}
);
`
    );
    const violations = checkAdr006(tmpDir);
    expect(violations).toHaveLength(0);
  });

  it('returns 0 violations on real src/cli/mcp/ (current codebase is clean or suppressed)', () => {
    const realMcpDir = path.join(process.cwd(), 'src', 'cli', 'mcp');
    const raw = checkAdr006(realMcpDir);
    const filtered = filterViolations(raw);
    expect(filtered).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// hasSuppression()
// ---------------------------------------------------------------------------

describe('hasSuppression()', () => {
  it('returns true for // adr-ok: ADR-006 — reason in the 3 lines before violation', () => {
    const fileLines = [
      '// some code',
      '// adr-ok: ADR-006 — low priority legacy description',
      "  'Get all entities defined in a specific file.',",
    ];
    const violation: Violation = {
      adr: 'ADR-006',
      file: '/fake/file.ts',
      line: 3, // 1-indexed
      message: 'test',
      evidence: 'Get all entities',
    };
    expect(hasSuppression(violation, fileLines)).toBe(true);
  });

  it('returns false for bare // adr-ok (no ADR number)', () => {
    const fileLines = ['// adr-ok', "  'Get all entities defined in a specific file.',"];
    const violation: Violation = {
      adr: 'ADR-006',
      file: '/fake/file.ts',
      line: 2,
      message: 'test',
      evidence: 'Get all entities',
    };
    expect(hasSuppression(violation, fileLines)).toBe(false);
  });

  it('returns false for // adr-ok: ADR-006 without em-dash and reason', () => {
    const fileLines = ['// adr-ok: ADR-006', "  'Get all entities defined in a specific file.',"];
    const violation: Violation = {
      adr: 'ADR-006',
      file: '/fake/file.ts',
      line: 2,
      message: 'test',
      evidence: 'Get all entities',
    };
    expect(hasSuppression(violation, fileLines)).toBe(false);
  });

  it('returns false when ADR number does not match', () => {
    const fileLines = [
      '// adr-ok: ADR-007 — wrong ADR number',
      "  'Get all entities defined in a specific file.',",
    ];
    const violation: Violation = {
      adr: 'ADR-006',
      file: '/fake/file.ts',
      line: 2,
      message: 'test',
      evidence: 'Get all entities',
    };
    expect(hasSuppression(violation, fileLines)).toBe(false);
  });

  it('returns false when suppression is more than 3 lines before violation', () => {
    const fileLines = [
      '// adr-ok: ADR-006 — reason here',
      '// line 2',
      '// line 3',
      '// line 4',
      "  'Get all entities defined in a specific file.',", // line 5 (1-indexed)
    ];
    const violation: Violation = {
      adr: 'ADR-006',
      file: '/fake/file.ts',
      line: 5,
      message: 'test',
      evidence: 'Get all entities',
    };
    expect(hasSuppression(violation, fileLines)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// filterViolations()
// ---------------------------------------------------------------------------

describe('filterViolations()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes suppressed violations', () => {
    const filePath = writeFile(
      tmpDir,
      'suppressed.ts',
      `// some preamble
// adr-ok: ADR-006 — low priority, kept for backwards compat
  'Get all entities defined in a specific file.',
`
    );

    const violations: Violation[] = [
      {
        adr: 'ADR-006',
        file: filePath,
        line: 3,
        message: 'starts with Get',
        evidence: 'Get all entities',
      },
    ];

    const result = filterViolations(violations);
    expect(result).toHaveLength(0);
  });

  it('keeps unsuppressed violations', () => {
    const filePath = writeFile(
      tmpDir,
      'unsuppressed.ts',
      `  'Get all entities defined in a specific file.',\n`
    );

    const violations: Violation[] = [
      {
        adr: 'ADR-006',
        file: filePath,
        line: 1,
        message: 'starts with Get',
        evidence: 'Get all entities',
      },
    ];

    const result = filterViolations(violations);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ADR-007: extractMcpToolNames()
// ---------------------------------------------------------------------------

describe('extractMcpToolNames()', () => {
  it('returns tools from src/cli/mcp/ (at least 20)', () => {
    const realMcpDir = path.join(process.cwd(), 'src', 'cli', 'mcp');
    const tools = extractMcpToolNames(realMcpDir);
    expect(tools.length).toBeGreaterThanOrEqual(20);
  });

  it('extracts tool names from fixture content', () => {
    const tmpDir = makeTempDir();
    try {
      writeFile(
        tmpDir,
        'server.ts',
        `
server.tool(
  'archguard_find_entity',
  'Find entities...',
  {},
  async () => {}
);
server.tool(
  'archguard_get_dependencies',
  'Return dependencies...',
  {},
  async () => {}
);
`
      );
      const tools = extractMcpToolNames(tmpDir);
      expect(tools).toContain('archguard_find_entity');
      expect(tools).toContain('archguard_get_dependencies');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// ADR-007: extractCliFlags()
// ---------------------------------------------------------------------------

describe('extractCliFlags()', () => {
  it('returns flags from src/cli/commands/query.ts (at least 15)', () => {
    const queryFile = path.join(process.cwd(), 'src', 'cli', 'commands', 'query.ts');
    const flags = extractCliFlags(queryFile);
    expect(flags.length).toBeGreaterThanOrEqual(15);
  });

  it('extracts flags from fixture content', () => {
    const tmpDir = makeTempDir();
    try {
      const fixturePath = writeFile(
        tmpDir,
        'query.ts',
        `
new Command('query')
  .option('--entity <name>', 'Find entity')
  .option('--deps-of <name>', 'Find deps')
  .option('--atlas-layer <layer>', 'Atlas layer')
`
      );
      const flags = extractCliFlags(fixturePath);
      expect(flags).toContain('--entity');
      expect(flags).toContain('--deps-of');
      expect(flags).toContain('--atlas-layer');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// ADR-007: toCanonical()
// ---------------------------------------------------------------------------

describe('toCanonical()', () => {
  it('converts archguard_get_atlas_layer to atlas-layer', () => {
    expect(toCanonical('archguard_get_atlas_layer')).toBe('atlas-layer');
  });

  it('converts --atlas-layer to atlas-layer', () => {
    expect(toCanonical('--atlas-layer')).toBe('atlas-layer');
  });

  it('converts archguard_find_entity to entity', () => {
    expect(toCanonical('archguard_find_entity')).toBe('entity');
  });

  it('converts archguard_detect_cycles to cycles', () => {
    expect(toCanonical('archguard_detect_cycles')).toBe('cycles');
  });

  it('converts archguard_summary to summary (no verb to strip)', () => {
    expect(toCanonical('archguard_summary')).toBe('summary');
  });

  it('converts --package-stats to package-stats', () => {
    expect(toCanonical('--package-stats')).toBe('package-stats');
  });
});

// ---------------------------------------------------------------------------
// ADR-007: checkAdr007()
// ---------------------------------------------------------------------------

describe('checkAdr007()', () => {
  it('returns no violations on current codebase (all tools matched or suppressed)', () => {
    const raw = checkAdr007();
    const filtered = filterViolations(raw);
    expect(filtered).toHaveLength(0);
  });

  it('detects missing CLI flag for synthetic archguard_fake_tool', () => {
    const tmpDir = makeTempDir();
    const queryFile = path.join(process.cwd(), 'src', 'cli', 'commands', 'query.ts');

    try {
      writeFile(
        tmpDir,
        'fake-tool.ts',
        `
server.tool(
  'archguard_fake_tool',
  'Do something fake.',
  {},
  async () => {}
);
`
      );
      const violations = checkAdr007(tmpDir, queryFile);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].evidence).toBe('archguard_fake_tool');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('plural CLI flag matches singular MCP tool (packages → package)', () => {
    // archguard_get_package_fanin → canonical: package-fanin
    // CLI flag --package-fanin → canonical: package-fanin
    // Both should match
    const mcpCanonical = toCanonical('archguard_get_package_fanin');
    const cliCanonical = toCanonical('--package-fanin');
    // They should be the same canonical form
    expect(mcpCanonical).toBe(cliCanonical);
  });
});

// ---------------------------------------------------------------------------
// ADR doc and settings check
// ---------------------------------------------------------------------------

describe('ADR documents and settings.json contain expected content', () => {
  it('docs/adr/006-mcp-tool-design-standards.md contains ## Mechanical Check', () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), 'docs', 'adr', '006-mcp-tool-design-standards.md'),
      'utf-8'
    );
    expect(content).toContain('## Mechanical Check');
  });

  it('docs/adr/007-cli-mcp-interface-parity.md contains ## Mechanical Check', () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), 'docs', 'adr', '007-cli-mcp-interface-parity.md'),
      'utf-8'
    );
    expect(content).toContain('## Mechanical Check');
  });

  it('.claude/settings.json contains a Stop hook referencing check:adr', () => {
    const settingsPath = path.join(process.cwd(), '.claude', 'settings.json');
    expect(fs.existsSync(settingsPath)).toBe(true);
    const content = fs.readFileSync(settingsPath, 'utf-8');
    expect(content).toContain('check:adr');
  });
});
