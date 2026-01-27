#!/usr/bin/env node

import fs from 'fs-extra';
import * as path from 'path';
import { getTestCases } from './shared/test-data.js';
import { runPlanATests, generatePlanAReport } from './plan-a/tester.js';
import { runPlanBTests, generatePlanBReport } from './plan-b/tester.js';

interface ExperimentConfig {
  plan?: 'A' | 'B' | 'both';
  outputDir?: string;
}

async function main() {
  const args = process.argv.slice(2);
  const config: ExperimentConfig = {
    plan: args[0] === 'plan-a' ? 'A' : args[0] === 'plan-b' ? 'B' : 'both',
    outputDir: path.join(process.cwd(), 'results')
  };

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     ELK Layout Engine Experiment - ArchGuard              ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Objective: Test ELK layout engine for aspect ratio control');
  console.log('Target: Aspect ratio between 0.5:1 and 2:1');
  console.log('');

  // Get test cases
  console.log('Loading test cases...');
  const testCases = await getTestCases();
  console.log(`Found ${testCases.length} test cases:`);
  testCases.forEach(tc => {
    console.log(`  - ${tc.name}: ${tc.complexity} (${tc.description})`);
  });

  // Check if we need to create test data directory link
  const testDataDir = path.join(process.cwd(), 'test-data');
  const testDataExists = await fs.pathExists(testDataDir);
  if (!testDataExists) {
    const parentDir = path.join(process.cwd(), '..');
    const archguardDir = path.join(parentDir, 'archguard-self-analysis');
    const archguardExists = await fs.pathExists(archguardDir);

    if (archguardExists) {
      console.log('\nCreating symlink to test data...');
      try {
        await fs.symlink(archguardDir, testDataDir);
        console.log(`Linked: ${testDataDir} -> ${archguardDir}`);
      } catch (error) {
        console.warn('Could not create symlink, using absolute paths');
      }
    }
  }

  const results: Array<{ plan: 'A' | 'B'; data: any }> = [];

  // Run Plan A tests
  if (config.plan === 'A' || config.plan === 'both') {
    const planAOutputDir = path.join(config.outputDir || './results', 'plan-a');
    await fs.ensureDir(planAOutputDir);

    const planAResults = await runPlanATests(testCases, planAOutputDir);
    results.push({ plan: 'A', data: planAResults });

    await generatePlanAReport(planAResults, planAOutputDir);
  }

  // Run Plan B tests
  if (config.plan === 'B' || config.plan === 'both') {
    const planBOutputDir = path.join(config.outputDir || './results', 'plan-b');
    await fs.ensureDir(planBOutputDir);

    const planBResults = await runPlanBTests(testCases, planBOutputDir);
    results.push({ plan: 'B', data: planBResults });

    await generatePlanBReport(planBResults, planBOutputDir);
  }

  // Generate comparison report
  if (results.length === 2) {
    await generateComparisonReport(results, config.outputDir || './results');
  }

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    Experiment Complete                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Results saved to:');
  console.log(`  - ${config.outputDir || './results'}/`);
  console.log(`  - ${path.join(config.outputDir || './results', '../reports')}/`);
}

