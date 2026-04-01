#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

async function pathExists(targetPath) {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listDirectChildSkillDirs(sourceDir) {
  const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });
  const skillNames = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(sourceDir, entry.name);
    if (await pathExists(path.join(skillDir, 'SKILL.md'))) {
      skillNames.push(entry.name);
    }
  }

  return skillNames.sort();
}

export async function syncClaudeSkills(sourceDir, targetDir) {
  await fs.promises.mkdir(targetDir, { recursive: true });
  const skillNames = await listDirectChildSkillDirs(sourceDir);

  for (const skillName of skillNames) {
    const sourceSkillDir = path.join(sourceDir, skillName);
    const targetSkillDir = path.join(targetDir, skillName);

    await fs.promises.rm(targetSkillDir, { recursive: true, force: true });
    await fs.promises.cp(sourceSkillDir, targetSkillDir, { recursive: true });
  }

  return skillNames;
}

async function main(argv) {
  const [sourceDir, targetDir] = argv;
  if (!sourceDir || !targetDir) {
    console.error('usage: node scripts/sync-claude-skills.mjs <sourceDir> <targetDir>');
    process.exit(1);
  }

  const synced = await syncClaudeSkills(sourceDir, targetDir);
  for (const skillName of synced) {
    console.log(`[archguard-install] synced skill: ${skillName}`);
  }
}

const isEntrypoint = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
  : false;

if (isEntrypoint) {
  main(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[archguard-install] failed to sync skills: ${message}`);
    process.exit(1);
  });
}
