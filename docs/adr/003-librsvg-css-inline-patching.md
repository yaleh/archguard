# ADR-003: Inline SVG Style Patching for librsvg Compatibility

**Status**: Accepted
**Date**: 2026-03-05
**Deciders**: ArchGuard maintainers

---

## Context

ArchGuard renders Mermaid diagrams to PNG using the pipeline:

```
Mermaid code → isomorphic-mermaid → SVG string → sharp (librsvg) → PNG
```

Mermaid generates SVG with an embedded `<style>` block whose selectors are scoped to a unique diagram ID, e.g.:

```css
#d42a32b9 .flowchart-link { stroke: #333333; fill: none; }
#d42a32b9 .edgeLabel rect  { fill: rgba(232,232,232,0.8); opacity: 0.5; }
#d42a32b9 .internal rect   { fill: #dafbe1 !important; }
```

**librsvg** (the SVG renderer used internally by sharp) does not reliably apply CSS rules that use compound/descendant selectors with an ID prefix (`#id .class`). When these rules are ignored, SVG elements fall back to the SVG specification's default presentation values:

| Property | SVG default | Expected (from CSS) |
|----------|-------------|---------------------|
| `fill`   | `black`     | `none` or a colour  |
| `stroke` | `none`      | `#333333`           |

This caused **two independently discovered classes of black-block rendering artefacts**.

---

## Problem 1 — Edge Path Fill (discovered 2026-03-05, commit `5573949`)

### Symptom

Bezier-curve edge paths (`<path class="flowchart-link" style=";" …>`) were rendered as solid black filled polygons. Because the paths are open splines with many waypoints, the implicit closing segment created large, irregularly shaped black areas covering substantial portions of the diagram.

### Root cause

```svg
<!-- Mermaid output: inline style is empty -->
<path class="… flowchart-link" style=";" d="M767,3370 C813,3334 …">
```

- CSS rule `#id .flowchart-link { fill: none }` was not applied by librsvg.
- SVG default fill = `black` → entire path interior filled black.

### Fix

`inlineEdgeStyles()` in `src/mermaid/renderer.ts` applies a regex replace **before** the SVG buffer is passed to sharp, injecting `fill:none` directly into each `flowchart-link` path's `style` attribute:

```typescript
svg.replace(
  /(<path\b[^>]*class="[^"]*\bflowchart-link\b[^"]*"[^>]*\bstyle=")([^"]*?)(")/g,
  (_, pre, style, post) => {
    if (/\bfill\s*:\s*none\b/.test(style)) return _;
    const trimmed = style.replace(/^[\s;]+|[\s;]+$/g, '');
    return `${pre}${trimmed ? trimmed + ';' : ''}fill:none;${post}`;
  }
);
```

---

## Problem 2 — Edge-Label Background Rect Fill (discovered 2026-03-05, commit `1bdd85a`)

### Symptom

For edges that carry strength labels (e.g. `==>|"8 refs"|`), Mermaid generates a background rectangle behind the label text:

```svg
<rect class="background" style="" x="-2" y="-18" width="45.87" height="25.79">
```

These rects were rendered as solid black rectangles (~190 × 107 px at 300 dpi), appearing as prominent black blocks at each labelled edge midpoint.

### Root cause

The CSS rule that should colour these rects is:

```css
#id .edgeLabel rect { fill: rgba(232,232,232,0.8); opacity: 0.5; }
```

librsvg does not apply this rule. The `style` attribute on the rect is empty (`style=""`), so no inline override exists and the SVG default fill (black) is used.

Note: rects without a `style` attribute at all are dimensionless placeholders (0 × 0) and are harmless; only rects with an explicit (possibly empty) `style=""` attribute have real geometry.

### Fix

A second replace pass added to `inlineEdgeStyles()` injects `fill:none` on background-class rects that have an explicit `style` attribute but no `fill`:

```typescript
result = result.replace(
  /(<rect\b[^>]*class="[^"]*\bbackground\b[^"]*"[^>]*\bstyle=")([^"]*?)(")/g,
  (_, pre, style, post) => {
    if (/\bfill\s*:/.test(style)) return _;
    const trimmed = style.replace(/^[\s;]+|[\s;]+$/g, '');
    return `${pre}${trimmed ? trimmed + ';' : ''}fill:none;${post}`;
  }
);
```

`fill:none` is the correct semantic: the rects sit on top of correctly-coloured node containers or the white diagram background, so transparency yields the intended appearance.

---

## General Pattern and Decision

### Pattern

Both problems share the same root cause:

> **librsvg does not apply ID-scoped CSS class selectors embedded in Mermaid SVG `<style>` blocks.** Any SVG element whose only fill/stroke specification comes from such a rule will fall back to the SVG default (`fill=black`, `stroke=none`).

The fix pattern is therefore:

1. Identify element classes that Mermaid styles exclusively through the embedded CSS (not through inline `style=` attributes).
2. For each class, determine the CSS-intended property value.
3. Inject that value as an inline style attribute **in the SVG string** before it is passed to sharp/librsvg.

### Decision

**We adopt `inlineEdgeStyles()` as the canonical pre-processing step** applied in `convertSVGToPNG()` before every sharp render call. Future librsvg compatibility issues should be fixed by extending this function with additional replace passes, following the established guard pattern:

- Check if the property is already set inline → skip (idempotent).
- Preserve any existing inline style values.
- Inject only the property value dictated by the CSS.

### Alternatives considered

| Alternative | Reason rejected |
|---|---|
| Switch from sharp/librsvg to a browser-based headless renderer (Puppeteer/Playwright) | Large runtime dependency; significant startup latency; overkill for static diagrams |
| Post-process the Mermaid CSS to remove ID scoping | Fragile; breaks if Mermaid changes its CSS structure; doesn't fix the root issue in librsvg |
| Write SVG-to-PNG using a different library | No Node.js-native alternative with comparable quality and performance |
| Upgrade librsvg | System dependency; not controllable from npm; version in sharp is fixed |

### Consequences

- **Positive**: Clean, fast, zero-dependency fix; runs in O(SVG size); idempotent.
- **Positive**: Contained in one function (`inlineEdgeStyles`) with full unit-test coverage.
- **Negative**: Must be extended manually when Mermaid adds new element classes that rely solely on the embedded CSS for fill/stroke. Watch for new Mermaid major versions.
- **Negative**: The on-disk `.svg` file is not patched (only the in-memory buffer passed to sharp is). Browsers apply the embedded CSS correctly, so the `.svg` files render correctly in browsers regardless.

---

## Known Remaining Gaps

The following element classes are styled only via embedded CSS and may be affected if librsvg support degrades further:

| Class | CSS rule | Current status |
|---|---|---|
| `arrowMarkerPath` | `.marker { fill: #333333 }` (inherited) | librsvg appears to inherit correctly today |
| `.internal rect` (node fill) | `.internal rect { fill: #dafbe1 !important }` | Overridden by `!important` inline `style=` on `basic label-container` rects → not affected |
| `.flowchart-link` stroke | `.flowchart-link { stroke: #333333 }` | librsvg applies this today; monitor on librsvg upgrades |

---

## Related

- `src/mermaid/renderer.ts` — `inlineEdgeStyles()` implementation
- `tests/unit/mermaid/edge-style-inline.test.ts` — unit tests
- Commit `5573949` — Problem 1 fix
- Commit `1bdd85a` — Problem 2 fix
- [librsvg CSS support matrix](https://gitlab.gnome.org/GNOME/librsvg/-/issues) — upstream tracking
