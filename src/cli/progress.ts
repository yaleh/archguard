/**
 * Progress Reporter - Real-time user feedback with ora and chalk
 */

import ora, { type Ora } from 'ora';
import chalk from 'chalk';

export interface Stage {
  name: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'warning';
  startTime?: number;
  endTime?: number;
  progress?: {
    completed: number;
    total: number;
    percentage: number;
  };
}

export interface ProgressSummary {
  totalDuration: number;
  totalDurationFormatted: string;
  successCount: number;
  failureCount: number;
  warningCount: number;
}

/**
 * ProgressReporter provides real-time feedback for long-running operations
 * Features:
 * - Spinner animation with ora
 * - Colored output with chalk
 * - Multi-stage progress tracking
 * - Progress percentage display
 * - Elapsed time tracking
 */
export class ProgressReporter {
  private spinner: Ora;
  private stages: Stage[] = [];
  private currentStage: Stage | null = null;

  constructor() {
    this.spinner = ora();
  }

  /**
   * Start a new progress stage
   */
  start(message: string): void {
    const stage: Stage = {
      name: message,
      status: 'running',
      startTime: Date.now(),
    };

    this.stages.push(stage);
    this.currentStage = stage;
    this.spinner.start(chalk.cyan(message));
  }

  /**
   * Update progress for the current stage
   */
  update(completed: number, total: number): void {
    if (!this.currentStage) return;

    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    this.currentStage.progress = {
      completed,
      total,
      percentage,
    };

    const message = `${this.currentStage.name} ${chalk.gray(`(${completed}/${total} - ${percentage}%)`)}`;
    this.spinner.text = message;
  }

  /**
   * Mark current stage as successful
   */
  succeed(message: string): void {
    if (this.currentStage) {
      this.currentStage.status = 'success';
      this.currentStage.endTime = Date.now();
    }
    this.spinner.succeed(chalk.green(message));
    this.currentStage = null;
  }

  /**
   * Mark current stage as failed
   */
  fail(message: string): void {
    if (this.currentStage) {
      this.currentStage.status = 'failed';
      this.currentStage.endTime = Date.now();
    }
    this.spinner.fail(chalk.red(message));
    this.currentStage = null;
  }

  /**
   * Mark current stage as warning
   */
  warn(message: string): void {
    if (this.currentStage) {
      this.currentStage.status = 'warning';
      this.currentStage.endTime = Date.now();
    }
    this.spinner.warn(chalk.yellow(message));
    this.currentStage = null;
  }

  /**
   * Display info message (doesn't create a stage)
   */
  info(message: string): void {
    this.spinner.info(chalk.blue(message));
  }

  /**
   * Get all stages
   */
  getStages(): Stage[] {
    return [...this.stages];
  }

  /**
   * Get current running stage
   */
  getCurrentStage(): Stage | null {
    return this.currentStage;
  }

  /**
   * Get summary of all stages
   */
  getSummary(): ProgressSummary {
    let totalDuration = 0;
    let successCount = 0;
    let failureCount = 0;
    let warningCount = 0;

    for (const stage of this.stages) {
      if (stage.startTime && stage.endTime) {
        totalDuration += stage.endTime - stage.startTime;
      }

      if (stage.status === 'success') successCount++;
      else if (stage.status === 'failed') failureCount++;
      else if (stage.status === 'warning') warningCount++;
    }

    return {
      totalDuration,
      totalDurationFormatted: `${(totalDuration / 1000).toFixed(2)}s`,
      successCount,
      failureCount,
      warningCount,
    };
  }

  /**
   * Print summary of all stages
   */
  printSummary(): void {
    const summary = this.getSummary();

    console.log('\n' + chalk.bold('Summary:'));
    for (const stage of this.stages) {
      let icon: string;
      let color: (text: string) => string;

      switch (stage.status) {
        case 'success':
          icon = '✓';
          color = chalk.green;
          break;
        case 'failed':
          icon = '✗';
          color = chalk.red;
          break;
        case 'warning':
          icon = '⚠';
          color = chalk.yellow;
          break;
        default:
          icon = '○';
          color = chalk.gray;
      }

      const duration =
        stage.endTime && stage.startTime
          ? `${((stage.endTime - stage.startTime) / 1000).toFixed(2)}s`
          : 'N/A';

      console.log(color(`  ${icon} ${stage.name} (${duration})`));
    }

    console.log(chalk.bold(`\nTotal: ${summary.totalDurationFormatted}`));
    console.log(
      chalk.green(`✓ ${summary.successCount} succeeded`) +
        ' | ' +
        chalk.red(`✗ ${summary.failureCount} failed`) +
        (summary.warningCount > 0 ? ' | ' + chalk.yellow(`⚠ ${summary.warningCount} warnings`) : '')
    );
  }

  /**
   * Stop spinner (cleanup)
   */
  stop(): void {
    this.spinner.stop();
  }
}
