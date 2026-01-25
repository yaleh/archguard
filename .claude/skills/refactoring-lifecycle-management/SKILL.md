---
name: refactoring-lifecycle-management
description: "RLM (Refactoring Lifecycle Management): Systematic methodology for managing the complete lifecycle of software refactoring initiatives through 6 phases (PROPOSAL → PLANNING → EXECUTION → VALIDATION → INTEGRATION → MONITORING) with bi-directional traceability, quality gates, and metrics-driven measurement. Use when managing multiple refactoring iterations, improving plan-execution alignment, establishing refactoring dashboard and traceability matrix, or coordinating team refactoring efforts."
argument-hint: [phase|task-name]
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
---

# Refactoring Lifecycle Management (RLM)

**Version**: 1.1 (Integration Updates)
**Status**: ✅ Enhanced (V_instance=0.82, V_meta=0.85 + Skill Integration)
**Domain**: Refactoring process management
**Author**: Extracted from gemini-live-scribe BAIME experiment

## Overview

Refactoring Lifecycle Management (RLM) is a systematic methodology for managing the complete lifecycle of software refactoring initiatives. RLM addresses the unique challenges of refactoring: temporal evolution, uncertainty in planning, multiple stakeholder audiences, and bi-directional traceability between process and state.

### When to Use RLM

**Use RLM when**:
- Your project has multiple refactoring iterations (5+ planned or completed)
- Plan-execution alignment is poor (>40% deviation from original plans)
- Stakeholders need 20+ minutes to understand refactoring progress
- You can't trace which refactoring changed which architecture component
- Completion reports are inconsistent or missing key sections

**Don't use RLM for**:
- Generic documentation management (file organization, naming conventions)
- Single refactoring efforts (use simple completion report instead)
- Projects without refactoring artifacts (nothing to manage yet)

### Key Benefits

**Proven Results** (from gemini-live-scribe validation):
- **Discovery Efficiency**: 10.9x improvement (180s → 16.5s average query time)
- **Plan-Execution Alignment**: 0.40 → 0.60 (+50% improvement)
- **Traceability Coverage**: 90% bi-directional (40/45 links working)
- **Stakeholder Visibility**: <5 minutes to understand progress (vs 20-30 minutes baseline)

### Methodology Components

1. **6-Phase Lifecycle Templates**: PROPOSAL → PLANNING → EXECUTION → VALIDATION → INTEGRATION → MONITORING
2. **Refactoring Dashboard**: Single entry point with metrics, timeline, status (650 lines)
3. **Traceability Matrix**: Bi-directional mapping (plans ↔ executions ↔ state)
4. **Quality Gates**: 6 checkpoints ensuring completeness before phase transitions
5. **Measurement System**: V_instance (domain quality) + V_meta (methodology quality)

---

## Skill Integration

### Related Skills Overview

RLM coordinates with complementary skills for complete refactoring lifecycle management. This section explains how RLM integrates with other skills and when to use each one.

**code-refactoring** (Technical Methods):
- **Purpose**: Technical methods for code refactoring (TDD, patterns, metrics)
- **Used in RLM Phases**:
  - EXECUTION phase: TDD workflow, refactoring patterns, metrics tracking
  - VALIDATION phase: Metrics comparison, regression detection
  - INTEGRATION phase: Merge to main, tag release, post-merge validation
  - MONITORING phase: Metrics trend analysis, continuous improvement
- **Skill Location**: [code-refactoring SKILL.md](../code-refactoring/SKILL.md)
- **Quick Start**: See "Quick Start with RLM" section in code-refactoring skill
- **Key Value**: Provides technical "HOW-TO" for refactoring implementation

**documentation-management** (Documentation Quality):
- **Purpose**: Write high-quality refactoring documentation
- **Used in RLM Phases**:
  - EXECUTION phase: Quality checklists, documentation sync
  - VALIDATION phase: Documentation quality validation, peer review
  - INTEGRATION phase: Completion report writing, documentation updates
- **Skill Location**: [documentation-management SKILL.md](../documentation-management/SKILL.md)
- **Key Value**: Ensures documentation completeness and quality

**documentation-organization** (Documentation Structure):
- **Purpose**: Organize refactoring documentation effectively
- **Used in RLM Phases**:
  - INTEGRATION phase: Evolution history, structure validation, cross-references
  - MONITORING phase: Link validation, freshness checks
- **Skill Location**: [documentation-organization SKILL.md](../documentation-organization/SKILL.md)
- **Key Value**: Maintains documentation structure and integrity

### When to Use Each Skill

**Use code-refactoring when**:
- You need technical guidance on HOW to refactor code
- Example: "How do I apply TDD to this refactoring?"
- Example: "What patterns should I use for this complexity?"
- Example: "How do I measure refactoring success with metrics?"
- **Entry Point**: Use code-refactoring skill's "Quick Start with RLM" section
- **Independence**: Can be used standalone for quick refactoring tasks (2-4 hours)

**Use documentation-management when**:
- You need guidance on HOW to write refactoring documentation
- Example: "What sections should my completion report have?"
- Example: "How do I validate my documentation quality?"
- Example: "What templates should I use for refactoring docs?"
- **Entry Point**: Use documentation-management skill templates

**Use documentation-organization when**:
- You need guidance on HOW TO ORGANIZE refactoring documentation
- Example: "How should I structure my refactoring directory?"
- Example: "What naming convention should I use?"
- Example: "How do I add evolution history to state docs?"
- **Entry Point**: Use documentation-organization skill guidelines

**Use RLM when**:
- You need guidance on HOW TO MANAGE the refactoring process
- Example: "What phases does my refactoring need?"
- Example: "How do I track refactoring progress?"
- Example: "How do I ensure bi-directional traceability?"
- Example: "How do I coordinate team members?"
- **Entry Point**: This skill (RLM) - see Quick Start below

### Skill Relationship Diagram

