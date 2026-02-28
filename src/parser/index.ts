/**
 * Parser module - Code fingerprint extraction
 */

export { ClassExtractor } from './class-extractor';
export { InterfaceExtractor } from './interface-extractor';
export { EnumExtractor } from './enum-extractor';
export { RelationExtractor } from './relation-extractor';
export { TypeScriptParser } from './typescript-parser';
export { ParallelParser } from './parallel-parser';
export type { ParallelParserOptions, ParsingMetrics } from './parallel-parser';
export { ArchJSONAggregator } from './archjson-aggregator';

export const parserVersion = '0.1.0';
