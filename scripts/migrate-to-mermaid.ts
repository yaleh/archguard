#!/usr/bin/env node
/**
 * Migration Tool: PlantUML → Mermaid
 *
 * This script safely migrates ArchGuard configuration from PlantUML to Mermaid format.
 *
 * Features:
 * - Automatic backup of existing config
 * - Format conversion: plantuml/svg → mermaid
 * - Adds default mermaid configuration
 * - Preserves all other settings
 * - Safe and reversible
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface OldConfig {
  format?: string;
  cli?: {
    command?: string;
    args?: string[];
    timeout?: number;
  };
  [key: string]: any;
}

interface NewConfig {
  format: 'mermaid' | 'json';
  mermaid?: {
    enableLLMGrouping?: boolean;
    renderer?: 'isomorphic' | 'cli';
    theme?: 'default' | 'forest' | 'dark' | 'neutral';
    transparentBackground?: boolean;
  };
  cli?: {
    command?: string;
    args?: string[];
    timeout?: number;
  };
  [key: string]: any;
}

/**
 * Migrate configuration file from PlantUML to Mermaid
 */
export async function migrateConfig(configPath: string): Promise<void> {
  console.log(`🔄 Migrating ${configPath}...`);

  try {
    // Check if config exists
    const exists = await fs.pathExists(configPath);
    if (!exists) {
      console.log(`ℹ️  Config file not found: ${configPath}`);
      console.log('💡 To create a new config, run:');
      console.log('  node dist/cli/index.js init');
      return;
    }

    // Read old configuration
    const oldConfig: OldConfig = await fs.readJson(configPath);

    // Check if migration is needed
    if (oldConfig.format === 'mermaid' || !oldConfig.format) {
      console.log('✅ Already using Mermaid format or no format specified.');
      console.log('💡 If you want to add mermaid-specific settings, edit the config manually.');
      return;
    }

    if (oldConfig.format !== 'plantuml' && oldConfig.format !== 'svg') {
      console.log(`ℹ️  Format is "${oldConfig.format}", no migration needed.`);
      return;
    }

    // Backup
    const backupPath = configPath + '.bak';
    await fs.copy(configPath, backupPath);
    console.log(`✅ Backup saved to: ${backupPath}`);

    // Transform configuration
    const newConfig: NewConfig = transformConfig(oldConfig);

    // Save new configuration
    await fs.writeJson(configPath, newConfig, { spaces: 2 });
    console.log('✅ Migration complete!');
    console.log('\n📝 New configuration:');
    console.log(JSON.stringify(newConfig, null, 2));

    console.log('\n💡 Next steps:');
    console.log('  1. Review the new configuration');
    console.log('  2. Test with: node dist/cli/index.js analyze -s ./src --no-llm-grouping');
    console.log('  3. If satisfied, delete the backup: rm ' + backupPath);

  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.log(`ℹ️  Config file not found: ${configPath}`);
      console.log('💡 To create a new config, run:');
      console.log('  node dist/cli/index.js init');
    } else {
      console.error('❌ Migration failed:', error.message);
      throw error;
    }
  }
}

/**
 * Transform old config to new config
 */
function transformConfig(oldConfig: OldConfig): NewConfig {
  const newConfig: NewConfig = {
    ...oldConfig,
    format: 'mermaid',
    mermaid: {
      enableLLMGrouping: true,
      renderer: 'isomorphic',
      theme: 'default',
      transparentBackground: true,
    },
  };

  // Preserve CLI settings if they exist
  if (oldConfig.cli) {
    newConfig.cli = {
      ...oldConfig.cli,
    };
  }

  return newConfig;
}

/**
 * Rollback migration using backup file
 */
export async function rollbackMigration(configPath: string): Promise<void> {
  const backupPath = configPath + '.bak';

  console.log(`🔄 Rolling back ${configPath}...`);

  try {
    const backupExists = await fs.pathExists(backupPath);
    if (!backupExists) {
      console.log(`❌ Backup file not found: ${backupPath}`);
      console.log('ℹ️  Cannot rollback without backup.');
      return;
    }

    // Restore from backup
    await fs.copy(backupPath, configPath, { overwrite: true });
    console.log('✅ Rollback complete!');
    console.log(`ℹ️  Backup preserved at: ${backupPath}`);
    console.log('💡 Delete backup when satisfied: rm ' + backupPath);

  } catch (error: any) {
    console.error('❌ Rollback failed:', error.message);
    throw error;
  }
}

/**
 * Validate migrated configuration
 */
export async function validateConfig(configPath: string): Promise<boolean> {
  console.log(`🔍 Validating ${configPath}...`);

  try {
    const config: NewConfig = await fs.readJson(configPath);

    // Check format
    if (config.format !== 'mermaid' && config.format !== 'json') {
      console.log(`❌ Invalid format: ${config.format}`);
      return false;
    }

    // Check mermaid config
    if (config.mermaid) {
      const { enableLLMGrouping, renderer, theme } = config.mermaid;

      if (typeof enableLLMGrouping !== 'boolean') {
        console.log('❌ mermaid.enableLLMGrouping must be a boolean');
        return false;
      }

      if (renderer && !['isomorphic', 'cli'].includes(renderer)) {
        console.log(`❌ Invalid renderer: ${renderer}`);
        return false;
      }

      if (theme && !['default', 'forest', 'dark', 'neutral'].includes(theme)) {
        console.log(`❌ Invalid theme: ${theme}`);
        return false;
      }
    }

    console.log('✅ Configuration is valid!');
    return true;

  } catch (error: any) {
    console.error('❌ Validation failed:', error.message);
    return false;
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const configPath = args[1] || path.join(process.cwd(), 'archguard.config.json');

  switch (command) {
    case 'migrate':
    case undefined:
      await migrateConfig(configPath);
      break;

    case 'rollback':
      await rollbackMigration(configPath);
      break;

    case 'validate':
      const isValid = await validateConfig(configPath);
      process.exit(isValid ? 0 : 1);
      break;

    case '--help':
    case '-h':
      console.log(`
ArchGuard Migration Tool v2.0

Usage:
  node scripts/migrate-to-mermaid.js [command] [config-path]

Commands:
  migrate    Migrate config to Mermaid format (default)
  rollback   Rollback to previous configuration using backup
  validate   Validate migrated configuration

Examples:
  # Migrate default config
  node scripts/migrate-to-mermaid.js migrate

  # Migrate specific config
  node scripts/migrate-to-mermaid.js migrate ./my-config.json

  # Rollback migration
  node scripts/migrate-to-mermaid.js rollback

  # Validate configuration
  node scripts/migrate-to-mermaid.js validate

Config Path:
  Default: archguard.config.json in current directory
  Custom: Specify absolute or relative path

For more information, see: docs/MIGRATION-v2.0.md
      `);
      break;

    default:
      console.log(`❌ Unknown command: ${command}`);
      console.log('💡 Run with --help for usage information');
      process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
