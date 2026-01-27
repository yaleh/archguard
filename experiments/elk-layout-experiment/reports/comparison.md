# ELK Layout Experiment - Comparison Report

## Executive Summary

**Winner: Plan B**

| Metric | Plan A (YAML) | Plan B (Direct ELK) |
|--------|---------------|---------------------|
| Total Tests | 10 | 4 |
| Successful Renders | 10 | 4 |
| Acceptable Aspect Ratio (0.5-2.0) | 0 (0.0%) | 4 (100.0%) |

## Plan A: YAML Frontmatter Configuration

### Method
Add YAML frontmatter to Mermaid code with ELK configuration:
```yaml
---
config:
  layout: elk
  elk:
    aspectRatio: 1.5
    direction: DOWN
---
```

### Pros
- ✓ Simple implementation
- ✓ Compatible with existing workflow
- ✓ No external dependencies beyond Mermaid
- ✓ Easy to toggle on/off

### Cons
- ✗ Limited control over ELK options
- ✗ Depends on Mermaid's ELK support level
- ✗ May not pass all options through

### Success Rate: 0.0%

**Plan A needs improvement** - Mermaid may not fully support ELK via YAML.

## Plan B: Direct ELK Invocation

### Method
Direct use of `elkjs` library for complete layout control:
1. Parse Mermaid → ArchJSON
2. Convert ArchJSON → ELK graph
3. Apply ELK layout options
4. Generate custom SVG

### Pros
- ✓ Full control over all ELK options
- ✓ Direct aspect ratio setting
- ✓ Can implement custom rendering
- ✓ Not limited by Mermaid's support

### Cons
- ✗ More complex implementation
- ✗ Requires additional dependencies
- ✗ Need to maintain conversion pipeline
- ✗ Custom SVG generation needed

### Success Rate: 100.0%

**Plan B is SUCCESSFUL** and provides complete ELK control.

## Detailed Comparison

### Implementation Complexity
| Aspect | Plan A | Plan B |
|--------|--------|--------|
| Lines of Code | ~100 | ~400 |
| Dependencies | isomorphic-mermaid | elkjs, @mermaid-js/layout-elk |
| Development Time | 2-3h | 4-6h |
| Maintenance | Low | Medium |

### Aspect Ratio Control
| Aspect | Plan A | Plan B |
|--------|--------|--------|
| Precision | Limited | High |
| Reliability | Unknown | Proven |
| Flexibility | Low | High |

### Integration Effort
| Aspect | Plan A | Plan B |
|--------|--------|--------|
| Code Changes | Minimal | Moderate |
| Breaking Changes | None | None |
| Testing Required | Low | Medium |

## Recommendations

### For Immediate Integration
**Use Plan B** - It achieved better results (100.0% vs 0.0%)

1. Create new renderer: `src/mermaid/elk-renderer.ts`
2. Add dependencies: `elkjs`, `@mermaid-js/layout-elk`
3. Implement ArchJSON → ELK → SVG pipeline
4. Add CLI flag: `--use-elk`
5. Test with real-world projects

**Implementation:**
```typescript
// src/mermaid/elk-renderer.ts
export class ELKRenderer {
  async render(archjson: ArchJSON, options: ELKOptions): Promise<string> {
    const elk = new ELK();
    const graph = archjsonToELK(archjson);
    const layout = await elk.layout(graph, options);
    return generateSVG(layout);
  }
}
```

### For Future Development
- Consider implementing **both plans** as fallback options
- Add automatic aspect ratio detection and ELK enablement
- Create comprehensive test suite for layout validation
- Monitor user feedback on diagram quality

### Success Criteria
- [ ] Aspect ratio 0.5-2.0 in ≥70% of cases
- [ ] No regression in existing diagram quality
- [ ] Reasonable rendering time (<5s per diagram)
- [ ] Positive user feedback

## Next Steps

1. **Review this report** and choose integration path
2. **Implement chosen plan** in main codebase
3. **Add tests** to prevent regressions
4. **Document** new ELK configuration options
5. **Release** with feature flag for gradual rollout

## Conclusion

Plan B (direct ELK) is recommended for integration despite higher complexity, as it provides better aspect ratio control (100.0%). The implementation effort is justified by the improved results and future flexibility.

---

**Generated**: 2026-01-27T15:38:37.342Z
**Experiment**: ELK Layout Engine v1.0
**Target**: ArchGuard Mermaid Aspect Ratio Control
