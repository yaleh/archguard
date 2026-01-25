# Quality Gates for Refactoring Lifecycle Management

**Purpose**: Define checkpoints for each phase transition to ensure quality and completeness

**Version**: 1.0
**Date**: 2026-01-22
**Status**: ✅ Defined

---

## Overview

**Quality Gates** are checkpoints that must be passed before transitioning from one lifecycle phase to the next. Each gate has specific criteria, approval processes, and bypass procedures.

**Why Quality Gates Matter**:
- Prevent premature phase transitions
- Ensure all deliverables are complete
- Maintain consistency across refactoring iterations
- Enable stakeholder confidence
- Reduce rework and technical debt

---

## Gate 1: PROPOSAL → PLANNING

**Purpose**: Validate that the refactoring proposal is well-defined and justified

### Entry Criteria

- PROPOSAL phase document created using `proposal-phase-template.md`
- Problem statement clearly defined
- Proposed solution articulated
- Impact assessment completed

### Quality Checklist

- [ ] **Problem Clarity**: Problem statement is specific, measurable, and actionable
  - Not vague: "Performance is slow"
  - Clear: "API response time exceeds 2s P95, causing 15% user drop-off"

- [ ] **Solution Completeness**: Proposed solution addresses all aspects of the problem
  - Technical approach defined
  - Architectural changes described
  - Dependencies identified

- [ ] **Impact Quantification**: Impact assessment includes concrete metrics
  - Expected improvement (e.g., "Response time <500ms P95")
  - Risk assessment (likelihood × impact)
  - Rollback plan defined

- [ ] **Alternative Analysis**: At least 2 alternatives considered and documented
  - Alternative 1: [Description + why rejected]
  - Alternative 2: [Description + why rejected]
  - Chosen solution: [Why this is best]

- [ ] **Stakeholder Alignment**: Key stakeholders reviewed and agree on proposal
  - Tech lead approval
  - Product manager awareness (if user-facing)
  - Architecture team review (if cross-system)

### Approval Process

**Required Approvers**:
- Technical Lead: ✅ Approve
- Architecture Owner: ✅ Approve (for architectural changes)

**Optional Approvers**:
- Product Manager (for user-facing changes)
- Security Team (for security-sensitive changes)

### Bypass Procedure

**Emergency Bypass** (e.g., hotfix, critical bug):
1. Document why gate bypassed
2. List missing criteria
3. Get tech lead + architecture owner approval
4. Complete missing criteria within 5 business days

**Example Entry**:
```markdown
### Gate 1 Bypass
**Reason**: Hotfix for critical API outage (P0 incident)
**Missing Criteria**: Alternative analysis not completed
**Approval**: Tech Lead (Jane), Architecture Owner (John)
**Completion Date**: 2026-01-25 (3 days)
```

---

## Gate 2: PLANNING → EXECUTION

**Purpose**: Validate that the execution plan is detailed, feasible, and resourced

### Entry Criteria

- PLANNING phase document created using `planning-phase-template.md`
- Proposal approved via Gate 1
- Detailed plan with tasks, estimates, and dependencies

### Quality Checklist

- [ ] **Objectives SMART**: Objectives are Specific, Measurable, Achievable, Relevant, Time-bound
  - Example: "Reduce API response time from 2s to <500ms P95 within 2 weeks"

- [ ] **Scope Bounded**: Scope clearly defined with in-scope and out-of-scope items
  - In-scope: API endpoint optimization, caching layer
  - Out-of-scope: Database migration (deferred to Phase 2)

- [ ] **Task Breakdown**: Tasks decomposed to ≤1 day increments
  - Bad: "Implement caching" (5 days)
  - Good: "Design cache schema" (4h), "Implement cache layer" (8h), "Write tests" (4h)

- [ ] **Estimates Realistic**: Time estimates based on historical data or expert judgment
  - Include buffer (20% for uncertain tasks)
  - Account for testing, documentation, review
  - Example: "Implement caching: 16h (12h implementation + 4h testing)"

- [ ] **Dependencies Mapped**: All dependencies identified and tracked
  - Technical dependencies (e.g., "Requires database schema approval")
  - Resource dependencies (e.g., "Needs DBA time")
  - External dependencies (e.g., "API gateway available on 2026-01-25")

- [ ] **Risks Assessed**: Top 3-5 risks identified with mitigation plans
  - Risk 1: Cache invalidation complexity → Mitigation: Use TTL-based eviction
  - Risk 2: Increased memory usage → Mitigation: Monitor memory, set limits

- [ ] **Success Criteria Defined**: Measurable acceptance criteria
  - Example: "P95 response time <500ms sustained over 7 days"

