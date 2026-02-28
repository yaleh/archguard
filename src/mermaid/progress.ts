/**
 * Mermaid-layer progress reporter abstraction.
 *
 * Defines a minimal interface so MermaidDiagramGenerator does not depend on
 * the CLI-layer ProgressReporter.  Callers (e.g. DiagramProcessor) inject a
 * real reporter; internal/static usages fall back to NoopProgressReporter.
 */
export interface IProgressReporter {
  start(message: string): void;
  succeed(message: string): void;
  fail(message: string): void;
  warn?(message: string): void;
  info?(message: string): void;
}

/** No-op implementation used when no reporter is injected */
export class NoopProgressReporter implements IProgressReporter {
  start(_message: string): void {}
  succeed(_message: string): void {}
  fail(_message: string): void {}
  warn(_message: string): void {}
  info(_message: string): void {}
}
