/**
 * Rule engine barrel (TASK-63, Phase B).
 */

export { RuleEngine } from './rule-engine.js';
export type { RuleEngineFileResult, RuleEngineOptions } from './rule-engine.js';
export { RuleBasedLanguagePlugin } from './rule-based-plugin.js';
export { childrenOfType, fieldText, firstDescendantOfType, nodeText } from './ast-node.js';
