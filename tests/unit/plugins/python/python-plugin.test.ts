/**
 * Tests for PythonPlugin.isTestFile() and PythonPlugin.extractTestStructure()
 *
 * TDD: these tests were written before the implementation (Fix 1 & Fix 2).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PythonPlugin } from '@/plugins/python/index.js';

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

let plugin: PythonPlugin;

beforeEach(async () => {
  plugin = new PythonPlugin();
  await plugin.initialize({ workspaceRoot: '/project' });
});

// ---------------------------------------------------------------------------
// Fix 1 — isTestFile()
// ---------------------------------------------------------------------------

describe('PythonPlugin.isTestFile()', () => {
  it('recognises test_*.py as a test file', () => {
    expect(plugin.isTestFile('/project/test_calculator.py')).toBe(true);
  });

  it('recognises *_test.py as a test file', () => {
    expect(plugin.isTestFile('/project/calculator_test.py')).toBe(true);
  });

  it('rejects a regular .py file', () => {
    expect(plugin.isTestFile('/project/calculator.py')).toBe(false);
  });

  it('recognises any .py file inside a tests/ directory', () => {
    expect(plugin.isTestFile('/project/tests/test_models.py')).toBe(true);
  });

  it('recognises any .py file inside a test/ directory', () => {
    expect(plugin.isTestFile('/project/test/helpers.py')).toBe(true);
  });

  it('rejects conftest.py', () => {
    expect(plugin.isTestFile('/project/tests/conftest.py')).toBe(false);
  });

  it('rejects __init__.py inside tests/', () => {
    expect(plugin.isTestFile('/project/tests/__init__.py')).toBe(false);
  });

  it('uses patternConfig.testFileGlobs when provided (overrides defaults)', () => {
    const cfg = { testFileGlobs: ['**/check_*.py'] };
    expect(plugin.isTestFile('/project/src/check_health.py', cfg)).toBe(true);
    // default pattern test_*.py is NOT matched when globs override is active
    expect(plugin.isTestFile('/project/test_foo.py', cfg)).toBe(false);
  });

  it('is case-sensitive: TestFoo.py is not matched by default', () => {
    expect(plugin.isTestFile('/project/TestFoo.py')).toBe(false);
  });

  it('handles Windows-style paths (backslash) for tests directory', () => {
    expect(plugin.isTestFile('C:\\project\\tests\\test_models.py')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fix 2 — extractTestStructure()
// ---------------------------------------------------------------------------

describe('PythonPlugin.extractTestStructure()', () => {
  it('returns null for a non-test file path', () => {
    const code = 'def hello():\n    pass\n';
    expect(plugin.extractTestStructure('/project/calculator.py', code)).toBeNull();
  });

  it('returns null if test file has no test_ functions', () => {
    const code = 'def helper():\n    pass\n';
    expect(plugin.extractTestStructure('/project/test_empty.py', code)).toBeNull();
  });

  it('detects pytest framework from "import pytest"', () => {
    const code = `import pytest

def test_add():
    assert 1 + 1 == 2
`;
    const result = plugin.extractTestStructure('/project/test_add.py', code);
    expect(result).not.toBeNull();
    expect(result!.frameworks).toContain('pytest');
  });

  it('detects unittest framework from "import unittest"', () => {
    const code = `import unittest

class TestCalc(unittest.TestCase):
    def test_add(self):
        self.assertEqual(1 + 1, 2)
`;
    const result = plugin.extractTestStructure('/project/test_calc.py', code);
    expect(result).not.toBeNull();
    expect(result!.frameworks).toContain('unittest');
  });

  it('falls back to "unknown" framework when no known import found', () => {
    const code = `def test_add():
    assert 1 + 1 == 2
`;
    const result = plugin.extractTestStructure('/project/test_add.py', code);
    expect(result!.frameworks).toContain('unknown');
  });

  it('extracts top-level test_ functions as test cases', () => {
    const code = `def test_add():
    assert 1 + 1 == 2

def test_subtract():
    assert 3 - 1 == 2
`;
    const result = plugin.extractTestStructure('/project/test_math.py', code);
    expect(result!.testCases).toHaveLength(2);
    expect(result!.testCases.map((tc) => tc.name)).toEqual(['test_add', 'test_subtract']);
  });

  it('extracts test methods from a Test* class (but not helper methods)', () => {
    const code = `class TestCalculator:
    def test_add(self):
        assert True

    def helper(self):
        pass
`;
    const result = plugin.extractTestStructure('/project/test_calc.py', code);
    expect(result!.testCases).toHaveLength(1);
    expect(result!.testCases[0].name).toBe('test_add');
  });

  it('counts "assert " statements as assertions', () => {
    const code = `def test_add():
    result = 1 + 1
    assert result == 2
    assert result > 0
`;
    const result = plugin.extractTestStructure('/project/test_add.py', code);
    expect(result!.testCases[0].assertionCount).toBe(2);
  });

  it('marks test as skipped for @pytest.mark.skip', () => {
    const code = `import pytest

@pytest.mark.skip
def test_broken():
    assert False
`;
    const result = plugin.extractTestStructure('/project/test_broken.py', code);
    expect(result!.testCases[0].isSkipped).toBe(true);
  });

  it('marks test as skipped for @pytest.mark.skipif(...)', () => {
    const code = `import pytest

@pytest.mark.skipif(True, reason='not ready')
def test_future():
    pass
`;
    const result = plugin.extractTestStructure('/project/test_future.py', code);
    expect(result!.testCases[0].isSkipped).toBe(true);
  });

  it('marks test as skipped for @unittest.skip(...)', () => {
    const code = `import unittest

class TestFoo(unittest.TestCase):
    @unittest.skip('reason')
    def test_skipped(self):
        pass
`;
    const result = plugin.extractTestStructure('/project/test_foo.py', code);
    expect(result!.testCases[0].isSkipped).toBe(true);
  });

  it('sets testTypeHint "unit" by default', () => {
    const code = `def test_add():\n    assert 1 + 1 == 2\n`;
    const result = plugin.extractTestStructure('/project/tests/test_add.py', code);
    expect(result!.testTypeHint).toBe('unit');
  });

  it('sets testTypeHint "integration" for paths containing /integration/', () => {
    const code = `def test_api():\n    assert True\n`;
    const result = plugin.extractTestStructure('/project/tests/integration/test_api.py', code);
    expect(result!.testTypeHint).toBe('integration');
  });

  it('sets testTypeHint "e2e" for paths containing /e2e/', () => {
    const code = `def test_ui():\n    assert True\n`;
    const result = plugin.extractTestStructure('/project/tests/e2e/test_ui.py', code);
    expect(result!.testTypeHint).toBe('e2e');
  });

  it('sets testTypeHint "performance" for paths containing /benchmark/', () => {
    const code = `def test_speed():\n    assert True\n`;
    const result = plugin.extractTestStructure('/project/tests/benchmark/test_speed.py', code);
    expect(result!.testTypeHint).toBe('performance');
  });

  it('respects patternConfig.assertionPatterns override', () => {
    const code = `def test_custom():
    my_assert(result)
    my_assert(other)
`;
    const cfg = { assertionPatterns: ['my_assert('] };
    const result = plugin.extractTestStructure('/project/test_custom.py', code, cfg);
    expect(result!.testCases[0].assertionCount).toBe(2);
  });

  it('respects patternConfig.skipPatterns override', () => {
    const code = `@my_skip
def test_broken():
    assert True
`;
    const cfg = { skipPatterns: ['@my_skip'] };
    const result = plugin.extractTestStructure('/project/test_broken.py', code, cfg);
    expect(result!.testCases[0].isSkipped).toBe(true);
  });

  it('returns importedSourceFiles as empty array (relative imports not resolvable)', () => {
    const code = `from ..models import User

def test_user():
    assert User is not None
`;
    const result = plugin.extractTestStructure('/project/tests/test_user.py', code);
    expect(result!.importedSourceFiles).toEqual([]);
  });

  // PyTorch / NumPy assertion detection (Fix for torch.testing.assert_close false negatives)
  it('counts torch.testing.assert_close as an assertion by default', () => {
    const code = `def test_attention():
    out = model(x)
    torch.testing.assert_close(out, expected, atol=1e-3, rtol=1e-5)
    torch.testing.assert_close(out.shape, expected.shape)
`;
    const result = plugin.extractTestStructure('/project/tests/pytorch/kernel/test_attention.py', code);
    expect(result!.testCases[0].assertionCount).toBe(2);
  });

  it('counts np.testing.assert_allclose as an assertion by default', () => {
    const code = `def test_output():
    np.testing.assert_allclose(actual, expected, rtol=1e-5)
    np.testing.assert_array_equal(a, b)
`;
    const result = plugin.extractTestStructure('/project/tests/test_output.py', code);
    expect(result!.testCases[0].assertionCount).toBe(2);
  });

  it('counts self.assertEqual and self.assertIsNotNone by default', () => {
    const code = `import unittest

class TestModel(unittest.TestCase):
    def test_shape(self):
        self.assertEqual(result.shape, (3, 4))
        self.assertIsNotNone(result)
`;
    const result = plugin.extractTestStructure('/project/tests/test_model.py', code);
    expect(result!.testCases[0].assertionCount).toBe(2);
  });

  it('counts mixed assert statement and torch.testing.assert_close', () => {
    const code = `def test_mixed():
    out = model(x)
    assert out is not None
    torch.testing.assert_close(out, expected)
`;
    const result = plugin.extractTestStructure('/project/tests/test_mixed.py', code);
    expect(result!.testCases[0].assertionCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Capabilities flag
// ---------------------------------------------------------------------------

describe('PythonPlugin.metadata.capabilities', () => {
  it('testStructureExtraction is true after implementing isTestFile/extractTestStructure', () => {
    expect(plugin.metadata.capabilities.testStructureExtraction).toBe(true);
  });
});