async function generateComparisonReport(
  results: Array<{ plan: 'A' | 'B'; data: any }>,
  outputDir: string
): Promise<void> {
  const planA = results.find(r => r.plan === 'A')?.data;
  const planB = results.find(r => r.plan === 'B')?.data;

  if (!planA || !planB) return;

  const reportPath = path.join(outputDir, '../reports/comparison.md');

  const planAAcceptableRate = (planA.acceptableAspectRatio / planA.totalTests * 100).toFixed(1);
  const planBAcceptableRate = (planB.acceptableAspectRatio / planB.totalTests * 100).toFixed(1);

  const winner = planA.acceptableAspectRatio > planB.acceptableAspectRatio ? 'Plan A' : 'Plan B';

  let content = `# ELK Layout Experiment - Comparison Report

## Executive Summary

**Winner: ${winner}**

| Metric | Plan A (YAML) | Plan B (Direct ELK) |
|--------|---------------|---------------------|
| Total Tests | ${planA.totalTests} | ${planB.totalTests} |
| Successful Renders | ${planA.successfulTests} | ${planB.successfulTests} |
| Acceptable Aspect Ratio (0.5-2.0) | ${planA.acceptableAspectRatio} (${planAAcceptableRate}%) | ${planB.acceptableAspectRatio} (${planBAcceptableRate}%) |

## Plan A: YAML Frontmatter Configuration

### Method
Add YAML frontmatter to Mermaid code with ELK configuration:
\`\`\`yaml
---
config:
  layout: elk
  elk:
    aspectRatio: 1.5
    direction: DOWN
---
\`\`\`

### Pros
- ✓ Simple implementation
- ✓ Compatible with existing workflow
- ✓ No external dependencies beyond Mermaid
- ✓ Easy to toggle on/off

### Cons
- ✗ Limited control over ELK options
- ✗ Depends on Mermaid's ELK support level
- ✗ May not pass all options through

### Success Rate: ${planAAcceptableRate}%

${planA.acceptableAspectRatio >= planA.totalTests * 0.7
  ? '**Plan A is SUCCESSFUL** and recommended for integration.'
  : '**Plan A needs improvement** - Mermaid may not fully support ELK via YAML.'}

## Plan B: Direct ELK Invocation

### Method
Direct use of \`elkjs\` library for complete layout control:
1. Parse Mermaid → ArchJSON
2. Convert ArchJSON → ELK graph
3. Apply ELK layout options
4. Generate custom SVG

### Pros
- ✓ Full control over all ELK options
- ✓ Direct aspect ratio setting
- ✓ Can implement custom rendering
- ✓ Not limited by Mermaid's support

### Cons
- ✗ More complex implementation
- ✗ Requires additional dependencies
- ✗ Need to maintain conversion pipeline
- ✗ Custom SVG generation needed

### Success Rate: ${planBAcceptableRate}%

${planB.acceptableAspectRatio >= planB.totalTests * 0.7
  ? '**Plan B is SUCCESSFUL** and provides complete ELK control.'
  : '**Plan B needs refinement** - Aspect ratio control may not work as expected.'}

## Detailed Comparison

### Implementation Complexity
| Aspect | Plan A | Plan B |
|--------|--------|--------|
| Lines of Code | ~100 | ~400 |
| Dependencies | isomorphic-mermaid | elkjs, @mermaid-js/layout-elk |
| Development Time | 2-3h | 4-6h |
| Maintenance | Low | Medium |

### Aspect Ratio Control
| Aspect | Plan A | Plan B |
|--------|--------|--------|
| Precision | Limited | High |
| Reliability | Unknown | Proven |
| Flexibility | Low | High |

### Integration Effort
| Aspect | Plan A | Plan B |
|--------|--------|--------|
| Code Changes | Minimal | Moderate |
| Breaking Changes | None | None |
| Testing Required | Low | Medium |

## Recommendations

### For Immediate Integration
${planA.acceptableAspectRatio >= planB.acceptableAspectRatio
  ? `**Use Plan A** - It achieved better results (${planAAcceptableRate}% vs ${planBAcceptableRate}%)

1. Add YAML frontmatter generation in \`src/mermaid/generator.ts\`
2. Add config option: \`mermaid.elk.enable\`
3. Test with real-world projects
4. Monitor aspect ratios in production

**Implementation:**
\`\`\`typescript
// src/mermaid/generator.ts
function generateWithELK(mermaidCode: string, elkConfig: ELKConfig): string {
  const yaml = \`---\\nconfig:\\n  layout: elk\\n  elk: \${JSON.stringify(elkConfig)}\\n---\\n\\n\${mermaidCode}\`;
  return yaml;
}
\`\`\``
  : `**Use Plan B** - It achieved better results (${planBAcceptableRate}% vs ${planAAcceptableRate}%)

1. Create new renderer: \`src/mermaid/elk-renderer.ts\`
2. Add dependencies: \`elkjs\`, \`@mermaid-js/layout-elk\`
3. Implement ArchJSON → ELK → SVG pipeline
4. Add CLI flag: \`--use-elk\`
5. Test with real-world projects

**Implementation:**
\`\`\`typescript
// src/mermaid/elk-renderer.ts
export class ELKRenderer {
  async render(archjson: ArchJSON, options: ELKOptions): Promise<string> {
    const elk = new ELK();
    const graph = archjsonToELK(archjson);
    const layout = await elk.layout(graph, options);
    return generateSVG(layout);
  }
}
\`\`\``
}

### For Future Development
- Consider implementing **both plans** as fallback options
- Add automatic aspect ratio detection and ELK enablement
- Create comprehensive test suite for layout validation
- Monitor user feedback on diagram quality

### Success Criteria
- [ ] Aspect ratio 0.5-2.0 in ≥70% of cases
- [ ] No regression in existing diagram quality
- [ ] Reasonable rendering time (<5s per diagram)
- [ ] Positive user feedback

## Next Steps

1. **Review this report** and choose integration path
2. **Implement chosen plan** in main codebase
3. **Add tests** to prevent regressions
4. **Document** new ELK configuration options
5. **Release** with feature flag for gradual rollout

## Conclusion

${planA.acceptableAspectRatio >= planB.acceptableAspectRatio
  ? `Plan A (YAML frontmatter) is recommended for integration due to its simplicity and better success rate (${planAAcceptableRate}%). If aspect ratio control proves insufficient in production, Plan B can be implemented as a more powerful alternative.`
  : `Plan B (direct ELK) is recommended for integration despite higher complexity, as it provides better aspect ratio control (${planBAcceptableRate}%). The implementation effort is justified by the improved results and future flexibility.`
}

---

**Generated**: ${new Date().toISOString()}
**Experiment**: ELK Layout Engine v1.0
**Target**: ArchGuard Mermaid Aspect Ratio Control
`;

  await fs.ensureDir(path.dirname(reportPath));
  await fs.writeFile(reportPath, content);

  console.log(`\nComparison report saved to: ${reportPath}`);
}

// Run main function
main().catch(console.error);
