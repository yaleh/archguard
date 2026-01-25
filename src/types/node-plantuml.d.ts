/**
 * Type declarations for @entrofi/node-plantuml
 */

declare module '@entrofi/node-plantuml' {
  interface GenerateOptions {
    format?: 'png' | 'svg' | 'eps';
  }

  interface GenerateResult {
    out: import('events').EventEmitter;
  }

  function generate(code: string, options?: GenerateOptions): GenerateResult;

  export default plantuml;
}