- [ ] **Resources Allocated**: Team members assigned and available
  - Engineer assignments
  - Review time booked
  - Testing environment available

### Approval Process

**Required Approvers**:
- Technical Lead: ✅ Approve plan feasibility
- Engineering Manager: ✅ Approve resource allocation

**Optional Approvers**:
- Product Manager (for timeline commitment)
- QA Lead (for test strategy)

### Bypass Procedure

**Emergency Bypass** (e.g., expedited critical fix):
1. Document why gate bypassed
2. Outline revised plan (minimum viable plan)
3. Get tech lead + engineering manager approval
4. Complete full planning retrospective within 3 business days

---

## Gate 3: EXECUTION → VALIDATION

**Purpose**: Validate that implementation is complete, tested, and documented

### Entry Criteria

- EXECUTION phase completion report created using `execution-phase-template.md`
- All tasks completed per plan
- Code merged to main branch
- Completion report filed

### Quality Checklist

- [ ] **Code Quality**: All code meets project standards
  - Linting: No errors, warnings addressed or justified
  - Code review: At least 1 approving review from senior engineer
  - Style guide: Follows project conventions (naming, formatting, etc.)

- [ ] **Test Coverage**: Comprehensive test coverage per project thresholds
  - Unit tests: ≥80% line coverage (or project-specific threshold)
  - Integration tests: Critical paths covered
  - Edge cases: Error handling, boundary conditions tested
  - Test pass rate: 100% (no skipped tests without justification)

- [ ] **Documentation Complete**: All documentation updated
  - **Required**: "Impact on Architecture State" section in completion report
    - List all state docs updated (guides, specs, CLAUDE.md)
    - List all code artifacts (files modified/created)
    - Link to state docs (bi-directional)
  - API documentation (if API changed)
  - User-facing docs (if user-visible change)
  - Architecture docs (if architectural change)

- [ ] **Bi-Directional Traceability**: Links established both ways
  - Forward: Completion report → State docs updated
  - Backward: State docs → Completion report link in evolution history

- [ ] **Performance Acceptable**: Performance meets success criteria
  - Baseline metrics recorded
  - Post-implementation metrics meet targets
  - No regressions in other areas

- [ ] **No Known Regressions**: Regression testing passed
  - Existing tests still pass (100% pass rate)
  - Manual testing of critical paths completed
  - No new warnings or errors

- [ ] **Completion Report Filed**: Completion report follows `execution-phase-template.md`
  - Executive summary present
  - Objectives vs Results table filled
  - "Impact on Architecture State" section complete
  - Lessons learned documented

### Approval Process

**Required Approvers**:
- Code Reviewer: ✅ Approve code quality
- QA Engineer: ✅ Approve test coverage
- Technical Lead: ✅ Approve completion report

**Self-Approval** (for small changes):
- Engineer can self-approve if: <500 lines changed, low risk, all tests pass, tech lead notified

### Bypass Procedure

**Emergency Bypass** (e.g., urgent production fix):
1. Document why gate bypassed
2. List missing criteria (e.g., "Test coverage at 70% vs 80% target")
3. Get tech lead + QA lead approval
4. Complete missing criteria within 7 business days

---

## Gate 4: VALIDATION → INTEGRATION

**Purpose**: Validate that refactoring is safe to integrate and deploy

### Entry Criteria

- VALIDATION phase report created using `validation-phase-template.md`
- All validation tests passed
- Performance validated
- No critical issues

### Quality Checklist

- [ ] **Validation Tests Passed**: All acceptance tests pass
  - Functional tests: All success criteria met
  - Performance tests: Metrics meet targets (e.g., P95 <500ms)
  - Stress tests: System stable under load
  - Security tests: No new vulnerabilities

- [ ] **No Regressions**: Existing functionality unaffected
  - Regression test suite: 100% pass rate
  - Manual smoke tests: Critical paths work
  - User acceptance: No complaints (if user-facing)

- [ ] **Performance Validated**: Performance meets success criteria
  - Baseline comparison: Show before/after metrics
  - Sustained performance: Metrics stable over time (e.g., 7 days)
  - Resource usage: No excessive memory/CPU/IO

- [ ] **Known Issues Documented**: All known issues listed with severity
  - Critical issues: 0 (block integration)
  - High issues: 0 (block integration)
  - Medium issues: Documented, timeline for fix
  - Low issues: Backlog

- [ ] **Rollback Plan Tested**: Rollback procedure validated
  - Rollback tested in staging
  - Rollback time <5 minutes (or project-specific target)
  - Data migration reversible (if applicable)

- [ ] **Stakeholder Notification**: Key stakeholders aware of upcoming integration
  - Tech lead notified
  - Engineering manager notified
  - Product manager notified (if user-facing)
  - Support team notified (if production change)

