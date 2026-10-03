/**
 * Dependency-injection port for parser backends.
 *
 * The core and parser layers must not depend on the concrete parser backends
 * (they drag in the native/WASM grammar bindings and the per-language policy).
 * Instead the composition root registers a resolver here and every consumer
 * reaches the runtime through this port. This inverts the original
 * core <-> plugin-runtime dependency so the direction is one-way.
 *
 * Process scope: the resolver is process-global. Worker threads get a fresh
 * module graph, so a worker receives the registration module specifier through
 * its init data and imports it in-thread before resolving.
 */
import type { ParserBackend, ParserLanguage } from './parser-backend.js';
import type { ParserRuntimeKind, ParserSession } from './syntax-tree.js';

/** The seam through which core/parser reach the concrete parser runtime. */
export interface ParserBackendResolver {
  /** Backend for an explicit runtime kind (used by the language-agnostic escape hatch). */
  resolveBackend(runtime?: ParserRuntimeKind): Promise<ParserBackend>;
  /** A ready session for a language, applying the effective auto|native|wasm policy. */
  resolveSession(language: ParserLanguage): Promise<ParserSession>;
}

let resolver: ParserBackendResolver | undefined;
let resolverModuleSpecifier: string | undefined;

/** Register the resolver. Called by the composition root (or a worker registration module). */
export function setParserBackendResolver(next: ParserBackendResolver): void {
  resolver = next;
}

/** Whether a resolver has been registered in this process/thread. */
export function hasParserBackendResolver(): boolean {
  return resolver !== undefined;
}

export function getParserBackendResolver(): ParserBackendResolver {
  if (resolver === undefined) {
    throw new Error(
      'No parser backend resolver is registered. A composition root must import the parser ' +
        'runtime registration module before parsing non-TypeScript sources (workers import it ' +
        'from their injected init data).'
    );
  }
  return resolver;
}

/** Test hook: forget the registered resolver. */
export function resetParserBackendResolver(): void {
  resolver = undefined;
}

/**
 * Module specifier (relative to the build root) a worker imports to register
 * itself in-thread. The parser layer only relays this opaque string; it never
 * resolves or names a concrete module path itself.
 */
export function setParserBackendResolverModuleSpecifier(specifier: string): void {
  resolverModuleSpecifier = specifier;
}

export function getParserBackendResolverModuleSpecifier(): string | undefined {
  return resolverModuleSpecifier;
}

/** Test hook: forget the worker registration specifier. */
export function resetParserBackendResolverModuleSpecifier(): void {
  resolverModuleSpecifier = undefined;
}
