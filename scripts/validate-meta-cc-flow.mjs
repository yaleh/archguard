/**
 * Validation script: meta-cc flow analysis with manual entry points + followIndirectCalls
 *
 * Tests Fix 1 (forceExtractFunctions) and Fix 2 (BFS followIndirectCalls).
 *
 * Run: node scripts/validate-meta-cc-flow.mjs
 */
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import { readFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.join(__dirname, '..', 'dist');

// Dynamic import from dist
const { GoPlugin } = await import(pathToFileURL(path.join(distRoot, 'plugins/golang/index.js')).href);

const META_CC = '/home/yale/work/meta-cc';

const plugin = new GoPlugin();
await plugin.initialize({ workspaceRoot: META_CC, sourceRoot: META_CC });

console.log('=== meta-cc Flow Analysis: Fix 1 + Fix 2 ===\n');
console.log('Config: selective extraction + manualEntryPoints=[handleToolsCall,...] + followIndirectCalls=true\n');

const arch = await plugin.parseProject(META_CC, {
  workspaceRoot: META_CC,
  sourceRoot: META_CC,
  includePatterns: ['**/*.go'],
  excludePatterns: ['**/vendor/**', '**/testdata/**', '**/*_test.go'],
  languageSpecific: {
    atlas: {
      functionBodyStrategy: 'selective',
      entryPoints: [
        { function: 'handleToolsCall', protocol: 'mcp' },
        { function: 'handleInitialize', protocol: 'mcp' },
        { function: 'handleToolsList', protocol: 'mcp' },
      ],
      followIndirectCalls: true,
      maxCallDepth: 3,
    },
  },
});

const flow = arch.extensions?.goAtlas?.layers?.flow;
if (!flow) {
  console.error('ERROR: No flow layer in output');
  process.exit(1);
}

console.log('=== entryPoints ===');
for (const ep of flow.entryPoints) {
  console.log(`  [${ep.framework}] ${ep.protocol}  handler="${ep.handler}"  @ ${ep.location.file}:${ep.location.line}`);
}

console.log('\n=== callChains ===');
for (const chain of flow.callChains) {
  const ep = flow.entryPoints.find((e) => e.id === chain.entryPoint);
  if (!ep) continue;
  console.log(`\n  ── ${ep.handler} [${ep.protocol}] (${chain.calls.length} edges):`);
  for (const edge of chain.calls) {
    console.log(`    ${edge.from} → ${edge.to}  [${edge.type}]`);
  }
}
