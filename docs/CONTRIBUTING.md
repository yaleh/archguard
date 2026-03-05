# Documentation Contributing Guide

This document defines how ArchGuard documentation is organized, named, and maintained.

## Directory Structure

```
docs/
├── README.md            Navigation index — entry point for all documentation
├── CONTRIBUTING.md      This file — documentation management specification
├── user-guide/          End-user documentation (CLI usage, configuration, how-to guides)
├── dev-guide/           Developer documentation (architecture, specs, plugin development)
├── adr/                 Architecture Decision Records (significant design decisions)
├── plans/               Active implementation plans currently being executed
├── proposals/           Design proposals under active consideration (not yet a plan or ADR)
├── references/          External reference materials (not modified by this project)
├── screenshots/         Screenshot assets referenced by root README.md
└── archive/             All historical, completed, or superseded content
    ├── reports/         Completion reports, phase summaries, validation reports
    ├── proposals/       Superseded or accepted proposals (converted to ADR or plan)
    ├── plans/           Completed or cancelled implementation plans
    ├── diagrams/        Binary and source diagram files from earlier phases
    ├── reviews/         Code and architecture review documents
    ├── prompts/         LLM prompt templates and experiments
    └── refactoring/     Refactoring session artifacts
```

## Naming Conventions

- Use **kebab-case** for all file names: `cli-usage.md`, `plugin-development-guide.md`
- Do **not** use ALLCAPS filenames for new files (legacy ALLCAPS files remain in archive/)
- Do **not** use underscores in new filenames
- ADR files use the format `NNN-short-title.md` where `NNN` is a zero-padded three-digit number
- Plan files use the format `plan-NN-short-title.md` where `NN` is the plan number
- Proposal files use the format `proposal-short-title.md`

## Living Documentation vs Archive

A document belongs in an **active directory** (`user-guide/`, `dev-guide/`, `adr/`, `plans/`) if:

- It describes the current state of the system
- Users or developers need to reference it for day-to-day work
- It will be updated when the system changes

A document belongs in `archive/` if:

- It describes a completed phase or milestone
- It is a proposal that was either accepted (now an ADR) or superseded
- It is a one-time analysis or report that will not be updated
- It is a completion summary, executive summary, or migration notice

**When in doubt, archive it.** Active directories should stay lean.

## ADR Process

Architecture Decision Records capture significant design decisions that affect the system's structure, behavior, or interfaces. See [adr/README.md](adr/README.md) for the full process and template.

Brief summary:

1. When a significant design decision is made, create a new ADR using the next sequential number
2. Use the template in `adr/README.md`
3. Set status to `Proposed` initially; update to `Accepted` after team review
4. Update the ADR index table in `adr/README.md`
5. Link related proposals, plans, and other ADRs using relative paths

ADRs are never deleted — superseded ADRs have their status updated to `Superseded` with a link to the newer ADR.

## Proposals Lifecycle

Proposals in `proposals/` are **design documents** for features or architectural changes that are under consideration but not yet assigned a plan number or ADR.

Proposal lifecycle:

1. Create a new file in `proposals/` using the format `proposal-short-title.md`, status `Draft`
2. Update `docs/README.md` to list the proposal under **Proposals**
3. When a proposal is accepted and work begins, either:
   - Promote it to a Plan: create `plans/plan-NN-title.md` and move the proposal to `archive/proposals/`
   - Promote it to an ADR: create `adr/NNN-title.md` and move the proposal to `archive/proposals/`
4. When a proposal is rejected or superseded, move it directly to `archive/proposals/`

Keep `proposals/` to genuine drafts under active consideration. Completed or abandoned proposals belong in `archive/proposals/`.

## Plans Lifecycle

Plans in `plans/` are **active implementation plans** for work currently in progress or recently completed.

When a plan is finished:

1. Move the plan file from `plans/` to `archive/plans/`
2. Update `docs/README.md` to remove the plan from the Active Plans section
3. If the plan resulted in an ADR, ensure the ADR links to the archived plan

Keep `plans/` to a small number of genuinely active items (aim for fewer than five).

## What NOT to Add to docs/ Root

The `docs/` root should contain only navigational files (`README.md`, `CONTRIBUTING.md`) and subdirectories. Do **not** place the following in the docs root:

- Binary files (`.png`, `.json`, `.puml`, `.txt` output files) — use `archive/diagrams/`
- Completion reports or phase summaries — use `archive/reports/`
- One-off analysis documents — use `archive/reports/`
- New design proposals — use `proposals/` (active) or `archive/proposals/` (superseded)
- Prompts or LLM experiments — use `archive/prompts/`

## Updating the Navigation Index

Whenever you add a new document to an active directory, update `docs/README.md` to include a link to it under the appropriate section. This ensures the navigation index stays accurate and discoverable.

The navigation index at `docs/README.md` is the authoritative entry point for all documentation. Root-level `README.md` and `CLAUDE.md` link to specific documents using their full paths from the project root (e.g., `docs/user-guide/cli-usage.md`).
