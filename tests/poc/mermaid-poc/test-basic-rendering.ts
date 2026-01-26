import mermaid from 'isomorphic-mermaid';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  output?: string;
}

const results: TestResult[] = [];

async function runTest(
  name: string,
  testFn: () => Promise<void>
): Promise<void> {
  const startTime = Date.now();
  try {
    await testFn();
    const duration = Date.now() - startTime;
    results.push({ name, passed: true, duration });
    console.log(`✅ ${name} (${duration}ms)`);
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, duration, error: errorMessage });
    console.log(`❌ ${name} (${duration}ms)`);
    console.log(`   Error: ${errorMessage}`);
  }
}

// Test 1: Basic classDiagram rendering
async function testBasicClassDiagram() {
  const diagram = `
classDiagram
  class TypeScriptParser {
    +parseFiles() ArchJSON
    +parseFile() Entity[]
  }

  class ClaudeCodeWrapper {
    +generateDiagram() string
  }

  ClaudeCodeWrapper --> TypeScriptParser : uses
`;

  const { svg } = await mermaid.render('test-basic-class', diagram);

  if (!svg || svg.length === 0) {
    throw new Error('SVG output is empty');
  }

  if (!svg.includes('<svg')) {
    throw new Error('Output is not valid SVG');
  }

  // Save SVG for inspection
  fs.writeFileSync(path.join(__dirname, 'output-basic-class.svg'), svg);
}

// Test 2: Namespace syntax
async function testNamespaceSyntax() {
  const diagram = `
classDiagram
  direction TB

  namespace ParserLayer {
    class TypeScriptParser {
      +parseFiles() ArchJSON
      +parseFile() Entity[]
    }
  }

  namespace AILayer {
    class ClaudeCodeWrapper {
      +generateDiagram() string
    }
  }

  ClaudeCodeWrapper --> TypeScriptParser : uses
`;

  const { svg } = await mermaid.render('test-namespace', diagram);

  if (!svg || svg.length === 0) {
    throw new Error('SVG output is empty');
  }

  if (!svg.includes('<svg')) {
    throw new Error('Output is not valid SVG');
  }

  // Check if namespace is rendered
  if (!svg.includes('ParserLayer') || !svg.includes('AILayer')) {
    throw new Error('Namespace names not found in SVG');
  }

  fs.writeFileSync(path.join(__dirname, 'output-namespace.svg'), svg);
}

// Test 3: Relationship definitions
async function testRelationshipDefinitions() {
  const diagram = `
classDiagram
  class A {
    +method1() void
  }

  class B {
    +method2() void
  }

  class C {
    +method3() void
  }

  A --> B : dependency
  B *-- C : composition
  C o-- A : aggregation
`;

  const { svg } = await mermaid.render('test-relationships', diagram);

  if (!svg || svg.length === 0) {
    throw new Error('SVG output is empty');
  }

  // Check if different relationship types are rendered
  if (!svg.includes('A') || !svg.includes('B') || !svg.includes('C')) {
    throw new Error('Class names not found in SVG');
  }

  fs.writeFileSync(path.join(__dirname, 'output-relationships.svg'), svg);
}

// Test 4: Generic syntax
async function testGenericSyntax() {
  const diagram = `
classDiagram
  class Parser~T~ {
    +parse(input: string) T
    +validate(data: T) boolean
  }

  class Entity {
    +name: string
    +type: string
  }

  Parser~Entity~ --> Entity : processes
`;

  const { svg } = await mermaid.render('test-generics', diagram);

  if (!svg || svg.length === 0) {
    throw new Error('SVG output is empty');
  }

  fs.writeFileSync(path.join(__dirname, 'output-generics.svg'), svg);
}

