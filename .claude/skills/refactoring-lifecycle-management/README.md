# Refactoring Lifecycle Management (RLM) - Quick Start

**Status**: ✅ Converged (V_instance=0.82, V_meta=0.85)
**Time to Adopt**: 30-50 hours (3-4 iterations)
**ROI**: 10x faster queries, 9x faster traceability lookups

---

## What is RLM?

Refactoring Lifecycle Management (RLM) is a systematic methodology for managing software refactoring initiatives from proposal through monitoring. It addresses the unique challenges of refactoring: temporal evolution, plan-execution misalignment, bi-directional traceability gaps, and poor stakeholder visibility.

**Proven Results** (from gemini-live-scribe):
- **Discovery Efficiency**: 10.9x improvement (180s → 16.5s per query)
- **Plan-Execution Alignment**: 0.40 → 0.60 (+50%)
- **Traceability Coverage**: 90% bi-directional links
- **Stakeholder Visibility**: <5 minutes (vs 20-30 minutes baseline)

---

## 3-Step Quick Start

### Step 1: Establish Baseline (4-6 hours)

**Measure your current state**:

```bash
# 1. Plan-Execution Alignment
# Compare original plans vs actual execution
# Calculate: (tasks executed as planned) / (total planned tasks)

# 2. Traceability Coverage
# Sample 15 completion reports for "Impact on Architecture State" sections
# Sample 20 state docs for "Architecture Evolution History" sections
# Calculate: 0.5×(reports with sections) + 0.5×(docs with sections)

# 3. Discovery Efficiency
# Time 10 representative refactoring questions
# Calculate average query time

# 4. Stakeholder Visibility
# Time how long to understand current progress from documentation
```

**Output**: Calculate baseline V_instance (typically 0.25-0.40)

### Step 2: Create Core Artifacts (8-10 hours)

**Copy templates**:
```bash
cp templates/dashboard-template.md docs/refactoring/DASHBOARD.md
cp templates/traceability-matrix-template.md docs/refactoring/TRACEABILITY.md
cp templates/quality-gates-template.md docs/refactoring/QUALITY_GATES.md
```

**Customize for your project**:
- Replace placeholder text (`[Like this]`) with actual content
- Update examples to match your project
- Add project-specific sections if needed

**Populate with current data**:
- Dashboard: Extract from existing reports and status docs
- Traceability Matrix: Map plans → executions → state
- Quality Gates: Customize approvers and thresholds

### Step 3: Apply to Existing Work (6-8 hours)

**Update 3-5 completion reports**:
```bash
# Add "Impact on Architecture State" section to each report
# Link to state docs that were updated
# List code artifacts (files modified/created)
```

**Update 2-3 state docs**:
```bash
# Add "Architecture Evolution History" section to each guide/spec
# Link to completion reports that created/updated the feature
# Document state changes in table format
```

**Update plans**:
```bash
# Document plan deviations with rationale
# Explain emergent work (technical discoveries, bugs)
# Retrospective assessment: Was the deviation correct?
```

**Re-measure**:
```bash
# Re-calculate V_instance
# Expected improvement: +0.20 to +0.35
```

---

## Gradual Rollout Strategy

### Phase 1: Pilot (1-2 weeks)
- Apply RLM to 1 refactoring iteration
- Test templates and quality gates
- Gather feedback from team

### Phase 2: Gradual Adoption (1-2 months)
- Apply RLM to all new refactoring iterations
- Update 50% of existing artifacts
- Monitor V_instance and V_meta improvement

### Phase 3: Full Rollout (2-3 months)
- Apply RLM to all refactoring iterations
- Update 100% of existing artifacts
- Achieve convergence (V_instance ≥ 0.80, V_meta ≥ 0.80)

---

## Key Templates

### 6-Phase Lifecycle Templates

1. **PROPOSAL** (`templates/proposal-phase-template.md`)
   - Problem statement, proposed solution, impact assessment
   - Use when: Identifying refactoring need

2. **PLANNING** (`templates/planning-phase-template.md`)
   - Objectives, scope, tasks, estimates, dependencies, risks
   - Use when: Planning refactoring execution

