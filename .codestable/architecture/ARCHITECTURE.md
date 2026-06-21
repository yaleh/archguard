# ArchGuard Architecture Entry

> Status: skeleton, pending backfill
> Created: 2026-06-21

## 1. Project Summary

ArchGuard analyzes source code, extracts architecture artifacts, generates Mermaid diagrams, and exposes CLI and MCP query workflows for architecture inspection.

## 2. Core Concepts / Glossary

## 3. Subsystems / Module Index

- `src/cli/metadata/` - typed command/tool metadata registry. It inventories the
  current CLI commands, MCP tools, CLI/MCP parity mappings, agent guidance,
  examples, and verification hints without loading Commander or the MCP SDK.
- `src/cli/commands/help.ts` - CLI adapter that exposes
  `archguard help --json` as the agent-readable structured CLI catalog derived
  from the metadata registry. Existing Commander `--help` output remains the
  human-readable help surface.
- `src/cli/mcp/metadata.ts` - MCP adapter helper that renders tool descriptions
  from registry MCP metadata and agent guidance. MCP parameter descriptions can
  be read from the same registry for drift checks, while current Zod schema
  shapes stay near each handler.
- `src/cli/metadata/docs-renderer.ts` - docs adapter that renders
  marker-bounded README, user-guide, and agent-surface blocks from the same
  metadata registry.
- `scripts/check-metadata-docs.mjs` - docs freshness checker/writer used by
  local scripts and CI. It imports the built docs renderer and fails when the
  renderer is missing or older than `src/cli/metadata`.
- `docs/user-guide/agent-surface.md` - generated agent-facing surface for
  Claude Code and Codex MCP setup plus shared ArchGuard tool workflows.

## 4. Key Architecture Decisions

Existing ADRs live under `docs/adr/` and should be referenced here during future backfill.

- Command/tool inventory and agent guidance are now modeled in
  `src/cli/metadata/`. Runtime CLI and MCP registration still live in existing
  command/server modules until the consumer adapter features migrate them.
- CLI command descriptions are projected from the registry at registration time
  where low-risk. The `help` subcommand is a dedicated structured JSON surface,
  so default Commander help behavior is not overloaded.
- MCP tool descriptions are projected from the registry at registration time.
  Handlers, tool names, output payloads, and Zod validation remain local to the
  existing MCP registration modules; registry drift tests guard exposed tool
  descriptions, top-level schema fields, requiredness, and parameter
  descriptions.
- README/user-guide/agent-surface documentation is projected from the registry
  through marker-bounded generated blocks. CI runs `npm run docs:check` after
  build, and metadata surface E2E verifies built CLI help JSON, in-process MCP
  metadata, docs freshness, parity mappings, and workflow call-first guidance.

## 5. Known Constraints / Boundaries