// Test 5: Complex ArchGuard-style diagram
async function testComplexArchGuardDiagram() {
  const diagram = `
classDiagram
  direction TB

  namespace Parser {
    class TypeScriptParser {
      +parseFiles(source: string[]) ArchJSON
      +parseFile(filePath: string) Entity
    }

    class Extractor {
      <<interface>>
      +extract(ast: AST) EntityData
    }

    class ClassExtractor {
      +extract(ast: AST) ClassData
    }
  }

  namespace AI {
    class ClaudeCodeWrapper {
      +generateDiagram(archJSON: ArchJSON) string
      +render(svg: string) Buffer
    }

    class PlantUMLGenerator {
      +generate(archJSON: ArchJSON) string
    }
  }

  namespace CLI {
    class AnalyzeCommand {
      +execute(options: Options) void
    }

    class CacheManager {
      +get(key: string) ArchJSON
      +set(key: string, value: ArchJSON) void
    }
  }

  TypeScriptParser ..|> Extractor : implements
  ClassExtractor --|> Extractor : extends
  ClaudeCodeWrapper --> PlantUMLGenerator : uses
  AnalyzeCommand --> TypeScriptParser : uses
  AnalyzeCommand --> ClaudeCodeWrapper : uses
  AnalyzeCommand --> CacheManager : uses
  PlantUMLGenerator --> Parser : imports
`;

  const { svg } = await mermaid.render('test-archguard', diagram);

  if (!svg || svg.length === 0) {
    throw new Error('SVG output is empty');
  }

  // Verify all namespaces are present
  const requiredNamespaces = ['Parser', 'AI', 'CLI'];
  for (const ns of requiredNamespaces) {
    if (!svg.includes(ns)) {
      throw new Error(`Namespace ${ns} not found in SVG`);
    }
  }

  fs.writeFileSync(path.join(__dirname, 'output-archguard.svg'), svg);
}

// Test 6: PNG conversion using sharp
async function testPNGConversion() {
  const diagram = `
classDiagram
  class TestClass {
    +testMethod() void
  }
`;

  const { svg } = await mermaid.render('test-png', diagram);

  // Convert SVG to PNG using sharp
  const svgBuffer = Buffer.from(svg);
  const pngPath = path.join(__dirname, 'output-png.png');

  await sharp(svgBuffer).png().toFile(pngPath);

  // Verify PNG file was created
  if (!fs.existsSync(pngPath)) {
    throw new Error('PNG file was not created');
  }

  const stats = fs.statSync(pngPath);
  if (stats.size === 0) {
    throw new Error('PNG file is empty');
  }
}

// Test 7: Bundle size check
async function testBundleSize() {
  const packageJsonPath = path.join(__dirname, 'node_modules', 'isomorphic-mermaid', 'package.json');
  const distPath = path.join(__dirname, 'node_modules', 'isomorphic-mermaid', 'dist');

  if (!fs.existsSync(distPath)) {
    throw new Error('Distribution directory not found');
  }

  // Calculate total size of the dist directory
  let totalSize = 0;
  const calculateSize = (dir: string) => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        calculateSize(filePath);
      } else {
        totalSize += stats.size;
      }
    }
  };

  calculateSize(distPath);
  const sizeInMB = totalSize / (1024 * 1024);

  console.log(`   Bundle size: ${sizeInMB.toFixed(2)} MB`);

  if (sizeInMB > 50) {
    throw new Error(`Bundle size ${sizeInMB.toFixed(2)} MB exceeds 50 MB limit`);
  }
}

// Main test runner
async function main() {
  console.log('🧪 Running Mermaid POC - Basic Rendering Tests\n');
  console.log('='.repeat(60));

  await runTest('Basic classDiagram rendering', testBasicClassDiagram);
  await runTest('Namespace syntax rendering', testNamespaceSyntax);
  await runTest('Relationship definitions', testRelationshipDefinitions);
  await runTest('Generic syntax', testGenericSyntax);
  await runTest('Complex ArchGuard-style diagram', testComplexArchGuardDiagram);
  await runTest('PNG conversion', testPNGConversion);
  await runTest('Bundle size check', testBundleSize);

  console.log('='.repeat(60));
  console.log('\n📊 Test Results Summary:');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`Total Tests: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total Duration: ${totalDuration}ms`);
  console.log(`Success Rate: ${((passed / results.length) * 100).toFixed(1)}%`);

  if (failed > 0) {
    console.log('\n❌ Failed Tests:');
    results
      .filter(r => !r.passed)
      .forEach(r => {
        console.log(`   - ${r.name}`);
        console.log(`     Error: ${r.error}`);
      });
  }

  // Save results to JSON
  const resultsJson = {
    timestamp: new Date().toISOString(),
    summary: {
      total: results.length,
      passed,
      failed,
      totalDuration,
      successRate: (passed / results.length) * 100
    },
    results
  };

  fs.writeFileSync(
    path.join(__dirname, 'results-basic.json'),
    JSON.stringify(resultsJson, null, 2)
  );

  console.log('\n✅ Results saved to results-basic.json');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
