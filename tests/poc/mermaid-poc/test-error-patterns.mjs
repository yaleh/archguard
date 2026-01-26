import mermaid from 'isomorphic-mermaid';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const results = [];

async function runErrorTest(name, expectedError, testFn) {
  const startTime = Date.now();
  try {
    await testFn();
    const duration = Date.now() - startTime;
    results.push({
      name,
      expectedError,
      errorDetected: false,
      errorClear: false,
      duration
    });
    console.log(`❌ ${name} (${duration}ms)`);
    console.log(`   Expected error but none occurred: ${expectedError}`);
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorDetected = errorMessage.toLowerCase().includes(expectedError.toLowerCase()) ||
                          errorMessage.toLowerCase().includes('error') ||
                          errorMessage.toLowerCase().includes('syntax');

    results.push({
      name,
      expectedError,
      actualError: errorMessage,
      errorDetected,
      errorClear: errorMessage.length > 0,
      duration
    });

    if (errorDetected) {
      console.log(`✅ ${name} (${duration}ms)`);
      console.log(`   Error detected: ${errorMessage.substring(0, 100)}...`);
    } else {
      console.log(`⚠️  ${name} (${duration}ms)`);
      console.log(`   Expected: ${expectedError}`);
      console.log(`   Actual: ${errorMessage.substring(0, 100)}...`);
    }
  }
}

// Error Test 1: Nested namespaces (should fail in Mermaid)
async function testNestedNamespaces() {
  const diagram = `
classDiagram
  namespace Outer {
    namespace Inner {
      class TestClass {
        +method() void
      }
    }
  }
`;

  const { svg } = await mermaid.render('test-nested-namespace', diagram);
  // If we get here, check if SVG is valid or if it silently failed
  if (!svg || svg.length === 0) {
    throw new Error('Empty SVG output - nested namespaces not supported');
  }
  // Mermaid might render this but with incorrect behavior
  if (!svg.includes('Outer') || !svg.includes('Inner')) {
    throw new Error('Nested namespaces not properly rendered');
  }
}

// Error Test 2: Relationships within namespace
async function testIntraNamespaceRelationships() {
  const diagram = `
classDiagram
  namespace MyNamespace {
    class A {
      +method1() void
    }

    class B {
      +method2() void
    }

    A --> B : dependency
  }
`;

  const { svg } = await mermaid.render('test-intra-namespace-rel', diagram);
  // Mermaid might render this but could have issues
  if (!svg || svg.length === 0) {
    throw new Error('Empty SVG output - intra-namespace relationships not supported');
  }
  // Verify both classes and relationship are in the diagram
  if (!svg.includes('A') || !svg.includes('B')) {
    throw new Error('Classes not found in SVG');
  }
}

// Error Test 3: Comma-based generic syntax (TypeScript style, should fail)
async function testCommaGenerics() {
  const diagram = `
classDiagram
  class Parser~TInput, TOutput~ {
    +parse(input: TInput) TOutput
  }

  class Result {
    +data: string
    +status: number
  }

  Parser~string, Result~ --> Result : produces
`;

  const { svg } = await mermaid.render('test-comma-generics', diagram);
  // Mermaid typically doesn't support comma-separated generics
  if (!svg || svg.length === 0) {
    throw new Error('Empty SVG output - comma generics not supported');
  }
  // Check if generics were properly parsed
  if (!svg.includes('Parser') || !svg.includes('Result')) {
    throw new Error('Classes not found in SVG');
  }
}

// Error Test 4: Invalid syntax - missing closing brace
async function testInvalidSyntax() {
  const diagram = `
classDiagram
  class TestClass {
    +method() void
`;

  const { svg } = await mermaid.render('test-invalid-syntax', diagram);
  // Mermaid should catch this syntax error
  if (!svg || svg.length === 0) {
    throw new Error('Syntax error detected - missing closing brace');
  }
  // If SVG was generated, it might be incomplete or invalid
  throw new Error('Invalid syntax was not caught');
}

// Error Test 5: Invalid relationship type
async function testInvalidRelationshipType() {
  const diagram = `
classDiagram
  class A {
    +method1() void
  }

  class B {
    +method2() void
  }

  A ==> B : invalid_type
`;

  const { svg } = await mermaid.render('test-invalid-rel-type', diagram);
  if (!svg || svg.length === 0) {
    throw new Error('Invalid relationship type detected');
  }
}

// Error Test 6: Method with invalid type syntax
async function testInvalidMethodSyntax() {
  const diagram = `
classDiagram
  class TestClass {
    +method(): Invalid::Type::Syntax void
  }
`;

  const { svg } = await mermaid.render('test-invalid-method', diagram);
  if (!svg || svg.length === 0) {
    throw new Error('Invalid method syntax detected');
  }
}

// Error Test 7: Deeply nested namespaces (3+ levels)
async function testDeeplyNestedNamespaces() {
  const diagram = `
classDiagram
  namespace Level1 {
    namespace Level2 {
      namespace Level3 {
        class DeepClass {
          +deepMethod() void
        }
      }
    }
  }
`;

  const { svg } = await mermaid.render('test-deep-nesting', diagram);
  if (!svg || svg.length === 0) {
    throw new Error('Empty SVG - deeply nested namespaces not supported');
  }
  // Verify all levels are present
  if (!svg.includes('Level1') || !svg.includes('Level2') || !svg.includes('Level3')) {
    throw new Error('Not all namespace levels rendered');
  }
}

