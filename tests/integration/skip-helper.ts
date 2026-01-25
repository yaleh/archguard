/**
 * Helper functions for skipping integration tests based on environment
 */

import { isClaudeCodeAvailable } from '../../src/utils/cli-detector.js';

/**
 * Skip test if Claude Code CLI is not available
 * Use with: describe.skipIf = skipIfNoClaudeCode().skip
 */
export async function skipIfNoClaudeCode() {
  const isAvailable = await isClaudeCodeAvailable();

  return {
    skip: !isAvailable,
    reason: isAvailable
      ? undefined
      : 'Claude Code CLI not available in test environment. Install from: https://claude.com/claude-code',
  };
}

/**
 * Get skip condition for API-based tests (deprecated)
 * This is kept for backward compatibility but should not be used
 */
export function skipIfNoApiKey() {
  console.warn(
    'WARNING: skipIfNoApiKey is deprecated. API-based tests are no longer supported.',
  );

  return {
    skip: true,
    reason:
      'API-based tests are deprecated. Use Claude Code CLI instead: https://claude.com/claude-code',
  };
}
