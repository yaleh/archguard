#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.ARCHGUARD_DOCS_ROOT ?? process.cwd();
const mode = process.argv.includes('--write') ? 'write' : 'check';
const stale = [];
const rendererPath = path.join(process.cwd(), 'dist/cli/metadata/docs-renderer.js');

ensureFreshBuild(rendererPath);

const { metadataDocsBlocks, renderMetadataDocsBlock, replaceMetadataDocsBlock } = await import(
  path.toNamespacedPath(rendererPath)
);

for (const [blockId, config] of Object.entries(metadataDocsBlocks)) {
  const filePath = path.join(root, config.filePath);
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const next = replaceMetadataDocsBlock(current, blockId, renderMetadataDocsBlock(blockId));

  if (next !== current) {
    if (mode === 'write') {
      fs.writeFileSync(filePath, next);
    } else {
      stale.push(config.filePath);
    }
  }
}

if (stale.length > 0) {
  console.error('Metadata docs are stale. Run: npm run docs:write');
  for (const file of [...new Set(stale)]) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

console.log(
  mode === 'write' ? 'Metadata docs updated.' : 'Metadata docs are up to date.'
);

function ensureFreshBuild(distPath) {
  if (!fs.existsSync(distPath)) {
    console.error('Metadata docs renderer is not built. Run: npm run build');
    process.exit(1);
  }

  const sourceDir = path.join(process.cwd(), 'src/cli/metadata');
  const newestSource = newestMtimeMs(sourceDir);
  const distMtime = fs.statSync(distPath).mtimeMs;

  if (newestSource > distMtime) {
    console.error('Metadata docs renderer is stale. Run: npm run build');
    process.exit(1);
  }
}

function newestMtimeMs(targetPath) {
  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }

  return Math.max(
    stat.mtimeMs,
    ...fs
      .readdirSync(targetPath)
      .map((entry) => newestMtimeMs(path.join(targetPath, entry)))
  );
}