```
                    ┌─────────────────────────────────┐
                    │  Refactoring Lifecycle          │
                    │  Management (RLM)               │
                    │  - Process Management           │
                    │  - 6-Phase Lifecycle            │
                    │  - Quality Gates                │
                    │  - Traceability                 │
                    │  - Dashboard & Metrics           │
                    └─────────────┬───────────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        │                         │                         │
        ▼                         ▼                         ▼
┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
│ code-refactoring  │   │ doc-mgmt          │   │ doc-org           │
│ - Technical       │   │ - Quality         │   │ - Structure       │
│   Methods         │   │   Writing         │   │ - Organization    │
│ - TDD Workflow    │   │ - Templates       │   │ - Naming          │
│ - Patterns        │   │ - Validation      │   │ - Cross-references │
│ - Metrics         │   │                   │   │                   │
└───────────────────┘   └───────────────────┘   └───────────────────┘
     Used in:                 Used in:                 Used in:
     EXECUTION                EXECUTION                 INTEGRATION
     VALIDATION               VALIDATION                MONITORING
     INTEGRATION              INTEGRATION
     MONITORING

Legend:
→ RLM coordinates all skills
→ code-refactoring: Technical execution
→ doc-mgmt: Documentation quality
→ doc-org: Documentation structure
```

### Integration Workflow

**Complete Refactoring Project** (All Skills Orchestrated by RLM):

1. **PROPOSAL Phase** (RLM primary):
   - RLM: Create proposal, define objectives, identify scope
   - code-refactoring: Provide technical assessment (complexity, patterns)
   - doc-mgmt: Identify documentation needs
   - doc-org: Assess documentation impact

2. **PLANNING Phase** (RLM primary):
   - RLM: Create detailed plan, identify risks, define milestones
   - code-refactoring: Estimate complexity, choose patterns, identify technical dependencies
   - doc-mgmt: Plan documentation deliverables
   - doc-org: Plan documentation structure updates

3. **PREPARATION Phase** (RLM primary):
   - RLM: Setup environment, prepare dashboard, define quality gates
   - code-refactoring: Capture baseline metrics (complexity, coverage)
   - doc-mgmt: Prepare documentation templates
   - doc-org: Verify documentation structure

4. **EXECUTION Phase** (RLM + code-refactoring + doc-mgmt):
   - RLM: Process management, progress tracking, work log, completion report draft
   - code-refactoring: **TDD workflow** (RED → GREEN → REFACTOR → COMMIT), refactoring patterns, metrics tracking
   - doc-mgmt: Documentation sync, quality checklists
   - doc-org: Maintain documentation structure

5. **VALIDATION Phase** (RLM + code-refactoring + doc-mgmt):
   - RLM: Process validation, quality gates (≥80% threshold), overall score calculation
   - code-refactoring: **Metrics comparison** (current vs baseline), test validation, regression detection
   - doc-mgmt: Documentation quality validation, peer review
   - doc-org: Structure validation

6. **INTEGRATION Phase** (RLM + code-refactoring + doc-mgmt + doc-org):
   - RLM: Merge coordination, tag management, completion report finalization
   - code-refactoring: **Code integration** (merge to main, tag release, post-merge validation)
   - doc-mgmt: Completion report writing, documentation updates
   - doc-org: **Evolution history** in state docs, cross-references, structure validation

7. **MONITORING Phase** (RLM + code-refactoring + doc-org):
   - RLM: Feedback collection, improvement tracking, stakeholder updates
   - code-refactoring: **Metrics trend analysis**, regression detection, continuous improvement
   - doc-mgmt: Documentation quality monitoring
   - doc-org: Link validation, freshness checks

### Skill Boundary Clarification

**RLM Handles** (Process Management):
- Project management (phases, timelines, milestones, resources)
- Documentation management (completion reports, traceability matrix, dashboard)
- Quality gates (≥80% validation threshold, phase transitions)
- Team coordination (peer review, knowledge transfer, stakeholder updates)
- Process tracking (plan-execution alignment, deviation tracking)

**code-refactoring Handles** (Technical Methods):
- Technical execution (TDD workflow, refactoring patterns, incremental commits)
- Metrics measurement (baseline, comparison, trend analysis)
- Code quality (tests, coverage, complexity, performance)
- Integration (merge, tag, post-validation)

**Overlap Areas** (Clear Division of Responsibility):
- **Metrics**: RLM defines WHAT to measure (process metrics), code-refactoring defines HOW to measure (technical metrics)
- **Validation**: RLM defines quality gates (≥80% threshold), code-refactoring provides validation data (metrics comparison)
- **Documentation**: RLM manages completion reports and traceability, doc-mgmt provides quality methods, doc-org provides structure
- **Integration**: RLM coordinates merge and tag, code-refactoring performs technical merge steps, doc-org adds evolution history

### Quick Reference Table

| Your Question | Use This Skill | Why? |
|--------------|----------------|------|
| "How do I manage my refactoring project?" | RLM | RLM provides 6-phase process management |
| "How do I apply TDD to this refactoring?" | code-refactoring | code-refactoring provides TDD workflow |
| "What patterns should I use for this complexity?" | code-refactoring | code-refactoring provides pattern selection |
| "What sections should my completion report have?" | doc-mgmt | doc-mgmt provides completion report template |
| "How should I organize my refactoring docs?" | doc-org | doc-org provides organization methods |
| "What are the quality gates for refactoring?" | RLM | RLM defines quality gates (≥80%) |
| "How do I measure refactoring success?" | code-refactoring | code-refactoring provides metrics framework |
| "How do I ensure bi-directional traceability?" | RLM | RLM provides traceability matrix |

---

## Quick Start

### Step 1: Establish Baseline (4-6 hours)

Measure current refactoring management state:

```bash
# Measure plan-execution alignment
# Count planned tasks vs executed as planned

# Measure traceability coverage
# Sample 15 completion reports for "Impact on Architecture State" sections
# Sample 20 state docs for "Architecture Evolution History" sections

# Measure discovery efficiency
# Time 10 representative refactoring questions

# Measure stakeholder visibility
# Time how long to understand current progress
```

**Output**: Calculate baseline V_instance (typically 0.25-0.40)

### Step 2: Create Core Artifacts (8-10 hours)

```bash
# Copy templates from this skill
cp -r templates/* docs/refactoring/templates/

# Create refactoring dashboard
# Use templates/dashboard-template.md

# Create traceability matrix
# Use templates/traceability-matrix-template.md

# Define quality gates
# Use templates/quality-gates-template.md
```

### Step 3: Apply to Existing Work (6-8 hours)

```bash
# Select 3-5 recent completion reports
# Add "Impact on Architecture State" sections

# Add evolution history to 2-3 key state docs
# Update dashboard and traceability matrix

# Update plans to reflect reality
# Document plan deviations with rationale
```

### Step 4: Measure Improvement (1-2 hours)

