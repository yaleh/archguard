/**
 * Composition-root registration shim for the parser backend resolver port.
 *
 * Importing this module (for its side effect) wires the concrete parser runtime
 * into the core-owned ParserBackendResolver port and publishes the module
 * specifier that worker threads import to register themselves in-thread. The
 * parser layer relays this opaque specifier; it never names a concrete module.
 *
 * Kept free of static cycles: it imports only the backend-selection leaf, and
 * the policy module is pulled in lazily at resolve time.
 */
import {
  setParserBackendResolver,
  setParserBackendResolverModuleSpecifier,
  type ParserBackendResolver,
} from '@/core/parser-runtime/parser-backend-resolver.js';
import { resolveParserBackend, type ParserLanguage } from './parser-backend.js';

/** Build-root-relative specifier a worker imports; relative to the worker's own build dir. */
export const REGISTRATION_MODULE_SPECIFIER = 'plugins/shared/register-parser-runtime.js';

const resolver: ParserBackendResolver = {
  async resolveBackend(runtime) {
    return resolveParserBackend(runtime);
  },
  async resolveSession(language: ParserLanguage) {
    const { selectParserBackendFor } = await import('./parser-runtime.js');
    const { backend } = await selectParserBackendFor(language);
    return backend.createSession(language);
  },
};

setParserBackendResolver(resolver);
setParserBackendResolverModuleSpecifier(REGISTRATION_MODULE_SPECIFIER);