3. **EXECUTION** (`templates/execution-phase-template.md`)
   - Work completed, code artifacts, **Impact on Architecture State**
   - Use when: Documenting refactoring implementation

4. **VALIDATION** (`templates/validation-phase-template.md`)
   - Test coverage, performance validation, regression testing
   - Use when: Validating refactoring works correctly

5. **INTEGRATION** (`templates/integration-phase-template.md`)
   - State changes, documentation updates, migration guide
   - Use when: Updating architecture state

6. **MONITORING** (`templates/monitoring-phase-template.md`)
   - Monitoring period, metrics collected, stability assessment
   - Use when: Post-deployment monitoring

### Management Tools

7. **Dashboard** (`templates/dashboard-template.md`)
   - 9 sections: Quick Stats, Phase Status, Recent Activity, Timeline, etc.
   - Update: After each phase completion (10-15 minutes)

8. **Traceability Matrix** (`templates/traceability-matrix-template.md`)
   - 4 tables: Plan→Execution, Execution→State, State→Docs, Decision→Architecture
   - Update: After each phase completion (20-30 minutes)

9. **Quality Gates** (`templates/quality-gates-template.md`)
   - 6 gates with checklists, approvers, bypass procedures
   - Use: Before each phase transition

---

## Success Metrics

### Minimum Viable Adoption (V_instance ≥ 0.60)

**Required**:
- [ ] Dashboard created and populated (all 9 sections)
- [ ] Traceability matrix created (≥60% coverage)
- [ ] 3-5 completion reports with "Impact on Architecture State" sections
- [ ] 2-3 state docs with "Architecture Evolution History" sections

**Expected Results**:
- Discovery efficiency: 5-8x improvement (180s → 20-30s per query)
- Plan-execution alignment: +20-30% improvement
- Traceability coverage: 60-70% bi-directional links
- Stakeholder visibility: <10 minutes to understand progress

### Full Adoption (V_instance ≥ 0.80, V_meta ≥ 0.80)

**Required**:
- [ ] All 6 templates in use (customized for project)
- [ ] Dashboard and matrix comprehensive (≥90% coverage)
- [ ] Quality gates defined and enforced (≥90% pass rate)
- [ ] Bi-directional traceability ≥85%
- [ ] Discovery efficiency ≤30 seconds per query

**Expected Results**:
- Discovery efficiency: 10x improvement (180s → 15-20s per query)
- Plan-execution alignment: 0.60-0.80 (+50-100% improvement)
- Traceability coverage: 85-90% bi-directional links
- Stakeholder visibility: <5 minutes to understand progress

---

## Common Questions

**Q: How long does full adoption take?**
A: 30-50 hours total (3-4 iterations of 8-12 hours each). Convergence achievable in 3 iterations (best case).

**Q: Do I need to use all 6 phases?**
A: For large refactoring initiatives, yes (all 6 phases). For small changes, skip phases (document why in completion report).

**Q: What if I can't pass a quality gate?**
A: Two options: (1) Complete missing criteria (preferred), or (2) Bypass gate with approval and completion date. Bypass should be exception, not rule.

**Q: Can I customize templates?**
A: Yes. Add project-specific sections as needed. Keep required sections (they're essential for bi-directional traceability).

**Q: How is RLM different from Agile/Scrum?**
A: Agile/Scrum manage product development cycles. RLM manages refactoring specifically (technical debt reduction, architecture improvements).

---

## Next Steps

1. **Read the full methodology**: `reference/RLM_METHODOLOGY.md` (1000+ lines)
2. **Review examples**: `examples/` directory (real examples from gemini-live-scribe)
3. **Establish baseline**: Measure current V_instance (4-6 hours)
4. **Create core artifacts**: Dashboard + matrix + quality gates (8-10 hours)
5. **Apply to existing work**: Update 3-5 reports + 2-3 state docs (6-8 hours)
6. **Measure improvement**: Re-calculate V_instance, target +0.20-0.35 (1-2 hours)

**Total Time Investment**: 20-30 hours for first iteration
**Expected ROI**: Hundreds of hours saved over project lifetime

---

**For detailed methodology, see**: `SKILL.md` or `reference/RLM_METHODOLOGY.md`
**For templates, see**: `templates/` directory
**For examples, see**: `examples/` directory
