---
id: TASK-31
title: Package archguard as a real Claude Code plugin (retire deprecated
  ~/.claude/mcp.json install path)
status: todo
labels:
  - enhancement
  - packaging
  - claude-plugin
parent: null
children: []
extra: {}
---
## Proposal

archguard's `.claude-plugin/` directory is empty, and `scripts/install-claude-user-scope.sh`
registers the MCP server by writing to `~/.claude/mcp.json` — a file the current Claude
Code CLI (2.1.220) no longer reads (the file's own `_deprecated` field says so, and
`claude mcp list` confirmed after a restart that the server never actually appeared).
Sibling projects in this same environment (`quay`, `meta-cc`) package themselves as
real installable Claude Code plugins: a `.claude-plugin/marketplace.json` +
`.claude-plugin/plugin.json` + root `.mcp.json` (using `${CLAUDE_PLUGIN_ROOT}`), added
via `claude plugin marketplace add` and installed via `claude plugin install`. The
practical workaround applied 2026-07-26 (`claude mcp add --scope user archguard --
archguard mcp`) fixes visibility but isn't the plugin model — it doesn't install the
bundled skills (`.agents/skills/feature-developer`,
`.agents/skills/project-semantics-discovery`) as plugin commands either; those were
copied loose into `~/.claude/skills/` by the install script.

archguard should follow the same plugin pattern as `quay`/`meta-cc` instead of a
bespoke script writing to a dead config file, so the MCP server and bundled skills
install and update the same way every other plugin in this environment does.

## Plan

1. Add `.claude-plugin/plugin.json` (name, version, description, `commands` pointing
   at the bundled skills under `.agents/skills/`).
2. Add `.claude-plugin/marketplace.json` (mirroring `quay/plugin/.claude-plugin/marketplace.json`'s
   shape) listing archguard as a plugin with `source: "."`.
3. Add a root `.mcp.json` registering the `archguard` MCP server via
   `${CLAUDE_PLUGIN_ROOT}` (command + `["mcp"]` args, resolved against the plugin's
   own installed location rather than assuming a global `archguard` bin on PATH).
4. Retire `scripts/install-claude-user-scope.sh`'s `~/.claude/mcp.json` write, or
   replace the script's purpose entirely with `claude plugin marketplace add <repo>`
   + `claude plugin install archguard`; update the README's "Using with Claude Code"
   section to match.
5. Validate end-to-end: `claude plugin marketplace add <path>`,
   `claude plugin install archguard`, restart Claude Code, confirm `claude mcp list`
   shows `archguard` connected and the two skills are served from the installed
   plugin (not loose files copied into `~/.claude/skills/`).

## Acceptance Criteria

- [ ] `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` exist and
      pass `claude plugin validate`
- [ ] Root `.mcp.json` registers the archguard MCP server using `${CLAUDE_PLUGIN_ROOT}`
- [ ] `install-claude-user-scope.sh` (or its replacement) no longer writes to
      `~/.claude/mcp.json`
- [ ] README's Claude Code install instructions updated to the plugin-install flow
- [ ] Fresh install verified end-to-end: `claude plugin marketplace add` +
      `claude plugin install` + restart → `claude mcp list` shows archguard connected

## Definition of Done

- [ ] Plugin manifests committed and pass `claude plugin validate`
- [ ] The old `~/.claude/mcp.json`-writing install path removed or fully superseded
- [ ] A real restart-and-reconnect verified live (not just "the file was written"),
      matching this repo's own DIR-026 landing standard: a real object actually
      operated through the mechanism