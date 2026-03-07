# Spike: @modelcontextprotocol/sdk Compatibility

**Date**: 2026-03-07
**SDK Version Tested**: 1.27.1
**Project Node.js**: v22.14.0
**Project TypeScript**: ^5.3.0

## Results Summary

| Check | Result | Notes |
|-------|--------|-------|
| ESM compatibility | PASS (with caveat) | Subpath imports work; bare import broken |
| stdio transport | PASS | `StdioServerTransport` available |
| Bundle size | ACCEPTABLE | 6 MB SDK, 26 MB total with 91 deps |
| TypeScript types | PASS | `.d.ts` files ship alongside ESM output |

## Detailed Findings

### 1. ESM Compatibility: PASS (with caveat)

The SDK declares `"type": "module"` in its package.json and provides dual ESM/CJS builds via the exports map.

**Working imports (subpath, recommended pattern):**
```typescript
import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
```

**Broken import (bare specifier):**
```typescript
import { ... } from '@modelcontextprotocol/sdk';
// FAILS: dist/esm/index.js does not exist in v1.27.1
```

The root `"."` export entry in the exports map points to `./dist/esm/index.js`, but that file does not exist in the published package. This appears to be a packaging bug in v1.27.1 -- the root re-export barrel file was removed but the exports map was not updated.

**Impact**: None. The subpath imports (`/server`, `/server/stdio.js`, `/client`, `/validation`) are the idiomatic usage pattern per MCP SDK documentation. ArchGuard would only need `/server` and `/server/stdio.js`.

### 2. stdio Transport: PASS

```typescript
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
// exports: [ 'StdioServerTransport' ]
```

`StdioServerTransport` is available and constructable. This is the transport needed for CLI-based MCP servers (communicates over stdin/stdout JSON-RPC).

### 3. Bundle Size: ACCEPTABLE

| Component | Size |
|-----------|------|
| `@modelcontextprotocol/sdk` | 6.0 MB |
| Total `node_modules` (SDK + all deps) | 26 MB |
| Dependency count | 91 packages |

**Major transitive dependencies:**
- `zod` (6.2 MB) -- already in ArchGuard's dependencies, so no net increase
- `hono` (3.5 MB) -- HTTP framework, used for StreamableHTTP transport
- `ajv` (2.5 MB) -- JSON Schema validation
- `jose` (632 KB) -- JWT/OAuth (for auth flows)
- `express` (104 KB) -- HTTP server (SSE transport)
- `cors` (36 KB) -- CORS middleware

The HTTP/auth dependencies (`hono`, `express`, `cors`, `jose`) are only needed for HTTP-based transports, not stdio. They will be installed but never loaded at runtime when using `StdioServerTransport`. Tree-shaking at the import level means no runtime cost, only disk cost.

**Net new disk cost** (excluding shared `zod`): ~20 MB.

### 4. TypeScript Types: PASS

The SDK ships `.d.ts` files co-located with the ESM output in `dist/esm/`. Type definitions are comprehensive and include:

- `Server` class with full generics
- `StdioServerTransport`
- Request/response/notification types from the MCP spec
- `ServerCapabilities`, `Implementation` interfaces
- `setRequestHandler` method for tool registration

The SDK targets TypeScript features compatible with TS 5.x. No conflicts with ArchGuard's `^5.3.0`.

### 5. API Surface Verification

```typescript
import { Server } from '@modelcontextprotocol/sdk/server';

const server = new Server(
  { name: 'archguard', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

// setRequestHandler is available for registering tool handlers
typeof server.setRequestHandler === 'function'; // true
```

Server instantiation and tool capability declaration work correctly.

## Recommendation: Use the SDK

**Use `@modelcontextprotocol/sdk`** rather than hand-writing JSON-RPC.

**Rationale:**

1. **Protocol compliance** -- The MCP spec is non-trivial (capability negotiation, request/response correlation, progress tokens, cancellation). The SDK handles all of this correctly.

2. **Type safety** -- Full TypeScript types for the MCP protocol, including tool input/output schemas via Zod integration (which ArchGuard already uses).

3. **Maintenance** -- The SDK is actively maintained (75+ releases, latest Feb 2026) by the protocol authors. Hand-rolling JSON-RPC would require tracking spec changes manually.

4. **Disk cost is acceptable** -- ~20 MB net new dependencies, mostly HTTP transports that are never loaded when using stdio.

**Mitigations for concerns:**

- The bare import bug is irrelevant; use subpath imports (`/server`, `/server/stdio.js`).
- The HTTP dependencies (hono, express) are dead weight on disk but have zero runtime impact for stdio usage. If disk size becomes a concern, a future SDK version may offer a slim stdio-only entry point.

**Usage pattern for ArchGuard:**

```typescript
import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server(
  { name: 'archguard', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// Register tools via server.setRequestHandler(...)
// Connect via: const transport = new StdioServerTransport(); await server.connect(transport);
```
