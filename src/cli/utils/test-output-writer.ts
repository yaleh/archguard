import path from 'path';
import fs from 'fs-extra';
import type { TestAnalysis } from '@/types/extensions.js';

export class TestOutputWriter {
  async write(analysis: TestAnalysis, outputDir: string): Promise<void> {
    const testDir = path.join(outputDir, 'test');
    await fs.ensureDir(testDir);
    await this.writeMetrics(analysis, testDir);
    await this.writeIssues(analysis, testDir);
  }

  private async writeMetrics(analysis: TestAnalysis, dir: string): Promise<void> {
    const lines: string[] = [
      '# Test Metrics',
      '',
      `> Pattern config source: ${analysis.patternConfigSource}`,
      '',
      '## Summary',
      '',
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Total test files | ${analysis.metrics.totalTestFiles} |`,
      `| Entity coverage ratio | ${(analysis.metrics.entityCoverageRatio * 100).toFixed(1)}% |`,
      `| Assertion density | ${analysis.metrics.assertionDensity.toFixed(2)} per test |`,
      `| Skip ratio | ${(analysis.metrics.skipRatio * 100).toFixed(1)}% |`,
      '',
      '## Test Files by Type',
      '',
      `| Type | Count |`,
      `|------|-------|`,
      ...Object.entries(analysis.metrics.byType).map(([type, count]) => `| ${type} | ${count} |`),
      '',
      '## Issues by Type',
      '',
      `| Issue | Count |`,
      `|-------|-------|`,
      ...Object.entries(analysis.metrics.issueCount).map(([type, count]) => `| ${type} | ${count} |`),
    ];
    await fs.writeFile(path.join(dir, 'metrics.md'), lines.join('\n') + '\n');
  }

  private async writeIssues(analysis: TestAnalysis, dir: string): Promise<void> {
    const warnings = analysis.issues.filter((i) => i.severity === 'warning');
    const infos = analysis.issues.filter((i) => i.severity === 'info');

    const lines: string[] = ['# Test Issues', ''];

    if (analysis.issues.length === 0) {
      lines.push('No issues detected.');
    } else {
      if (warnings.length > 0) {
        lines.push('## Warnings', '');
        for (const issue of warnings) {
          lines.push(`### ${issue.testFileId}`, '');
          lines.push(`**${issue.type}**: ${issue.message}`);
          if (issue.suggestion) lines.push(`> ${issue.suggestion}`);
          lines.push('');
        }
      }
      if (infos.length > 0) {
        lines.push('## Info', '');
        for (const issue of infos) {
          lines.push(`### ${issue.testFileId}`, '');
          lines.push(`**${issue.type}**: ${issue.message}`);
          if (issue.suggestion) lines.push(`> ${issue.suggestion}`);
          lines.push('');
        }
      }
    }

    await fs.writeFile(path.join(dir, 'issues.md'), lines.join('\n') + '\n');
  }
}
