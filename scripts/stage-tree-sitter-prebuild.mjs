#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const packageRoot = process.cwd();
const treeSitterDir = path.join(packageRoot, 'node_modules', 'tree-sitter');

if (!existsSync(treeSitterDir)) {
  console.error('[archguard] tree-sitter is not installed in node_modules.');
  process.exit(1);
}

const buildCandidates = [
  path.join(treeSitterDir, 'build', 'Release', 'tree_sitter_runtime_binding.node'),
  path.join(treeSitterDir, 'build', 'Release', 'obj.target', 'tree_sitter_runtime_binding.node'),
];

const existingPrebuild = findExistingPrebuild(treeSitterDir);
const buildArtifact = buildCandidates.find((candidate) => existsSync(candidate) && statSync(candidate).size > 0);

if (!buildArtifact && !existingPrebuild) {
  console.error('[archguard] No tree-sitter native binding found to stage as a prebuild.');
  process.exit(1);
}

if (buildArtifact) {
  const tupleDir = path.join(treeSitterDir, 'prebuilds', `${process.platform}-${os.arch()}`);
  const prebuildName = buildPrebuildName();
  const targetPath = path.join(tupleDir, prebuildName);

  mkdirSync(tupleDir, { recursive: true });
  copyFileSync(buildArtifact, targetPath);
  console.log(`[archguard] staged tree-sitter prebuild: ${path.relative(packageRoot, targetPath)}`);
}

rmSync(path.join(treeSitterDir, 'build'), { recursive: true, force: true });
rmSync(path.join(treeSitterDir, 'node-addon-api'), { recursive: true, force: true });

function findExistingPrebuild(rootDir) {
  const prebuildRoot = path.join(rootDir, 'prebuilds');
  if (!existsSync(prebuildRoot)) {
    return null;
  }

  const tupleDir = path.join(prebuildRoot, `${process.platform}-${os.arch()}`);
  return existsSync(tupleDir) ? tupleDir : null;
}

function buildPrebuildName() {
  const tags = ['node', 'napi'];

  if (process.platform === 'linux') {
    tags.push(detectLinuxLibc());
  }

  return `${tags.join('.')}.node`;
}

function detectLinuxLibc() {
  return process.report?.getReport().header.glibcVersionRuntime ? 'glibc' : 'musl';
}
