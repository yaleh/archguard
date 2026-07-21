/**
 * Test pattern advisor: pure analysis logic for framework-to-assertion-pattern mapping.
 * Extracted from the MCP tool layer per ADR-006 ("tools should be thin").
 */

/**
 * Build a suggested TestPatternConfig based on detected framework names.
 * Maps well-known frameworks to their canonical assertion patterns.
 */
export function buildSuggestedPatternConfig(frameworks: string[]): Record<string, string[]> {
  const assertionPatterns: string[] = [];

  for (const fw of frameworks) {
    switch (fw) {
      case 'vitest':
      case 'jest':
      case 'mocha':
      case 'jasmine':
        if (!assertionPatterns.includes('\\bexpect\\s*\\('))
          assertionPatterns.push('\\bexpect\\s*\\(');
        break;
      case 'junit4':
      case 'junit5':
        assertionPatterns.push(
          '\\bAssert\\.assert\\w+\\s*\\(',
          '\\bAssertions\\.assert\\w+\\s*\\(',
          '\\bassertEquals\\s*\\(',
          '\\bassertTrue\\s*\\(',
          '\\bassertFalse\\s*\\(',
          '\\bassertNotNull\\s*\\(',
          '\\bassertThat\\s*\\('
        );
        break;
      case 'testng':
        if (!assertionPatterns.includes('\\bassertEquals\\s*\\('))
          assertionPatterns.push(
            '\\bassertEquals\\s*\\(',
            '\\bassertTrue\\s*\\(',
            '\\bassertNotNull\\s*\\('
          );
        break;
      case 'jmh':
        // JMH benchmarks don't use assertions — no patterns needed
        break;
      case 'assertj':
        if (!assertionPatterns.includes('\\bassertThat\\s*\\('))
          assertionPatterns.push('\\bassertThat\\s*\\(');
        break;
      case 'testify':
        assertionPatterns.push('\\b(?:assert|require)\\.\\w+\\s*\\(');
        break;
      case 'testing': // Go stdlib
        assertionPatterns.push('\\bt\\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\\s*\\(');
        break;
      case 'gtest':
        assertionPatterns.push('\\bEXPECT_\\w+\\s*\\(', '\\bASSERT_\\w+\\s*\\(');
        break;
      case 'catch2':
      case 'doctest':
        assertionPatterns.push('\\bREQUIRE\\s*\\(', '\\bCHECK\\s*\\(');
        break;
      case 'assert': // C++ custom / Node assert
        assertionPatterns.push(
          '\\bassert\\s*\\(',
          '\\bassert_\\w+\\s*\\(', // assert_equal(), assert_true(), assert_equals()
          '\\bt\\.assert_\\w+\\s*\\(', // t.assert_equal(), t.assert_true()
          '\\bGGML_ASSERT\\s*\\('
        );
        break;
      case 'pytest':
        assertionPatterns.push(
          '\\bassert\\b',
          '.assert' // torch.testing.assert_close, np.testing.assert_allclose, self.assertX
        );
        break;
      case 'unittest':
        assertionPatterns.push('\\bself\\.assert\\w+\\s*\\(');
        break;
      case 'playwright':
      case 'cypress':
        if (!assertionPatterns.includes('\\bexpect\\s*\\('))
          assertionPatterns.push('\\bexpect\\s*\\(');
        break;
    }
  }

  if (assertionPatterns.length === 0) return {};
  return { assertionPatterns: [...new Set(assertionPatterns)] };
}