- [ ] **Deployment Plan Ready**: Integration plan documented
  - Deployment steps documented
  - Deployment window scheduled
  - On-call engineer assigned

### Approval Process

**Required Approvers**:
- QA Lead: ✅ Approve validation results
- Technical Lead: ✅ Approve integration readiness
- Engineering Manager: ✅ Approve deployment schedule

**Optional Approvers**:
- Product Manager (for user-facing changes)
- Security Team (for security-sensitive changes)

### Bypass Procedure

**Emergency Bypass** (e.g., critical hotfix deployment):
1. Document why gate bypassed (e.g., "Validation tests incomplete due to time pressure")
2. List outstanding validation tasks
3. Get tech lead + QA lead + engineering manager approval
4. Complete full validation within 5 business days post-deployment

---

## Gate 5: INTEGRATION → MONITORING

**Purpose**: Validate that integration is complete and state docs updated

### Entry Criteria

- INTEGRATION phase complete using `integration-phase-template.md`
- Code deployed to target environment
- Architecture state docs updated
- Migration guide available (if breaking change)

### Quality Checklist

- [ ] **State Docs Updated**: All architecture state documents reflect new state
  - Guides updated (e.g., `guides/audio-processing.md`)
  - Specs updated (e.g., `specs/implemented/transcription-pipeline.md`)
  - CLAUDE.md updated (if architecture changed)
  - Evolution history added to state docs (backward traceability)

- [ ] **Bi-Directional Links Established**: Links work both ways
  - Completion report → State doc: Links in "Impact on Architecture State" section
  - State doc → Completion report: Links in "Architecture Evolution History" section

- [ ] **Migration Guide Available** (if breaking change):
  - Migration steps documented
  - Breaking changes listed
  - Rollback instructions included

- [ ] **Rollback Plan Validated**: Rollback tested and documented
  - Rollback steps in migration guide
  - Rollback tested in staging
  - Rollback time <5 minutes (or project-specific target)

- [ ] **Communication Complete**: Stakeholders informed of integration
  - Deployment notification sent
  - Breaking changes communicated (if any)
  - Support team trained (if user-facing)

- [ ] **Integration Report Filed**: Integration phase report complete
  - State changes listed
  - Documentation updates listed
  - Migration guide referenced

### Approval Process

**Required Approvers**:
- Technical Lead: ✅ Approve state doc updates
- Documentation Owner: ✅ Approve doc quality

**Self-Approval** (for minor doc updates):
- Engineer can self-approve if: Typos, minor clarifications, no architectural changes

### Bypass Procedure

**Emergency Bypass** (e.g., urgent fix, minor doc update):
1. Document why gate bypassed (e.g., "State doc update delayed due to doc owner availability")
2. List missing doc updates
3. Get tech lead approval
4. Complete doc updates within 3 business days

---

## Gate 6: MONITORING → COMPLETE

**Purpose**: Validate that refactoring is stable and ready for closure

### Entry Criteria

- MONITORING phase complete using `monitoring-phase-template.md`
- Monitoring period completed (e.g., 7-30 days)
- Stability assessment completed
- No critical issues

### Quality Checklist

- [ ] **Monitoring Period Complete**: Required monitoring time elapsed
  - Minimum: 7 days (for non-critical changes)
  - Standard: 14 days (for typical changes)
  - Extended: 30 days (for high-risk or user-visible changes)

- [ ] **Metrics Stable**: Performance metrics stable over monitoring period
  - No anomalies (e.g., sudden latency spikes)
  - Metrics meet success criteria
  - No degradations in other areas

- [ ] **Issues Resolved**: All issues from monitoring period addressed
  - Critical issues: 0 and no new ones
  - High issues: 0 (or resolved with workaround)
  - Medium issues: Resolved or in backlog with timeline
  - Low issues: Backlog or wontfix (documented)

- [ ] **Stability Assessment Positive**: System is stable
  - No crashes or panics
  - Error rate within acceptable bounds
  - User complaints: 0 (if user-facing)

- [ ] **Monitoring Report Filed**: Monitoring phase report complete
  - Metrics collected listed
  - Issues found documented
  - Resolutions documented
  - Stability assessment provided

- [ ] **Recommendations Documented**: Future improvements or follow-ups identified
  - Known limitations documented
  - Future optimization opportunities listed
  - Next evolution proposed (if applicable)

- [ ] **Stakeholder Sign-Off**: Key stakeholders agree refactoring is complete
  - Tech lead: ✅ Approve closure
  - Engineering manager: ✅ Approve closure

### Approval Process

**Required Approvers**:
- Technical Lead: ✅ Approve monitoring results
- Engineering Manager: ✅ Approve closure

