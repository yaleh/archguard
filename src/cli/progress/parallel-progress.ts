/**
 * Parallel Progress Reporter - Multi-line progress bars for parallel diagram processing
 *
 * Features:
 * - Multiple independent progress bars (one per diagram)
 * - Real-time progress updates with status indicators
 * - Success/failure markers (✓/✗)
 * - Clean terminal UI with colors
 *
 * @module cli/progress/parallel-progress
 * @version 2.1.0
 */

import { MultiBar, Presets, type Bar } from 'cli-progress';
import chalk from 'chalk';

export interface DiagramProgress {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
}

/**
 * ParallelProgressReporter manages multiple progress bars simultaneously
 *
 * Usage:
 * ```typescript
 * const reporter = new ParallelProgressReporter(['diagram1', 'diagram2']);
 *
 * reporter.update('diagram1', 25, 'Parsing');
 * reporter.update('diagram1', 50, 'Generating');
 * reporter.complete('diagram1');
 *
 * reporter.update('diagram2', 50, 'Processing');
 * reporter.fail('diagram2');
 *
 * reporter.stop();
 * ```
 */
export class ParallelProgressReporter {
  private bars: Map<string, Bar> = new Map();
  private multiBar: MultiBar;

  constructor(private diagrams: string[]) {
    this.multiBar = new MultiBar(
      {
        format: `{bar} | {percentage}% | {status}`,
        clearOnComplete: false,
        hideCursor: true,
        barsize: 40,
      },
      Presets.shades_classic
    );

    this.diagrams.forEach((name) => {
      const paddedName = chalk.cyan(name.padEnd(30));
      const bar = this.multiBar.create(100, 0, {
        status: paddedName + ' pending',
      });
      this.bars.set(name, bar);
    });
  }

  /**
   * Update progress for a specific diagram
   *
   * @param name - Diagram name
   * @param progress - Progress percentage (0-100)
   * @param status - Optional status message
   */
  update(name: string, progress: number, status?: string): void {
    const bar = this.bars.get(name);
    if (bar) {
      const paddedName = chalk.cyan(name.padEnd(30));
      const statusText = status ? `${paddedName} | ${status}` : `${paddedName} | running`;
      bar.update(progress, { status: statusText });
    }
  }

  /**
   * Mark diagram as completed
   *
   * @param name - Diagram name
   */
  complete(name: string): void {
    const bar = this.bars.get(name);
    if (bar) {
      const paddedName = chalk.cyan(name.padEnd(30));
      bar.update(100, { status: `${paddedName} | ${chalk.green('✓')}` });
    }
  }

  /**
   * Mark diagram as failed
   *
   * @param name - Diagram name
   */
  fail(name: string): void {
    const bar = this.bars.get(name);
    if (bar) {
      const paddedName = chalk.cyan(name.padEnd(30));
      bar.update(100, { status: `${paddedName} | ${chalk.red('✗')}` });
    }
  }

  /**
   * Stop all progress bars and clean up
   */
  stop(): void {
    this.multiBar.stop();
  }
}
