# RLM Templates

This directory contains copy-paste templates for all 6 lifecycle phases plus management tools.

## Lifecycle Phase Templates

### 1. PROPOSAL Phase Template
**File**: `proposal-phase-template.md`
**Purpose**: Identify refactoring need, propose solution, assess impact
**When to Use**: Starting a new refactoring initiative
**Key Sections**: Problem Statement, Proposed Solution, Impact Assessment, Alternatives Considered, Recommendation
**Quality Gate**: Gate 1 (PROPOSAL → PLANNING)

### 2. PLANNING Phase Template
**File**: `planning-phase-template.md`
**Purpose**: Create detailed execution plan
**When to Use**: After proposal approved, before starting implementation
**Key Sections**: Objectives (SMART), Scope, Phases, Tasks, Estimates, Dependencies, Risks, Success Criteria
**Quality Gate**: Gate 2 (PLANNING → EXECUTION)

### 3. EXECUTION Phase Template
**File**: `execution-phase-template.md`
**Purpose**: Document refactoring implementation
**When to Use**: After implementation complete, before validation
**Key Sections**: Executive Summary, Objectives vs Results, Work Completed, Code Artifacts, **Impact on Architecture State**, Documentation Updates, Test Results, Lessons Learned
**Quality Gate**: Gate 3 (EXECUTION → VALIDATION)
**Critical**: "Impact on Architecture State" section required for bi-directional traceability

### 4. VALIDATION Phase Template
**File**: `validation-phase-template.md`
**Purpose**: Validate refactoring with comprehensive testing
**When to Use**: After execution complete, before integration
**Key Sections**: Validation Summary, Test Coverage, Performance Validation, Regression Testing, Known Issues, Approval Status
**Quality Gate**: Gate 4 (VALIDATION → INTEGRATION)

### 5. INTEGRATION Phase Template
**File**: `integration-phase-template.md`
**Purpose**: Update architecture state and documentation
**When to Use**: After validation passed, before deployment
**Key Sections**: State Changes, Documentation Updates, Evolution History Added, Migration Guide, Rollback Plan
**Quality Gate**: Gate 5 (INTEGRATION → MONITORING)
**Critical**: Bi-directional links required (completion report → state docs, state docs → completion report)

### 6. MONITORING Phase Template
**File**: `monitoring-phase-template.md`
**Purpose**: Monitor stability post-deployment
**When to Use**: After deployment, during monitoring period (7-30 days)
**Key Sections**: Monitoring Period, Metrics Collected, Issues Found, Resolutions, Stability Assessment, Recommendations
**Quality Gate**: Gate 6 (MONITORING → COMPLETE)

## Management Tool Templates

### 7. Dashboard Template
**File**: `dashboard-template.md`
**Purpose**: Single entry point for refactoring progress
**Sections** (9 total):
1. Quick Stats (overall progress, hours spent, test pass rate)
2. Phase Status (completed, in progress, planned)
3. Recent Activity (last 7 days activity log)
4. Upcoming Work (next 7 days planned work)
5. Test Coverage (visual chart of test growth)
6. Architecture Evolution Timeline (phase timeline)
7. Blocked Items (active blockers)
8. Risks & Issues (active risks)
9. Quick Links (all key docs)

**Update Frequency**: After each phase completion
**Time to Update**: 10-15 minutes

### 8. Traceability Matrix Template
**File**: `traceability-matrix-template.md`
**Purpose**: Bi-directional mapping between plans, executions, and state
**Tables** (4 total):
1. Plan → Execution (which plans were executed?)
2. Execution → State (what state changes resulted?)
3. State → Documentation (which docs describe the state?)
4. Decision → Architecture (which ADRs affected architecture?)

**Update Frequency**: After each phase completion
**Time to Update**: 20-30 minutes

### 9. Quality Gates Template
**File**: `quality-gates-template.md`
**Purpose**: Checkpoints ensuring completeness before phase transitions
**Gates** (6 total):
1. PROPOSAL → PLANNING (problem clarity, solution completeness)
2. PLANNING → EXECUTION (objectives SMART, tasks decomposed)
3. EXECUTION → VALIDATION (code quality, **bi-directional traceability**)
4. VALIDATION → INTEGRATION (tests passed, no regressions)
5. INTEGRATION → MONITORING (state docs updated, **bi-directional links**)
6. MONITORING → COMPLETE (metrics stable, issues resolved)

**Target**: ≥90% gate pass rate

## How to Use Templates

### Step 1: Read the Template
- Read template before starting phase
- Templates include required sections (marked **bold**)
- Templates include examples from real projects
- Templates include placeholder text (`[Like this]`)

### Step 2: Create New Doc from Template
```bash
# Example: Create EXECUTION phase report
cp templates/execution-phase-template.md docs/refactoring/reports/completion/iteration-5.8.md
```

### Step 3: Customize for Your Project
- Replace placeholder text with actual content
- Update examples to match your project
- Add project-specific sections if needed
- Remove optional sections if not applicable

### Step 4: Validate Completeness
- Use quality checklist from template
- Ensure all required sections complete
- Get approval before proceeding to next phase

## Template Structure

### Required Sections (marked **bold**)
Must be included in every report. Essential for bi-directional traceability.

### Optional Sections
Include if applicable to your refactoring. Examples:
- Database Migration (only if database changed)
- A/B Testing (only if user-facing changes)
- Performance Testing (only if performance-critical)

### Examples
Templates include real examples from gemini-live-scribe project. Customize them for your project.

## Tips for Success

**DO**:
- Read template before starting phase
- Use all required sections
- Replace placeholder text with actual content
- Customize examples for your project
- Follow template structure (don't skip sections)

**DON'T**:
- Use template as checklist only (read the full template)
- Skip required sections (they're required for a reason)
- Leave placeholder text unfilled
- Copy examples verbatim (customize them)
- Reorder template sections (structure is intentional)

## Related Documentation

- **SKILL.md**: Main methodology overview
- **README.md**: Quick start guide
- **reference/RLM_METHODOLOGY.md**: Complete methodology (1000+ lines)
- **reference/QUALITY_GATES.md**: Quality gate definitions (500 lines)
- **examples/**: Real examples from gemini-live-scribe project

---

**Template Status**: ✅ All templates defined and validated
**Total Templates**: 9 (6 lifecycle phases + 3 management tools)
**Total Lines**: ~13,500 lines of template content