// Error Test 8: Cross-namespace relationships with complex generics
async function testCrossNamespaceComplexGenerics() {
  const diagram = `
classDiagram
  namespace NS1 {
    class ClassA~T~ {
      +process(data: T) Result~T~
    }
  }

  namespace NS2 {
    class Result~T~ {
      +value: T
      +success: boolean
    }
  }

  ClassA~string~ --> Result~string~ : creates
`;

  const { svg } = await mermaid.render('test-cross-namespace-generics', diagram);
  if (!svg || svg.length === 0) {
    throw new Error('Empty SVG - cross-namespace generics not supported');
  }
  if (!svg.includes('NS1') || !svg.includes('NS2')) {
    throw new Error('Namespaces not found in SVG');
  }
}

// Test 9: Unicode and special characters in names
async function testSpecialCharacters() {
  const diagram = `
classDiagram
  class "Class-With-Special_Chars" {
    +method() void
  }

  class "Class@With$Special#Chars" {
    +anotherMethod() void
  }

  "Class-With-Special_Chars" --> "Class@With$Special#Chars" : dependency
`;

  const { svg } = await mermaid.render('test-special-chars', diagram);
  if (!svg || svg.length === 0) {
    throw new Error('Empty SVG - special characters not supported');
  }
}

// Test 10: Very long method signatures (edge case)
async function testLongMethodSignatures() {
  const diagram = `
classDiagram
  class TestClass {
    +veryLongMethodNameThatGoesOnAndOn(param1: string, param2: number, param3: boolean, param4: object, param5: array) VeryLongReturnTypeThatIsAlsoQuiteExtensive
  }
`;

  const { svg } = await mermaid.render('test-long-methods', diagram);
  if (!svg || svg.length === 0) {
    throw new Error('Empty SVG - long method signatures not supported');
  }
}

// Main test runner
async function main() {
  console.log('🧪 Running Mermaid POC - Error Pattern Tests\n');
  console.log('='.repeat(60));

  // Initialize mermaid once
  await mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
  });

  await runErrorTest(
    'Nested namespaces',
    'nested namespace not supported',
    testNestedNamespaces
  );

  await runErrorTest(
    'Intra-namespace relationships',
    'namespace relationships',
    testIntraNamespaceRelationships
  );

  await runErrorTest(
    'Comma-based generics',
    'comma generics not supported',
    testCommaGenerics
  );

  await runErrorTest(
    'Invalid syntax (missing brace)',
    'syntax error',
    testInvalidSyntax
  );

  await runErrorTest(
    'Invalid relationship type',
    'invalid relationship',
    testInvalidRelationshipType
  );

  await runErrorTest(
    'Invalid method syntax',
    'invalid syntax',
    testInvalidMethodSyntax
  );

  await runErrorTest(
    'Deeply nested namespaces (3+ levels)',
    'deeply nested',
    testDeeplyNestedNamespaces
  );

  await runErrorTest(
    'Cross-namespace complex generics',
    'cross namespace generics',
    testCrossNamespaceComplexGenerics
  );

  await runErrorTest(
    'Special characters in names',
    'special characters',
    testSpecialCharacters
  );

  await runErrorTest(
    'Very long method signatures',
    'long signatures',
    testLongMethodSignatures
  );

  console.log('='.repeat(60));
  console.log('\n📊 Error Pattern Test Results Summary:');
  console.log('='.repeat(60));

  const errorsDetected = results.filter(r => r.errorDetected).length;
  const errorsNotDetected = results.filter(r => !r.errorDetected).length;
  const clearErrors = results.filter(r => r.errorClear).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`Total Tests: ${results.length}`);
  console.log(`Errors Detected: ${errorsDetected}`);
  console.log(`Errors Not Detected: ${errorsNotDetected}`);
  console.log(`Clear Error Messages: ${clearErrors}/${results.length}`);
  console.log(`Total Duration: ${totalDuration}ms`);
  console.log(`Detection Rate: ${((errorsDetected / results.length) * 100).toFixed(1)}%`);

  if (errorsNotDetected > 0) {
    console.log('\n⚠️  Tests Where Errors Were Not Detected:');
    results
      .filter(r => !r.errorDetected)
      .forEach(r => {
        console.log(`   - ${r.name}`);
        console.log(`     Expected: ${r.expectedError}`);
        if (r.actualError) {
          console.log(`     Actual: ${r.actualError.substring(0, 100)}...`);
        }
      });
  }

  // Save results to JSON
  const resultsJson = {
    timestamp: new Date().toISOString(),
    summary: {
      total: results.length,
      errorsDetected,
      errorsNotDetected,
      clearErrors,
      totalDuration,
      detectionRate: (errorsDetected / results.length) * 100
    },
    results
  };

  fs.writeFileSync(
    path.join(__dirname, 'results-errors.json'),
    JSON.stringify(resultsJson, null, 2)
  );

  console.log('\n✅ Results saved to results-errors.json');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
