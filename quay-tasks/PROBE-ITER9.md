---
id: PROBE-ITER9
title: "TestCoverageRenderer.nodeId() collisions silently drop entities from diagram"
status: ready
labels: []
---

## Finding

`src/mermaid/test-coverage-renderer.ts:92` — `nodeId(label)` strips all non-alphanumeric characters to `_`, producing colliding Mermaid node IDs for distinct entities. Two collision paths exist:

**Path A — special-char collision**: Entities named `Foo-Bar-Service` and `Foo_Bar_Service` both map to node ID `Foo_Bar_Service`. In a Mermaid `graph TD`, the second declaration silently overrides the first — `Foo-Bar-Service` disappears from the diagram.

**Path B — truncation collision**: Any two entities whose names share the same first 29 characters but differ only in character 30+ (both longer than 30 chars) truncate to the same label (`<29chars>…`). The `…` character is non-alphanumeric so it also becomes `_`, giving both the same node ID. Example: `AbstractUserRepositoryImplV2Alpha` and `AbstractUserRepositoryImplV2Beta` → both become `AbstractUserRepositoryImplV2_`.

## Evidence

```js
// Reproducing with the renderer's own logic:
function truncate(s, maxLen) {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}
function nodeId(label) {
  return label.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\d)/, '_$1');
}

// Path A
nodeId(truncate('Foo-Bar-Service', 30))  // => 'Foo_Bar_Service'
nodeId(truncate('Foo_Bar_Service', 30))  // => 'Foo_Bar_Service'  ← SAME

// Path B
const e1 = 'VeryLongClassNameWith29CharsXXA';  // 31 chars
const e2 = 'VeryLongClassNameWith29CharsXXB';  // 31 chars
nodeId(truncate(e1, 30))  // => 'VeryLongClassNameWith29CharsX_'
nodeId(truncate(e2, 30))  // => 'VeryLongClassNameWith29CharsX_'  ← SAME

// Resulting Mermaid — Mermaid merges both into one node (second label wins):
//   VeryLongClassNameWith29CharsX_["VeryLongClassNameWith29CharsX…"]
//   VeryLongClassNameWith29CharsX_["VeryLongClassNameWith29CharsX…"]
// Entity e1 is silently absent from the rendered diagram.
```

Actual: two distinct entities appear as one node (or the first is invisible). Expected: both entities appear as separate nodes.

## AC
- [ ] `nodeId()` disambiguates colliding labels (e.g. by appending a counter suffix when a collision is detected, or by using the entity ID as the node ID instead of the truncated display label)
- [ ] A regression test covers the fixed behavior

## DoD
- All tests pass (`npm test`)
- The defect is resolved
- A regression test covers the fixed behavior
