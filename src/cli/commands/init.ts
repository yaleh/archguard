/**
 * Init Command - Initialize configuration file
 */

import { Command } from 'commander';
import { ConfigLoader } from '../config-loader.js';
import chalk from 'chalk';

/**
 * Create the init command
 */
export function createInitCommand(): Command {
  return new Command('init')
    .description('Initialize archguard configuration file')
    .option('-f, --format <type>', 'Config file format (json|js)', 'json')
    .action(async (options) => {
      try {
        const loader = new ConfigLoader();
        await loader.init({ format: options.format });

        const configFile = `archguard.config.${options.format}`;
        console.log(chalk.green(`✓ Created ${configFile}`));
        console.log(chalk.gray('\nYou can now customize the configuration and run:'));
        console.log(chalk.cyan('  archguard analyze'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('already exists')) {
          console.error(chalk.yellow('⚠ Configuration file already exists'));
          console.log(chalk.gray('Remove it first if you want to reinitialize.'));
          process.exit(0);
        }

        console.error(chalk.red('✗ Failed to initialize config:'), error);
        process.exit(1);
      }
    });
}