**Optional Approvers**:
- Product Manager (for user-facing changes)
- Architecture Owner (for architectural changes)

### Bypass Procedure

**Early Closure** (e.g., low-risk change, stable in 3 days):
1. Document why monitoring period shortened
2. Provide evidence of stability (e.g., "100% test pass, no user complaints")
3. Get tech lead + engineering manager approval
4. Continue monitoring (informal) for full period

---

## Quality Gate Metrics

### Gate Pass Rate

Track how often gates are passed vs bypassed:

```
Gate Pass Rate = (Gates Passed) / (Gates Passed + Gates Bypassed)
```

**Target**: ≥90% pass rate (≤10% bypasses)

### Gate Bottleneck Analysis

Track which gates have highest bypass rate:

| Gate | Passed | Bypassed | Bypass Rate | Top Bypass Reasons |
|------|--------|----------|-------------|-------------------|
| Gate 1: PROPOSAL → PLANNING | 8 | 1 | 11% | Emergency hotfix |
| Gate 2: PLANNING → EXECUTION | 7 | 2 | 22% | Expedited critical fix |
| Gate 3: EXECUTION → VALIDATION | 9 | 0 | 0% | N/A |
| Gate 4: VALIDATION → INTEGRATION | 8 | 1 | 11% | Time pressure |
| Gate 5: INTEGRATION → MONITORING | 9 | 0 | 0% | N/A |
| Gate 6: MONITORING → COMPLETE | 10 | 0 | 0% | Early closure (3x) |

**Target**: All gates ≤15% bypass rate

### Common Bypass Reasons

Track why gates are bypassed:

1. **Emergency Hotfix**: Time-critical production issue (acceptable)
2. **Expedited Critical Fix**: High-priority bug (acceptable with justification)
3. **Resource Availability**: Reviewer unavailable (process issue, address)
4. **Time Pressure**: Unrealistic deadline (planning issue, address)
5. **Incomplete Documentation**: Doc writer unavailable (process issue, address)

---

## Using Quality Gates

### For Engineers

**Before Submitting Gate Review**:
1. Complete quality checklist (all checkboxes ticked)
2. Attach evidence (e.g., test results, metrics)
3. Document any exceptions (why checklist item not met)
4. Request approvals from required approvers

**During Gate Review**:
1. Reviewers verify checklist completion
2. Reviewers check evidence
3. Reviewers approve or request changes
4. If bypassed, document bypass reason and completion date

### For Technical Leads

**Before Approving Gate**:
1. Verify all required checklist items complete
2. Review evidence (test results, metrics)
3. Assess risk if bypass proposed
4. Approve or request additional work

**If Approving Bypass**:
1. Ensure bypass reason is justified
2. Ensure completion date is realistic
3. Follow up on missing criteria

### For Project Managers

**Tracking Gate Progress**:
1. Monitor gate pass rates (target ≥90%)
2. Identify bottlenecks (gates with high bypass rates)
3. Address common bypass reasons (process improvements)
4. Report gate metrics in retrospectives

---

## Quality Gate Template (for Copy-Paste)

```markdown
### Gate N: [PHASE] → [NEXT PHASE]

**Entry Criteria**:
- [ ] [Criteria 1]
- [ ] [Criteria 2]

**Quality Checklist**:
- [ ] **[Checklist Item 1]**
  - Evidence: [Link to evidence]
- [ ] **[Checklist Item 2]**
  - Evidence: [Link to evidence]

**Approval Status**:
- [ ] Required Approver 1: ✅ Approve / ⚠️ Request Changes
- [ ] Required Approver 2: ✅ Approve / ⚠️ Request Changes

**Bypass** (if applicable):
- **Reason**: [Why bypassed]
- **Missing Criteria**: [What's not complete]
- **Approval**: [Approvers]
- **Completion Date**: [When missing criteria will be complete]

**Gate Status**: ✅ PASSED / ⚠️ BYPASSED / ❌ BLOCKED
```

---

## Continuous Improvement

### Reviewing Quality Gates

**Quarterly Review**:
1. Analyze gate pass rates
2. Identify bottlenecks
3. Update checklist items (remove obsolete, add missing)
4. Adjust approval processes (streamline if needed)

### Updating Quality Gates

**When to Update**:
- Process change (e.g., new project standards)
- Feedback from team (e.g., checklist item unclear)
- Metric change (e.g., test coverage threshold changes)

**Update Process**:
1. Propose change to quality gate
2. Get technical lead + architecture owner approval
3. Update this document
4. Communicate change to team
5. Track effectiveness of change

---

**Document Version**: 1.0
**Last Updated**: 2026-01-22
**Status**: ✅ Defined
**Next Review**: 2026-04-22 (quarterly)