```bash
# Re-measure V_instance components
# Calculate V_meta components
# Compare to baseline
# Create iteration report
```

**Expected Results**: V_instance improvement of +0.20-0.35 in first iteration

---

## Core Methodology

### Process vs State Documents

**Process Documents** (docs/refactoring/):
- Describe **what was done** and **how it evolved**
- Time-bound, specific to an iteration
- Examples: Plans, completion reports, validation reports

**State Documents** (docs/specs/, docs/guides/, CLAUDE.md):
- Describe **what exists** and **how to use it**
- Static until next refactoring changes it
- Examples: Feature specs, usage guides, architecture docs

**RLM's Core Value**: Maintain bi-directional traceability between process and state

### 6-Phase Lifecycle

**Phase 1: PROPOSAL** (Problem Identification)
- **Deliverables**: Problem statement, proposed solution, impact assessment, alternative analysis, recommendation
- **Template**: `templates/proposal-phase-template.md`
- **Quality Gate**: Problem clarity, solution completeness, impact quantified, alternatives analyzed

**Phase 2: PLANNING** (Detailed Execution Plan)
- **Deliverables**: SMART objectives, scope definition, task breakdown, estimates, dependencies, risks, success criteria
- **Template**: `templates/planning-phase-template.md`
- **Quality Gate**: Objectives SMART, scope bounded, tasks decomposed, estimates realistic

**Phase 3: EXECUTION** (Implementation)
- **Deliverables**: Code implementation, tests, **completion report with "Impact on Architecture State" section**
- **Template**: `templates/execution-phase-template.md`
- **Quality Gate**: Code quality verified, test coverage met, documentation complete, **bi-directional traceability established**

**EXECUTION Phase Structure** (Enhanced with code-refactoring integration):

```markdown
# EXECUTION Phase: [Task Name]

## Part 1: Technical Workflow (code-refactoring)

### TDD-Based Refactoring

Follow Test-Driven Development cycle for each refactoring step:

1. **RED**: Write failing test
   - Identify refactoring target (function, class, module)
   - Write test that documents expected behavior
   - Verify test fails (RED)

2. **GREEN**: Make minimal changes to pass
   - Apply refactoring pattern (Extract Method, Extract Class, etc.)
   - Run test suite
   - Ensure all tests pass (GREEN)

3. **REFACTOR**: Clean up code
   - Remove duplication
   - Improve names (variables, functions, classes)
   - Extract methods/classes for clarity
   - Ensure tests still pass

4. **COMMIT**: Incremental commit
   - Commit message format: `refactor(scope): description`
   - Reference related issue or proposal
   - Include tests in commit
   - Ensure build passes

**Detailed Guidance**: See [code-refactoring skill](../code-refactoring/SKILL.md#tdd-refactoring-workflow)

### Common Refactoring Patterns

**Structural Patterns**:
- **Extract Method**: Extract code fragment into separate method
- **Extract Class**: Extract responsibilities into new class
- **Inline Method**: Remove method and insert its body
- **Inline Class**: Merge class into another

**Compositional Patterns**:
- **Replace Conditional with Polymorphism**: Use polymorphism instead of switch/if-else
- **Introduce Parameter Object**: Group related parameters
- **Preserve Whole Object**: Pass entire object instead of fields

**Simplification Patterns**:
- **Decompose Conditional**: Break complex conditionals
- **Consolidate Conditional**: Combine duplicate conditionals
- **Replace Magic Number with Constant**: Use named constants

**Pattern Reference**: [code-refactoring skill](../code-refactoring/SKILL.md#refactoring-patterns)

### Metrics Tracking

**Pre-Execution Metrics** (from PREPARATION phase):
- Baseline complexity: [measure using tools]
- Baseline coverage: [measure using test tools]
- Baseline test count: [count tests]

**Mid-Execution Checkpoint** (optional, at 50% progress):
```bash
# Measure current metrics
./scripts/capture-metrics.sh > checkpoint/metrics.json

# Compare to baseline
./scripts/compare-metrics.sh baseline/metrics.json checkpoint/metrics.json
```

**Decision Point**:
- If complexity improving, coverage stable → ✅ Continue
- If complexity worsening, coverage dropping → ⚠️ Reassess approach

**Metrics Guide**: [code-refactoring skill](../code-refactoring/SKILL.md#metrics)

## Part 2: Execution Process Management (RLM)

### Work Log

**Maintain daily work log** (5-10 minutes per day):

```markdown
## Work Log: [Date]

### Files Modified
- `src/services/AudioCapture.ts` (+50, -100 lines)
- `src/services/SessionManager.ts` (NEW, 150 lines)

### Tests Added
- `src/services/AudioCapture.session.test.ts` (NEW, +10 tests)
- `src/services/SessionManager.test.ts` (NEW, +15 tests)

### Issues Encountered
- **Issue**: VAD mock not compatible with new structure
  - **Resolution**: Updated factory pattern in TENVADetector.test.ts
  - **Time lost**: 30 minutes

### Progress
- Planned: 5 sub-tasks
- Completed: 3 sub-tasks (60%)
- Blocked: 0
- At risk: 1 (running behind)
```

### Completion Report Draft

**Maintain completion report draft** (update as you go):

```markdown
# Completion Report: [Task Name]

**Status**: Draft (Last updated: YYYY-MM-DD)

## Objectives vs Results
| Objective | Planned | Actual | Status |
|-----------|---------|--------|--------|
| [Obj 1] | [What was planned] | [What was done] | ✅ | ⚠️ | ❌ |

## Work Completed
[Fill in as you go]

## Issues Encountered
[Document as they happen]

## Metrics
[Update at the end]
```

## Part 3: Documentation Quality (documentation-management)

### Code Quality Checks

**Pre-Commit Checks** (automated):
```bash
# Lint
npm run lint

# Test
npm test

# Build
npm run build
```

**Manual Checks** (daily):
- [ ] Code review self-assessment
- [ ] Complexity check (no function > 15 cyclomatic)
- [ ] Naming check (clear, descriptive names)
- [ ] DRY check (no obvious duplication)

### Documentation Sync

**Keep Docs in Sync** (update as you code):
- [ ] API changes documented
- [ ] New classes/methods documented
- [ ] Examples updated
- [ ] Changelog updated

**Quick Sync Workflow**:
```bash
# After completing a component
git add docs/guides/[component].md
git commit -m "docs(component): update for refactoring"
```

## Part 4: Progress Tracking (RLM)

### Daily Dashboard Update

**At end of each day**, update dashboard:
```markdown
## Recent Activity (Last 7 Days)

