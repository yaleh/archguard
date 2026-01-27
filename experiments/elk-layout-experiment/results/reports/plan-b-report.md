# Plan B Report: Direct ELK Invocation

## Test Summary

- **Total Tests**: 4
- **Successful Renders**: 4 (100.0%)
- **Acceptable Aspect Ratio (0.5-2.0)**: 4 (100.0%)

## Method

Direct use of `@mermaid-js/layout-elk` and `elkjs` libraries:
1. Parse Mermaid diagram to ArchJSON
2. Convert ArchJSON to ELK graph format
3. Apply layout options (aspectRatio, direction)
4. Generate SVG from laid-out graph

### Key Configuration
```typescript
const layoutOptions = {
  'elk.aspectRatio': '1.5',
  'elk.direction': 'DOWN',
  'elk.algorithm': 'layered'
};
```

## Results

### Test 1: simple-test

- **SVG Size**: 570×290px
- **Aspect Ratio**: 1.97:1 ✓
- **PNG Size**: 570×290px

### Test 2: simple-test

- **SVG Size**: 370×590px
- **Aspect Ratio**: 0.63:1 ✓
- **PNG Size**: 370×590px

### Test 3: medium-test

- **SVG Size**: 570×290px
- **Aspect Ratio**: 1.97:1 ✓
- **PNG Size**: 570×290px

### Test 4: medium-test

- **SVG Size**: 370×590px
- **Aspect Ratio**: 0.63:1 ✓
- **PNG Size**: 370×590px


## Conclusions

✓ Plan B SUCCESSFUL: 100.0% of tests achieved acceptable aspect ratio.

### Advantages
- Direct control over ELK layout options
- Can set exact aspect ratio constraints
- Full control over node placement and routing
- No dependency on Mermaid's ELK support

### Disadvantages
- Requires additional development effort
- Need to maintain Mermaid → ArchJSON → ELK conversion
- SVG generation needs custom implementation

### Recommendations

**Plan B is VIABLE for integration**:
- Create new renderer: `src/mermaid/elk-renderer.ts`
- Add configuration option: `--layout elk` or `--use-elk`
- Implement ArchJSON → ELK → SVG pipeline
- Consider making ELK the default renderer for complex diagrams

## Integration Path

If Plan B is successful:
1. Install dependencies: `npm install elkjs @mermaid-js/layout-elk`
2. Create `src/mermaid/elk-renderer.ts` with ELK pipeline
3. Add CLI flag: `--layout elk` or `--use-elk`
4. Update `src/mermaid/generator.ts` to support ELK renderer
5. Add tests for ELK rendering in `tests/integration/`

## Next Steps

- Implement ELK renderer in main codebase
- Add configuration options for aspect ratio control
- Test with real-world projects
