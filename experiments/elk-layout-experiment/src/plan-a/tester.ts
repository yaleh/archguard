import * as path from 'path';
import fs from 'fs-extra';
import { testELKConfigurations } from './renderer.js';
import { readMermaidFile, TestCase } from '../shared/test-data.js';
import {
  parseSvgMetrics,
  parsePngMetrics,
  isAspectRatioAcceptable,
  saveTestResult,
  TestResult
} from '../shared/metrics.js';

export interface PlanAResults {
  plan: 'A';
  totalTests: number;
  successfulTests: number;
  acceptableAspectRatio: number;
  results: TestResult[];
}

/**
 * Run Plan A tests
 */
export async function runPlanATests(
  testCases: TestCase[],
  outputDir: string
): Promise<PlanAResults> {
  console.log('\n=== Running Plan A Tests (YAML Frontmatter) ===\n');

  const allResults: TestResult[] = [];
  let successfulTests = 0;
  let acceptableAspectRatio = 0;

  for (const testCase of testCases) {
    console.log(`Testing: ${testCase.name} (${testCase.complexity})`);
    console.log(`  ${testCase.description}`);

    try {
      // Read Mermaid file
      const mermaidCode = await readMermaidFile(testCase.mermaidPath);

      // Test different ELK configurations
      const renderResults = await testELKConfigurations(
        mermaidCode,
        `${testCase.name}-plan-a`,
        { outputDir }
      );

      for (const renderResult of renderResults) {
        if (!renderResult.success) {
          console.log(`  ✗ ${renderResult.svgPath}: ${renderResult.error}`);
          continue;
        }

        // Calculate metrics
        const svgMetrics = await parseSvgMetrics(renderResult.svgPath);
        const pngMetrics = await parsePngMetrics(renderResult.pngPath);

        const testResult: TestResult = {
          filename: testCase.name,
          plan: 'A',
          svgSize: svgMetrics,
          pngSize: pngMetrics,
          aspectRatioRatio: svgMetrics.aspectRatio,
          renderTime: renderResult.renderTime,
          success: true
        };

        allResults.push(testResult);

        const acceptable = isAspectRatioAcceptable(svgMetrics.aspectRatio);
        if (acceptable) acceptableAspectRatio++;

        successfulTests++;

        console.log(
          `  ✓ ${renderResult.svgPath}: ${svgMetrics.width}×${svgMetrics.height}px ` +
          `(ratio: ${svgMetrics.aspectRatio.toFixed(2)}:1) ${acceptable ? '✓' : '✗'}`
        );
      }
    } catch (error) {
      console.error(`  ✗ Error: ${error}`);
    }
  }

  // Save results
  for (const result of allResults) {
    await saveTestResult(result, outputDir);
  }

  return {
    plan: 'A',
    totalTests: allResults.length,
    successfulTests,
    acceptableAspectRatio,
    results: allResults
  };
}

/**
 * Generate Plan A report
 */
export async function generatePlanAReport(results: PlanAResults, outputDir: string): Promise<void> {
  const reportPath = path.join(outputDir, '../reports/plan-a-report.md');

  const acceptableRateNum = results.acceptableAspectRatio / results.totalTests * 100;
  const acceptableRate = acceptableRateNum.toFixed(1);
  const successRate = (results.successfulTests / results.totalTests * 100).toFixed(1);

  let content = `# Plan A Report: YAML Frontmatter Configuration

## Test Summary

- **Total Tests**: ${results.totalTests}
- **Successful Renders**: ${results.successfulTests} (${successRate}%)
- **Acceptable Aspect Ratio (0.5-2.0)**: ${results.acceptableAspectRatio} (${acceptableRate}%)

## Method

YAML frontmatter was added to Mermaid code:
\`\`\`yaml
---
config:
  layout: elk
  elk:
    aspectRatio: 1.5
    direction: DOWN
---
\`\`\`

## Results

`;

  results.results.forEach((result, index) => {
    const acceptable = isAspectRatioAcceptable(result.aspectRatioRatio);
    content += `### Test ${index + 1}: ${result.filename}

- **SVG Size**: ${result.svgSize.width}×${result.svgSize.height}px
- **Aspect Ratio**: ${result.aspectRatioRatio.toFixed(2)}:1 ${acceptable ? '✓' : '✗'}
- **PNG Size**: ${result.pngSize.width}×${result.pngSize.height}px
- **Render Time**: ${result.renderTime}ms

`;
  });

  content += `
## Conclusions

${acceptableRateNum >= 70 ? '✓ Plan A SUCCESSFUL' : '✗ Plan A FAILED'}: ${acceptableRate}% of tests achieved acceptable aspect ratio.

### Recommendations

${acceptableRateNum >= 70
  ? '- Plan A is viable for integration\n- Implement YAML frontmatter generation in `src/mermaid/generator.ts`\n- Simple and compatible with existing workflow'
  : '- Plan A is not sufficient\n- Mermaid may not fully support ELK options via YAML\n- Consider Plan B for direct ELK control'
}

## Next Steps

${acceptableRateNum >= 70
  ? '- Integrate YAML frontmatter into main codebase\n- Add configuration options for ELK settings'
  : '- Proceed with Plan B implementation\n- Focus on direct ELK library usage'
}
`;

  await fs.ensureDir(path.dirname(reportPath));
  await fs.writeFile(reportPath, content);

  console.log(`\nPlan A report saved to: ${reportPath}`);
}