### YYYY-MM-DD

**[Task Name]** (XX% complete)
- **Work Completed**: [What did you do today?]
- **Tests**: [+X tests, Y/Y passing]
- **Issues**: [Any issues?]
- **Next**: [What's tomorrow?]
```

### Weekly Status Report

**Every Monday**, send status report to team:
```markdown
# Weekly Status: [Task Name]

**Week**: N (of M estimated weeks)
**Date**: YYYY-MM-DD
**Owner**: [Name]

## Progress Summary
- **Completed This Week**: [What did you accomplish?]
- **Planned Next Week**: [What's next?]
- **Overall Progress**: XX% (N/M weeks)

## Metrics
- **Complexity**: [Start] → [Current] (Δ: [change])
- **Coverage**: [Start]% → [Current]% (Δ: [+/-X%])
- **Tests**: [Start] → [Current] (Δ: [+/-X])

## Issues & Blockers
- **Issues**: [Any issues this week?]
- **Blockers**: [Any blockers?]
- **Help Needed**: [Do you need anything from the team?]

## Decision Point
**Continue**: ✅ | ⚠️ | ❌
**Rationale**: [Why continue/pivot/stop?]
```
```

**Phase 4: VALIDATION** (Testing and Validation)
- **Deliverables**: Functional tests, performance tests, regression tests, known issues document, rollback plan
- **Template**: `templates/validation-phase-template.md`
- **Quality Gate**: Validation tests passed, no regressions, performance validated, rollback plan tested

**VALIDATION Phase Structure** (Enhanced with code-refactoring integration):

```markdown
# VALIDATION Phase: [Task Name]

## Layer 1: Technical Validation (code-refactoring)

### Metrics Comparison

**Pre-Execution Baseline**: (from PREPARATION phase)
```json
{
  "complexity": 12,
  "coverage": 65%,
  "test_count": 120
}
```

**Post-Execution Actual**: (capture now)
```bash
./scripts/capture-metrics.sh > validation/metrics-post.json
```

**Comparison**:
```bash
./scripts/compare-metrics.sh baseline/metrics.json validation/metrics-post.json
```

**Acceptance Criteria**:
- [ ] **Complexity**: ≤ 10 (or Δ ≤ -2 from baseline)
- [ ] **Coverage**: ≥ 80% (or Δ ≥ +5% from baseline)
- [ ] **Test Count**: ≥ baseline (or Δ ≥ +10% from baseline)

**Metrics Guide**: [code-refactoring skill](../code-refactoring/SKILL.md#validation)

### Test Validation

**Test Suite Health**:
- [ ] All tests passing (≥95% pass rate)
- [ ] No skipped tests (unless explicitly justified)
- [ ] Test execution time < 5 minutes
- [ ] No flaky tests (100% reproducible)

**Test Coverage**:
```bash
# Generate coverage report
npm run test:coverage

# Check coverage by component
npm run test:coverage -- --component GeminiLiveService
npm run test:coverage -- --component AudioCapture
```

**Acceptance Criteria**:
- [ ] Overall coverage ≥ 80%
- [ ] Critical components ≥ 90%
- [ ] No uncovered critical paths

### Build & Runtime Validation

**Build Validation**:
- [ ] Project builds successfully: `npm run build`
- [ ] No build warnings (or documented exceptions)
- [ ] Bundle size within acceptable limits

**Runtime Validation**:
- [ ] Application starts without errors
- [ ] No performance regression (measure key operations)
- [ ] No memory leaks (memory profile stable)

**Automated Checks**:
```bash
# Run all validation scripts
./scripts/validate-all.sh
# → Includes lint, test, build, metrics comparison
```

### Regression Detection

**Automated Regression Tests** (run weekly):
```bash
# Run full test suite with profiling
npm test -- --profiling

# Check for performance regressions
python scripts/check-regressions.py baseline/performance.json tests/performance.json

# Alert if regression detected
if regression_detected; then
    echo "⚠️ REGRESSION ALERT" | slack-notify
fi
```

**Alert Thresholds**:
- 🔴 **Red Alert**: Metric regresses by >10% from baseline
- 🟡 **Yellow Alert**: Metric regresses by 5-10% from baseline
- 🟢 **Green**: Metric stable or improving

**Regression Guide**: [code-refactoring skill](../code-refactoring/SKILL.md#regression-detection)

## Layer 2: Documentation Validation (documentation-management)

### Documentation Completeness

**Checklist**:
- [ ] API changes documented in API reference
- [ ] New classes/methods documented in guides
- [ ] Examples updated or added
- [ ] Changelog updated
- [ ] Breaking changes documented with migration guide

**Tool-Assisted Check**:
```bash
# Check for TODO/FIXME in docs
grep -r "TODO\|FIXME" docs/ --include="*.md"

# Check for outdated examples
./scripts/validate-examples.sh docs/

# Check all links resolve
python .claude/skills/documentation-management/tools/validate-links.py docs/
```

**Acceptance Criteria**:
- [ ] Zero TODO/FIXME in production code paths
- [ ] All examples tested and working
- [ ] All links resolve (no 404s)

### Documentation Quality

**Quality Checklist** (from documentation-management):
- [ ] **Accuracy**: Technical correctness verified
- [ ] **Completeness**: All user needs addressed
- [ ] **Usability**: Clear navigation, code examples
- [ ] **Maintainability**: Modular structure, no duplication

**Peer Review**:
- [ ] Reviewed by technical writer
- [ ] Reviewed by subject matter expert
- [ ] Reviewed by user advocate

## Layer 3: Process Validation (RLM)

### Plan Execution Fidelity

**Planned vs Actual**:
- [ ] Timeline: Planned [X]h vs Actual [Y]h (Δ: [Z]h)
- [ ] Scope: All objectives met? Yes/No/Partially
- [ ] Budget: Within budget? Yes/No (explain if over)

**Deviations**:
- [ ] All deviations documented with rationale
- [ ] Emergent work justified
- [ ] Cancelled work explained

### Stakeholder Feedback

**Survey/Interview Results**:
- [ ] Developer satisfaction: [Rating 1-5]
- [ ] User satisfaction: [Rating 1-5]
- [ ] Stakeholder confidence: [Rating 1-5]

**Qualitative Feedback**:
- **Positive**: [What went well?]
- **Negative**: [What didn't go well?]
- **Suggestions**: [What should we do differently?]

### Quality Gate Validation

**Check all 6 Quality Gates** (see RLM Quality Gates):
- [ ] **PROPOSAL Gate**: Approved with documented rationale ✅
- [ ] **PLANNING Gate**: Detailed plan with risk mitigation ✅
- [ ] **PREPARATION Gate**: Baseline captured, environment ready ✅
- [ ] **EXECUTION Gate**: All work completed, tests passing ✅
- [ ] **INTEGRATION Gate** (Pending): State updated, docs synced ✅
- [ ] **MONITORING Gate** (Pending): Metrics tracking established ✅

## Validation Decision

**Overall Status**: ✅ **VALIDATED** | ⚠️ **CONDITIONAL** | ❌ **FAILED**

### Scoring

**Layer 1: Technical** (Weight: 40%)
- Metrics comparison: [0-1 score]
- Test validation: [0-1 score]
- Build/Runtime: [0-1 score]
- **Technical Score**: [X]/3 → [percentage]%

**Layer 2: Documentation** (Weight: 30%)
- Completeness: [0-1 score]
- Quality: [0-1 score]
- Integration: [0-1 score]
- **Documentation Score**: [X]/3 → [percentage]%

**Layer 3: Process** (Weight: 30%)
- Fidelity: [0-1 score]
- Feedback: [0-1 score]
- Quality Gates: [0-1 score]
- **Process Score**: [X]/3 → [percentage]%

**Overall Score**: [Weighted sum] = [percentage]%

### Criteria

**VALIDATED** (all required):
- Technical score ≥ 80%
- Documentation score ≥ 70%
- Process score ≥ 70%
- All critical acceptance criteria met

**CONDITIONAL** (minor issues):
- Overall score ≥ 70% but < 80%
- Minor gaps that can be addressed post-integration
- No critical blockers

**FAILED** (blockers):
- Overall score < 70%
- Critical acceptance criteria not met
- Technical or documentation blockers
```

**Phase 5: INTEGRATION** (Architecture State Updates)
- **Deliverables**: State doc updates, evolution history added, **bi-directional links established**, migration guide
- **Template**: `templates/integration-phase-template.md`
- **Quality Gate**: State docs updated, **bi-directional links established**, migration guide available

**INTEGRATION Phase Structure** (Enhanced with code-refactoring integration):

```markdown
# INTEGRATION Phase: [Task Name]

## Layer 1: Code Integration (code-refactoring)

### Merge to Main Branch

**Pre-Merge Checklist**:
- [ ] All tests passing (≥95%)
- [ ] Code reviewed and approved
- [ ] Validation report approved
- [ ] Documentation updated
- [ ] No merge conflicts (or resolved)

**Merge Process**:
```bash
# 1. Update main branch
git checkout main
git pull origin main

# 2. Merge feature branch
git merge refactor/[task-name]

# 3. Resolve conflicts (if any)
# [Manual resolution]

# 4. Run full test suite
npm test

# 5. Build
npm run build

# 6. Push
git push origin main
```

### Tag Release

**Create Git Tag**:
```bash
# Tag the merge commit
git tag -a v[semantic-version] -m "Refactoring: [Task Name]"

# Push tag
git push origin v[semantic-version]
```

**Tag Format**:
- Major refactor: `v2.0.0` (breaking changes)
- Minor refactor: `v1.X.0` (new features)
- Patch refactor: `v1.X.Y` (bug fixes, optimizations)

**Integration Guide**: [code-refactoring skill](../code-refactoring/SKILL.md#integration)

### Post-Merge Validation

**Smoke Tests**:
- [ ] Verify main branch builds successfully
- [ ] Run smoke tests (≥ 95% pass rate)
- [ ] Monitor for 24 hours for issues

**Rollback Plan**:
- [ ] Document rollback procedure
- [ ] Test rollback (if critical system)
- [ ] Communicate rollback plan to team

## Layer 2: Documentation Integration (documentation-organization)

### Update State Documentation

**Add "Architecture Evolution History"** to affected state docs:
```markdown
## Architecture Evolution History

| Iteration | Date | State Change | Impact |
|-----------|------|-------------|--------|
| **[Task Name]** | YYYY-MM-DD | [What changed?] | [Impact] |

**Key Decision**: [Link to ADR if exists]
**Validation**: [Link to validation report]

---

## Previous Architecture State
- **[Previous State]**: [Description before this refactor]
- **Migration Guide**: [Link to migration guide if breaking]
```

**Affected Docs** (from VALIDATION phase):
- [ ] `docs/guides/[component1].md` - Add evolution history
- [ ] `docs/guides/[component2].md` - Add evolution history
- [ ] `docs/api/[api].md` - Update API reference

### Update Process Documentation

**Update Refactoring Tracking Docs**:
- [ ] `docs/refactoring/DASHBOARD.md` - Move to "Completed Phases"
- [ ] `docs/refactoring/status/implementation.md` - Update to 100%
- [ ] `docs/refactoring/TRACEABILITY.md` - Add Execution → State mapping

**Create Completion Report** (if not done in VALIDATION):
```bash
# Use template
cp docs/refactoring/reports/completion/_template.md \
   docs/refactoring/reports/completion/[task-name].md

# Fill in completion report
# Include "Impact on Architecture State" section
```

### Sync Documentation Structure

**Ensure Docs Follow Conventions**:
- [ ] Hierarchical organization (adr/, reports/, plans/, status/, summaries/)
- [ ] Naming convention: `[type]-[entity].[ext]`
- [ ] Cross-references: Related Work, Next Steps, Previous Work

**Validation**:
```bash
# Run doc structure validation
./scripts/validate-doc-structure.sh docs/

# Run cross-reference validation
./scripts/validate-crossrefs.sh docs/
```

## Layer 3: Team Integration (knowledge-transfer)

### Team Briefing

**Schedule team meeting** (30 minutes):
- **Agenda**:
  - What was done (5 min)
  - How it works (10 min)
  - Migration guide (if breaking) (10 min)
  - Q&A (5 min)

**Slides/Notes**:
- Create brief presentation (5-10 slides)
- Focus on: Why, What, How, Impact

**Record Meeting**:
- [ ] Meeting notes documented
- [ ] Decisions captured
- [ ] Action items assigned

### Knowledge Transfer

**For Critical Refactors** (breaking changes or complex logic):
- [ ] Pair programming sessions (2-3 hours)
- [ ] Code walkthrough (recorded, 30 minutes)
- [ ] Create "How-To" guide (if new workflow)

**For Routine Refactors**:
- [ ] Changelog entry
- [ ] Code review discussion (record comments)

## Integration Checklist

### Code Integration (All Required)
- [ ] Merged to main branch
- [ ] Tagged release
- [ ] Tests passing post-merge
- [ ] No regressions detected

### Documentation Integration (All Required)
- [ ] State docs updated with evolution history
- [ ] Process docs updated (dashboard, status, traceability)
- [ ] Completion report finalized
- [ ] API docs updated (if API changed)
- [ ] Examples updated (if behavior changed)

### Team Integration (All Required)
- [ ] Team briefing held
- [ ] Knowledge transfer completed
- [ ] Training materials created (if needed)
- [ ] Meeting notes documented
```

**Phase 6: MONITORING** (Post-Integration Monitoring)
- **Deliverables**: Monitoring period (7-30 days), metrics collected, issues document, stability assessment, recommendations
- **Template**: `templates/monitoring-phase-template.md`
- **Quality Gate**: Monitoring period complete, metrics stable, issues resolved, stakeholder sign-off

**MONITORING Phase Structure** (Enhanced with code-refactoring integration):

```markdown
# MONITORING Phase: [Task Name]

## Part 1: Process Monitoring (RLM)

### Usage Metrics

**Daily/Weekly Metrics** (collect automatically if possible):
- **Adoption Rate**: % of team using new code/workflow
- **Error Rate**: Errors encountered per [time period]
- **Performance**: [metric] vs baseline
- **Feedback**: Positive/negative feedback ratio

**Data Collection**:
```bash
# Automated metrics collection (if configured)
./scripts/collect-metrics.sh --period weekly > metrics/weekly-[date].json

# Manual feedback collection
# Link to feedback form: https://[survey-tool]
```

### Issue Tracking

**Report Issues**:
- [ ] Create issue in tracking system (GitHub, Jira, etc.)
- [ ] Categorize: Bug | Enhancement | Question
- [ ] Assign priority: P0 | P1 | P2 | P3
- [ ] Link to commit/PR if applicable

**Issue Log Template**:
```markdown
## Issue Log: [Task Name] Monitoring

### Open Issues
| ID | Title | Category | Priority | Status | Opened | Assignee |
|----|-------|----------|----------|--------|--------|----------|
| #1 | [Issue description] | Bug | P1 | 🚧 Open | YYYY-MM-DD | [Name] |
| #2 | [Issue description] | Enhancement | P2 | 📋 Planned | YYYY-MM-DD | [Name] |

### Resolved Issues
| ID | Title | Resolution | Closed | Duration |
|----|-------|------------|--------|----------|
| #3 | [Issue description] | [Fix description] | YYYY-MM-DD | 2 days |

### Issue Metrics
- Total issues: [count]
- Resolved: [count] ([X]%)
- Open: [count] ([Y]%)
- Average resolution time: [X] days
```

## Part 2: Performance Tracking (code-refactoring)

### Metrics Trend Analysis

**Weekly Metrics Comparison**:
```bash
# Capture weekly metrics
./scripts/capture-metrics.sh --period weekly > metrics/weekly-[date].json

# Compare to baseline
python scripts/analyze-trends.py metrics/baseline.json metrics/weekly-*.json
```

**Trend Report**:
| Metric | Baseline | Week 1 | Week 2 | Week 3 | Week 4 | Trend |
|--------|----------|--------|--------|--------|--------|-------|
| **Complexity** | 12 | 10 | 9 | 9 | 9 | ✅ Improving |
| **Coverage** | 65% | 70% | 75% | 78% | 80% | ✅ Improving |
| **Build Time** | 30s | 28s | 26s | 25s | 25s | ✅ Improving |
| **Test Runtime** | 45s | 42s | 40s | 40s | 40s | ✅ Stable |
| **Error Rate** | 2% | 1.5% | 1% | 0.8% | 0.5% | ✅ Improving |

**Alert Thresholds**:
- 🔴 **Red Alert**: Metric regresses by >10% from baseline
- 🟡 **Yellow Alert**: Metric regresses by 5-10% from baseline
- 🟢 **Green**: Metric stable or improving

**Performance Guide**: [code-refactoring skill](../code-refactoring/SKILL.md#monitoring)

### Regression Detection

**Automated Regression Tests** (run weekly):
```bash
# Run full test suite with profiling
npm test -- --profiling

# Check for performance regressions
python scripts/check-regressions.py baseline/performance.json tests/performance.json

# Alert if regression detected
if regression_detected; then
    echo "⚠️ REGRESSION ALERT" | slack-notify
fi
```

**Decision**:
- If regression detected → Return to EXECUTION phase (fix regression)
- If stable for 4 weeks → Extend monitoring period or close monitoring

## Part 3: Documentation Health (documentation-organization)

### Link Validation

**Weekly Link Check**:
```bash
# Check all internal links resolve
python .claude/skills/documentation-management/tools/validate-links.py docs/

# Check for orphaned pages (no incoming links)
python scripts/find-orphans.sh docs/
```

**Link Health Report**:
- Total links: [count]
- Broken links: [count] ([X]%)
- Orphaned pages: [count] ([Y]%)
- Fixed this week: [count]

### Content Freshness

**Outdated Content Detection**:
```bash
# Check for TODO/FIXME in docs
grep -r "TODO\|FIXME" docs/ --include="*.md" | wc -l

# Check for outdated version references
grep -r "version X.Y" docs/ --include="*.md" | grep -v "version [current]"
```

**Freshness Metrics**:
- TODO/FIXME count: [count] (target: 0)
- Outdated version refs: [count] (target: 0)
- Last updated: [date] (target: within last 3 months)

## Part 4: Feedback Loop (RLM)

### Continuous Improvement

**Weekly Feedback Survey** (send to team):
```markdown
## Weekly Feedback: [Task Name]

**Week**: [N]

**Performance**:
1. How is the new code/workflow working? [1-5]
2. Have you encountered any issues? [Yes/No]
   - If yes, please describe: [...]

**Documentation**:
3. Is the documentation clear and helpful? [1-5]
4. What's missing or confusing? [Open feedback]

**Suggestions**:
5. What should we improve?

**Overall**:
6. Would you recommend this refactor to others? [Yes/No]
7. Any other feedback? [Open feedback]
```

**Feedback Analysis**:
- Collect feedback (weekly or bi-weekly)
- Categorize: Praise | Problem | Suggestion
- Identify trends: Same issue mentioned 3+ times?
- Prioritize improvements

### Iteration Planning

**From Monitoring to PROPOSAL** (Feedback Loop):

**Issue Identified** (from monitoring data):
- **Problem**: [What's the problem?]
- **Frequency**: [How often does it occur?]
- **Impact**: [What's the impact?]

**Decision**: Create new proposal?
- ✅ **Yes**: Create new PROPOSAL for improvement iteration
  - [ ] Create proposal (use PROPOSAL template)
  - [ ] Go through TECHNICAL ASSESSMENT
  - [ ] Create refined plan
  - [ ] Execute improvement iteration
- ❌ **No**: Document issue, add to known issues list
  - [ ] Add to Issue Log
  - [ ] Monitor if worsens
  - [ ] Reassess in [time period]
```

### Bi-Directional Traceability

**Forward Traceability** (Process → State):
- **Question**: "Which state docs did this refactoring update?"
- **Implementation**: Completion report has "Impact on Architecture State" section
- **Example**:
  ```markdown
  ## Impact on Architecture State

  **State Docs Updated**:
  - `guides/state-inspection.md` (added 5-layer inspector documentation)
  - `CLAUDE.md` (added Stage-Pipeline architecture section)

  **Code Artifacts**:
  - `src/pipeline/stages/StateInspectorStage.ts` (new)
  - `src/pipeline/stages/__tests__/StateInspectorStage.test.ts` (113 tests)
  ```

**Backward Traceability** (State → Process):
- **Question**: "Which refactoring added this feature?"
- **Implementation**: State doc has "Architecture Evolution History" section
- **Example**:
  ```markdown
  ## Architecture Evolution History

  **Current State**: ✅ Implemented (Iterations 5.1-5.7, 2025-01-XX)

  | Iteration | Date | State Change | Impact |
  |-----------|------|-------------|--------|
  | **5.4** | 2025-01-XX | State inspection system | 5-layer inspector |
  | **5.6** | 2025-01-XX | Web integration | Dual-mode architecture |

  **Key Decision**: [ADR-001: Stage-Pipeline Architecture](../refactoring/adr/001-stage-pipeline.md)
  ```

### Plan-Execution Alignment

**Problem**: Plans are speculative, execution often deviates (60% deviation baseline)

**RLM Solution**:
1. **Document Deviations**: When plan changes, document why
2. **Track Emergent Work**: Separate planned vs emergent work
3. **Update Plans Regularly**: Keep plans current with reality
4. **Accept Uncertainty**: Plan deviation is normal, not failure

**Example**: Traceability Matrix Plan → Execution table
```markdown
| Planned Iteration | Actual Execution | Status | Deviation Reason |
|-------------------|------------------|--------|------------------|
| Iteration 5.1-5.7 | Stage-Pipeline | ⚠️ Emergent | Not in original plan (technical discovery) |
```

---

## Management Tools

### Refactoring Dashboard

**Location**: `docs/refactoring/DASHBOARD.md`
**Template**: `templates/dashboard-template.md`
**Purpose**: Single entry point for refactoring progress

**Key Sections** (9 total):
1. **Quick Stats**: Overall progress, hours spent, test pass rate
2. **Phase Status**: Completed, In Progress, Planned
3. **Recent Activity**: Last 7 days activity log
4. **Upcoming Work**: Next 7 days planned work
5. **Test Coverage**: Visual chart of test growth
6. **Architecture Evolution Timeline**: Phase timeline
7. **Blocked Items**: Active blockers
8. **Risks & Issues**: Active risks
9. **Quick Links**: All key docs

**Update Frequency**: After each phase completion
**Time to Update**: 10-15 minutes (extract from source docs)
**Impact**: Stakeholders understand progress in <5 minutes

### Traceability Matrix

**Location**: `docs/refactoring/TRACEABILITY.md`
**Template**: `templates/traceability-matrix-template.md`
**Purpose**: Bi-directional mapping between plans, executions, and state

**Key Tables** (4 total):
1. **Plan → Execution**: Which plans were executed?
2. **Execution → State**: What state changes resulted?
3. **State → Documentation**: Which docs describe the state?
4. **Decision → Architecture**: Which ADRs affected architecture?

**Update Frequency**: After each phase completion
**Time to Update**: 20-30 minutes (add rows to tables)
**Impact**: 20-second lookups (vs 3-4 minutes without matrix)

### Quality Gates

**Location**: `templates/quality-gates-template.md`
**Purpose**: Checkpoints ensuring completeness before phase transitions

**6 Quality Gates**:
1. **PROPOSAL → PLANNING**: Problem clarity, solution completeness, impact quantified
2. **PLANNING → EXECUTION**: Objectives SMART, scope bounded, tasks decomposed
3. **EXECUTION → VALIDATION**: Code quality, test coverage, **bi-directional traceability**
4. **VALIDATION → INTEGRATION**: Tests passed, no regressions, rollback plan tested
5. **INTEGRATION → MONITORING**: State docs updated, **bi-directional links established**
6. **MONITORING → COMPLETE**: Metrics stable, issues resolved, stakeholder sign-off

**Target**: ≥90% gate pass rate (≤10% bypasses)
**Approval Process**: Required approvers (tech lead, QA lead, engineering manager)
**Bypass Procedure**: Emergency bypass with approval and completion date

---

## Measurement and Metrics

### V_instance: Domain-Specific Quality

**Definition**: How well RLM manages refactoring for your project

**Formula**:
```
V_instance = 0.25×Alignment + 0.25×Traceability + 0.25×Discovery + 0.25×Visibility
```

**Components**:
1. **Alignment (0.25)**: Plan-execution fit
   - Target: ≥0.85 (85% alignment)
   - Baseline: ~0.40

2. **Traceability (0.25)**: Bi-directional linking
   - Target: ≥0.90 (90% coverage)
   - Baseline: ~0.21

3. **Discovery (0.25)**: Time to find information
   - Target: ≤30 seconds per query
   - Baseline: ~3-5 minutes

4. **Visibility (0.25)**: Stakeholder comprehension
   - Target: ≤5 minutes for full picture
   - Baseline: ~20-30 minutes

**Overall Target**: V_instance ≥ 0.80

### V_meta: Methodology Quality

**Definition**: How well RLM works as a reusable framework

**Formula**:
```
V_meta = 0.25×Completeness + 0.25×Effectiveness + 0.25×Reusability + 0.25×Validation
```

**Components**:
1. **Completeness (0.25)**: Full methodology documentation
   - Target: ≥0.85 (all components present)

2. **Effectiveness (0.25)**: Measurable improvement
   - Target: ≥0.80 (80% of potential realized)

3. **Reusability (0.25)**: Transfer to other projects
   - Target: ≥0.85 (85% generalizable)

4. **Validation (0.25)**: Empirical evidence
   - Target: ≥0.80 (strong metrics and data)

**Overall Target**: V_meta ≥ 0.80

### Convergence Criteria

**Primary Convergence**:
- V_instance ≥ 0.80 **AND** V_meta ≥ 0.80

**Secondary Convergence** (Stability):
- System stable: ΔV < 0.02 for 2 iterations
- Objectives complete: All methodology components implemented

**Expected Timeline**:
- Best case: 3 iterations (baseline + 2 improvements)
- Typical case: 4 iterations
- Worst case: 5+ iterations

---

## Examples

See `examples/` directory for real examples from gemini-live-scribe project:
- `examples/gemini-live-scribe-dashboard.md` - Complete dashboard (650 lines)
- `examples/gemini-live-scribe-traceability.md` - Complete traceability matrix (950 lines)
- `examples/completion-report-with-state-impact.md` - EXECUTION phase example
- `examples/state-doc-with-evolution-history.md` - State doc example

### Key Results (gemini-live-scribe)

**Baseline (Iteration 0)**:
- V_instance = 0.25 (weak alignment, poor traceability, slow discovery, no visibility)
- V_meta = 0.00 (no methodology)

**Iteration 1**: Core Methodology (8 hours)
- Created 6 lifecycle phase templates (~13,500 lines)
- Created refactoring dashboard (650 lines)
- Created traceability matrix (950 lines)
- **Results**: V_instance = 0.50 (+0.25, +100%), V_meta = 0.35

**Iteration 2**: Quality Gates (10 hours)
- Defined all 6 quality gates (500 lines)
- Created RLM methodology guide (500+ lines)
- **Results**: V_instance = 0.48 (conservative), V_meta = 0.60 (+0.25)

**Iteration 3**: Validation (8 hours) ✅ CONVERGED
- Validated discovery queries (10.9x faster: 180s → 16.5s)
- Documented plan deviations (alignment +0.20)
- **Results**: V_instance = 0.82 (+0.34), V_meta = 0.85 (+0.25) ✅

**Total Duration**: 36 hours (3 iterations)
**Convergence**: Best case (3 iterations)

---

## Validation

### Quality Checklist

Use this checklist to validate RLM adoption:

**Phase Templates**:
- [ ] All 6 lifecycle templates created
- [ ] Templates customized for your project (examples, terminology)
- [ ] Team trained on template usage

**Dashboard**:
- [ ] Dashboard created with all 9 sections
- [ ] Dashboard populated with current data
- [ ] Update process defined (after each phase completion)

**Traceability Matrix**:
- [ ] Matrix created with all 4 tables
- [ ] Bi-directional links established (≥40 links)
- [ ] Update process defined (after each phase completion)

**Quality Gates**:
- [ ] All 6 quality gates defined
- [ ] Approvers identified (tech lead, QA lead, engineering manager)
- [ ] Bypass process documented

**Bi-Directional Traceability**:
- [ ] Completion reports have "Impact on Architecture State" sections
- [ ] State docs have "Architecture Evolution History" sections
- [ ] Links verified (click and test)

**Skill Integration**:
- [ ] Skill Integration section reviewed
- [ ] Related skills understood (code-refactoring, doc-mgmt, doc-org)
- [ ] Integration workflow followed

**Metrics**:
- [ ] Baseline V_instance measured
- [ ] V_instance ≥ 0.70 (first iteration target)
- [ ] V_meta ≥ 0.60 (first iteration target)

### Success Criteria

**Minimum Viable Adoption** (V_instance ≥ 0.60):
- Dashboard created and populated
- Traceability matrix created (≥60% coverage)
- 3-5 completion reports with state impact sections
- 2-3 state docs with evolution history

**Full Adoption** (V_instance ≥ 0.80, V_meta ≥ 0.80):
- All 6 templates in use
- Dashboard and matrix comprehensive
- Quality gates defined and enforced
- Bi-directional traceability ≥85%
- Discovery efficiency ≤30 seconds per query
- Skill integration established

---

## Reference Materials

See `reference/` directory for detailed documentation:
- `reference/RLM_METHODOLOGY.md` - Complete methodology guide (1000+ lines)
- `reference/QUALITY_GATES.md` - Quality gate definitions (500 lines)
- `reference/ITERATION_3_CONVERGENCE.md` - Convergence validation report

### Related Skills

- **code-refactoring**: Technical methods for code refactoring (TDD, patterns, metrics)
  - Integration: Used in EXECUTION, VALIDATION, INTEGRATION, MONITORING phases
  - Location: [code-refactoring SKILL.md](../code-refactoring/SKILL.md)
  - Quick Start: See "Quick Start with RLM" section in code-refactoring skill

- **methodology-bootstrapping**: Parent framework for BAIME experiments
  - Integration: RLM is a validated methodology from BAIME
  - Location: [methodology-bootstrapping SKILL.md](../methodology-bootstrapping/SKILL.md)

- **documentation-management**: Complementary documentation quality methodology
  - Integration: Used for completion reports, documentation validation
  - Location: [documentation-management SKILL.md](../documentation-management/SKILL.md)

- **documentation-organization**: Complementary documentation organization methodology
  - Integration: Used for structure validation, evolution history
  - Location: [documentation-organization SKILL.md](../documentation-organization/SKILL.md)

---

**Skill Status**: ✅ Enhanced with Skill Integration
**Version**: 1.1 (Integration Updates)
**V_instance**: 0.82 (103% of 0.80 target)
**V_meta**: 0.85 (106% of 0.80 target)
**Integration**: Bidirectional references to code-refactoring, doc-mgmt, doc-org
**Validation**: 3 iterations of empirical evidence + skill integration testing
**Transferability**: 90% generalizable (10% project-specific examples)
**Last Updated**: 2026-01-22 (Iteration 1: RLM Skill Integration Updates)
