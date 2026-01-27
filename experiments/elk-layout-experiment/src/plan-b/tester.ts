import * as path from 'path';
import fs from 'fs-extra';
import { parseMermaidClassDiagram, archjsonToELK, calculateOptimalAspectRatio } from './archjson-elk.js';
import { layoutGraph, testLayoutConfigurations, findBestLayout } from './elk-adapter.js';
import { generateSVGFromELK } from './svg-generator.js';
import { readMermaidFile, TestCase } from '../shared/test-data.js';
import {
  parseSvgMetrics,
  parsePngMetrics,
  isAspectRatioAcceptable,
  saveTestResult,
  TestResult
} from '../shared/metrics.js';

export interface PlanBResults {
  plan: 'B';
  totalTests: number;
  successfulTests: number;
  acceptableAspectRatio: number;
  results: TestResult[];
}

/**
 * Run Plan B tests
 */
export async function runPlanBTests(
  testCases: TestCase[],
  outputDir: string
): Promise<PlanBResults> {
  console.log('\n=== Running Plan B Tests (Direct ELK) ===\n');

  const allResults: TestResult[] = [];
  let successfulTests = 0;
  let acceptableAspectRatio = 0;

  for (const testCase of testCases) {
    console.log(`Testing: ${testCase.name} (${testCase.complexity})`);
    console.log(`  ${testCase.description}`);

    try {
      // Read Mermaid file
      const mermaidCode = await readMermaidFile(testCase.mermaidPath);

      // Parse to ArchJSON
      const archjson = parseMermaidClassDiagram(mermaidCode);
      console.log(`  Parsed ${archjson.entities.length} entities, ${archjson.relations.length} relations`);

      // Convert to ELK graph
      const elkGraph = archjsonToELK(archjson);

      // Calculate optimal aspect ratio
      const optimalRatio = calculateOptimalAspectRatio(archjson.entities.length);
      console.log(`  Target aspect ratio: ${optimalRatio.toFixed(2)}`);

      // Test different configurations
      const testResults = await testLayoutConfigurations(elkGraph, [optimalRatio], ['DOWN', 'RIGHT']);

      for (const test of testResults) {
        if (!test.result.success) {
          console.log(`  ✗ Config failed: ${test.result.error}`);
          continue;
        }

        const actualRatio = test.result.width / test.result.height;
        console.log(`  Config: aspectRatio=${test.config['elk.aspectRatio']}, direction=${test.config['elk.direction']}`);
        console.log(`    Actual: ${test.result.width}×${test.result.height}px (ratio: ${actualRatio.toFixed(2)}:1)`);

        // Generate SVG
        const svgResult = await generateSVGFromELK(test.result.layout, {
          outputDir,
          filename: `${testCase.name}-plan-b-${test.config['elk.aspectRatio']}-${test.config['elk.direction']}`,
          theme: 'light'
        });

        if (!svgResult.success) {
          console.log(`  ✗ SVG generation failed: ${svgResult.error}`);
          continue;
        }

        // Calculate metrics
        const svgMetrics = await parseSvgMetrics(svgResult.svgPath);
        const pngMetrics = await parsePngMetrics(svgResult.pngPath);

        const testResult: TestResult = {
          filename: testCase.name,
          plan: 'B',
          svgSize: svgMetrics,
          pngSize: pngMetrics,
          aspectRatioRatio: svgMetrics.aspectRatio,
          renderTime: 0, // Not tracking for Plan B
          success: true
        };

        allResults.push(testResult);

        const acceptable = isAspectRatioAcceptable(svgMetrics.aspectRatio);
        if (acceptable) acceptableAspectRatio++;

        successfulTests++;

        console.log(
          `  ✓ ${svgResult.svgPath}: ${svgMetrics.width}×${svgMetrics.height}px ` +
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
    plan: 'B',
    totalTests: allResults.length,
    successfulTests,
    acceptableAspectRatio,
    results: allResults
  };
}

/**
 * Generate Plan B report
 */
export async function generatePlanBReport(results: PlanBResults, outputDir: string): Promise<void> {
  const reportPath = path.join(outputDir, '../reports/plan-b-report.md');

  const acceptableRateNum = results.acceptableAspectRatio / results.totalTests * 100;
  const acceptableRate = acceptableRateNum.toFixed(1);
  const successRate = (results.successfulTests / results.totalTests * 100).toFixed(1);

  let content = `# Plan B Report: Direct ELK Invocation

## Test Summary

- **Total Tests**: ${results.totalTests}
- **Successful Renders**: ${results.successfulTests} (${successRate}%)
- **Acceptable Aspect Ratio (0.5-2.0)**: ${results.acceptableAspectRatio} (${acceptableRate}%)

## Method

Direct use of \`@mermaid-js/layout-elk\` and \`elkjs\` libraries:
1. Parse Mermaid diagram to ArchJSON
2. Convert ArchJSON to ELK graph format
3. Apply layout options (aspectRatio, direction)
4. Generate SVG from laid-out graph

### Key Configuration
\`\`\`typescript
const layoutOptions = {
  'elk.aspectRatio': '1.5',
  'elk.direction': 'DOWN',
  'elk.algorithm': 'layered'
};
\`\`\`

## Results

`;

  results.results.forEach((result, index) => {
    const acceptable = isAspectRatioAcceptable(result.aspectRatioRatio);
    content += `### Test ${index + 1}: ${result.filename}

- **SVG Size**: ${result.svgSize.width}×${result.svgSize.height}px
- **Aspect Ratio**: ${result.aspectRatioRatio.toFixed(2)}:1 ${acceptable ? '✓' : '✗'}
- **PNG Size**: ${result.pngSize.width}×${result.pngSize.height}px

`;
  });

  content += `
## Conclusions

${acceptableRateNum >= 70 ? '✓ Plan B SUCCESSFUL' : '✗ Plan B FAILED'}: ${acceptableRate}% of tests achieved acceptable aspect ratio.

### Advantages
- Direct control over ELK layout options
- Can set exact aspect ratio constraints
- Full control over node placement and routing
- No dependency on Mermaid's ELK support

### Disadvantages
- Requires additional development effort
- Need to maintain Mermaid → ArchJSON → ELK conversion
- SVG generation needs custom implementation

### Recommendations

${acceptableRateNum >= 70
  ? '**Plan B is VIABLE for integration**:\n' +
    '- Create new renderer: `src/mermaid/elk-renderer.ts`\n' +
    '- Add configuration option: `--layout elk` or `--use-elk`\n' +
    '- Implement ArchJSON → ELK → SVG pipeline\n' +
    '- Consider making ELK the default renderer for complex diagrams'
  : '**Plan B needs improvement**:\n' +
    '- Aspect ratio control may not be working as expected\n' +
    '- Consider alternative ELK options or algorithms\n' +
    '- May need to adjust node size estimation'
}

## Integration Path

If Plan B is successful:
1. Install dependencies: \`npm install elkjs @mermaid-js/layout-elk\`
2. Create \`src/mermaid/elk-renderer.ts\` with ELK pipeline
3. Add CLI flag: \`--layout elk\` or \`--use-elk\`
4. Update \`src/mermaid/generator.ts\` to support ELK renderer
5. Add tests for ELK rendering in \`tests/integration/\`

## Next Steps

${acceptableRateNum >= 70
  ? '- Implement ELK renderer in main codebase\n- Add configuration options for aspect ratio control\n- Test with real-world projects'
  : '- Debug aspect ratio control\n- Try different ELK algorithms\n- Experiment with node sizing'
}
`;

  await fs.ensureDir(path.dirname(reportPath));
  await fs.writeFile(reportPath, content);

  console.log(`\nPlan B report saved to: ${reportPath}`);
}
