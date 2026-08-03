/**
 * Unit tests for buildSuggestedPatternConfig (test-pattern-advisor).
 */

import { describe, it, expect } from 'vitest';
import { buildSuggestedPatternConfig } from '@/analysis/test-pattern-advisor.js';

describe('buildSuggestedPatternConfig', () => {
  it('returns an empty object for no frameworks', () => {
    expect(buildSuggestedPatternConfig([])).toEqual({});
  });

  it('maps vitest/jest/mocha/jasmine to the expect pattern', () => {
    for (const fw of ['vitest', 'jest', 'mocha', 'jasmine']) {
      const result = buildSuggestedPatternConfig([fw]);
      expect(result.assertionPatterns).toEqual(['\\bexpect\\s*\\(']);
    }
  });

  it('maps junit4/junit5 to the full JUnit assertion set', () => {
    for (const fw of ['junit4', 'junit5']) {
      const result = buildSuggestedPatternConfig([fw]);
      expect(result.assertionPatterns).toContain('\\bAssert\\.assert\\w+\\s*\\(');
      expect(result.assertionPatterns).toContain('\\bassertEquals\\s*\\(');
      expect(result.assertionPatterns).toContain('\\bassertThat\\s*\\(');
      expect(result.assertionPatterns).toHaveLength(7);
    }
  });

  it('maps testng to the concise assertion set', () => {
    const result = buildSuggestedPatternConfig(['testng']);
    expect(result.assertionPatterns).toEqual([
      '\\bassertEquals\\s*\\(',
      '\\bassertTrue\\s*\\(',
      '\\bassertNotNull\\s*\\(',
    ]);
  });

  it('maps jmh to no assertion patterns', () => {
    expect(buildSuggestedPatternConfig(['jmh'])).toEqual({});
  });

  it('maps assertj to assertThat', () => {
    const result = buildSuggestedPatternConfig(['assertj']);
    expect(result.assertionPatterns).toEqual(['\\bassertThat\\s*\\(']);
  });

  it('maps testify to assert/require calls', () => {
    const result = buildSuggestedPatternConfig(['testify']);
    expect(result.assertionPatterns).toEqual(['\\b(?:assert|require)\\.\\w+\\s*\\(']);
  });

  it('maps Go testing stdlib to t.Error/Fatal/Fail family', () => {
    const result = buildSuggestedPatternConfig(['testing']);
    expect(result.assertionPatterns).toEqual([
      '\\bt\\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\\s*\\(',
    ]);
  });

  it('maps gtest to EXPECT_ and ASSERT_ macros', () => {
    const result = buildSuggestedPatternConfig(['gtest']);
    expect(result.assertionPatterns).toEqual(['\\bEXPECT_\\w+\\s*\\(', '\\bASSERT_\\w+\\s*\\(']);
  });

  it('maps catch2 and doctest to REQUIRE and CHECK', () => {
    for (const fw of ['catch2', 'doctest']) {
      const result = buildSuggestedPatternConfig([fw]);
      expect(result.assertionPatterns).toEqual(['\\bREQUIRE\\s*\\(', '\\bCHECK\\s*\\(']);
    }
  });

  it('maps assert (C++/Node) to the broad assert pattern set', () => {
    const result = buildSuggestedPatternConfig(['assert']);
    expect(result.assertionPatterns).toContain('\\bassert\\s*\\(');
    expect(result.assertionPatterns).toContain('\\bassert_\\w+\\s*\\(');
    expect(result.assertionPatterns).toContain('\\bt\\.assert_\\w+\\s*\\(');
    expect(result.assertionPatterns).toContain('\\bGGML_ASSERT\\s*\\(');
  });

  it('maps pytest to assert keyword and dotted .assert', () => {
    const result = buildSuggestedPatternConfig(['pytest']);
    expect(result.assertionPatterns).toEqual(['\\bassert\\b', '.assert']);
  });

  it('maps unittest to self.assert calls', () => {
    const result = buildSuggestedPatternConfig(['unittest']);
    expect(result.assertionPatterns).toEqual(['\\bself\\.assert\\w+\\s*\\(']);
  });

  it('maps playwright/cypress to expect', () => {
    for (const fw of ['playwright', 'cypress']) {
      const result = buildSuggestedPatternConfig([fw]);
      expect(result.assertionPatterns).toEqual(['\\bexpect\\s*\\(']);
    }
  });

  it('deduplicates patterns across overlapping frameworks', () => {
    const result = buildSuggestedPatternConfig(['vitest', 'jest', 'playwright']);
    expect(result.assertionPatterns).toEqual(['\\bexpect\\s*\\(']);
  });

  it('deduplicates junit+testng overlapping patterns', () => {
    const result = buildSuggestedPatternConfig(['junit5', 'testng']);
    const unique = new Set(result.assertionPatterns);
    expect(result.assertionPatterns).toHaveLength(unique.size);
  });

  it('handles unknown frameworks by ignoring them', () => {
    expect(buildSuggestedPatternConfig(['unknown-framework'])).toEqual({});
  });
});
