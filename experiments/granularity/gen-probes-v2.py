"""Stage 70.0 — Generate true-name probes for v2 dimension estimation.

Creates artifacts/embeddings/probes-v2.json: 1 probe per anchor per level (L0–L5).
Anchors = all class/interface entities with ≥1 method in ArchJSON.

Probe text per level:
  L0: anchor name + source file (file-list level)
  L1: anchor + package context (full package.mmd, 24 lines)
  L2: anchor class definition block + class-level relations from class.mmd
  L3: anchor class definition + method-level details + call edges from method.mmd
  L4: anchor from reduced.json + full ArchJSON member info (L3-equivalent + JSON marker)
  L5: anchor source code excerpt from source-stripped.ts

Usage:
    python gen-probes-v2.py [--out artifacts/embeddings/probes-v2.json]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

BASE = Path(__file__).parent
ARCHJSON_PATH = BASE.parent.parent / ".archguard" / "output" / "class" / "all-classes.json"
L1_MMD = BASE / "artifacts" / "levels" / "L1" / "package.mmd"
L2_MMD = BASE / "artifacts" / "levels" / "L2" / "class.mmd"
L3_MMD = BASE / "artifacts" / "levels" / "L3" / "method.mmd"
L4_JSON = BASE / "artifacts" / "levels" / "L4" / "reduced.json"
L5_SRC = BASE / "artifacts" / "levels" / "L5" / "source-stripped.ts"
OUT_DEFAULT = BASE / "artifacts" / "embeddings" / "probes-v2.json"


def load_archjson() -> dict:
    return json.loads(ARCHJSON_PATH.read_text())


def extract_class_blocks(mmd_text: str) -> dict[str, str]:
    """Extract per-entity sections from a classDiagram Mermaid file.

    Returns {entity_name: text_block} where text_block contains:
    - The class {...} definition block
    - Relations (lines outside namespace blocks) involving this entity
    """
    lines = mmd_text.splitlines()

    # Phase 1: collect entity definition blocks (inside namespace { class X { ... } })
    entity_defs: dict[str, list[str]] = {}
    i = 0
    depth = 0
    current_entity: str | None = None
    entity_lines: list[str] = []

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Track namespace depth (any block with braces)
        if stripped.endswith("{") and not stripped.startswith("class ") and not stripped.startswith("interface "):
            depth += 1
            i += 1
            continue

        # Entity definition start: "  class EntityName {" or "  interface EntityName {"
        m = re.match(r"^\s+(class|interface)\s+(\w+)\s*\{", line)
        if m and depth >= 1:
            current_entity = m.group(2)
            entity_lines = [line.strip()]
            i += 1
            # Collect until matching closing brace
            brace_depth = 1
            while i < len(lines) and brace_depth > 0:
                cl = lines[i]
                stripped_cl = cl.strip()
                if "{" in stripped_cl:
                    brace_depth += stripped_cl.count("{")
                if "}" in stripped_cl:
                    brace_depth -= stripped_cl.count("}")
                entity_lines.append(cl.strip())
                i += 1
            entity_defs[current_entity] = entity_lines
            current_entity = None
            entity_lines = []
            continue

        if stripped == "}":
            if depth > 0:
                depth -= 1
        i += 1

    # Phase 2: collect relation lines (outside namespace blocks) involving each entity
    entity_relations: dict[str, list[str]] = {name: [] for name in entity_defs}

    # Relations are lines matching "A --> B" or "A <|-- B" etc. (outside namespace blocks)
    rel_pattern = re.compile(r"^\s{2}(\w+)\s+(?:<\|--|<\.\.|\.\.>|-->|--\*|--o|--|<--|\*--)\s+(\w+)")
    in_namespace = False
    ns_depth = 0

    for line in lines:
        stripped = line.strip()
        if re.match(r"^\s*namespace\s+\w+\s*\{", line) or re.match(r"^\s*subgraph\s+", line):
            in_namespace = True
            ns_depth = 1
            continue
        if in_namespace:
            ns_depth += stripped.count("{") - stripped.count("}")
            if ns_depth <= 0:
                in_namespace = False
            continue

        m = rel_pattern.match(line)
        if m:
            a, b = m.group(1), m.group(2)
            if a in entity_relations:
                entity_relations[a].append(line.strip())
            if b in entity_relations:
                entity_relations[b].append(line.strip())

    # Combine
    result: dict[str, str] = {}
    for name, defs in entity_defs.items():
        parts = ["\n".join(defs)]
        rels = entity_relations.get(name, [])
        if rels:
            parts.append("relations:")
            parts.extend(rels)
        result[name] = "\n".join(parts)

    return result


def extract_source_blocks(src_text: str) -> dict[str, str]:
    """Extract class/interface source blocks from stripped TypeScript source."""
    blocks: dict[str, str] = {}
    lines = src_text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        # Match class or interface declaration
        m = re.match(r"^(?:export\s+)?(?:abstract\s+)?(?:class|interface)\s+(\w+)", line.strip())
        if m:
            name = m.group(1)
            block_lines = [line]
            # Find matching brace
            brace_depth = line.count("{") - line.count("}")
            j = i + 1
            while j < len(lines) and brace_depth > 0:
                bl = lines[j]
                brace_depth += bl.count("{") - bl.count("}")
                block_lines.append(bl)
                j += 1
            blocks[name] = "\n".join(block_lines[:80])  # cap at 80 lines per block
            i = j
        else:
            i += 1
    return blocks


def select_anchors(archjson: dict) -> list[dict]:
    """Select anchors: all entities that are class or interface with ≥1 method member."""
    result = []
    for entity in archjson.get("entities", []):
        etype = entity.get("type", "")
        if etype not in ("class", "interface"):
            continue
        has_method = any(m.get("type") == "method" for m in entity.get("members", []))
        if has_method:
            result.append(entity)
    return result


def entity_to_l2_text(entity: dict, class_blocks: dict[str, str]) -> str:
    """L2 text: class Mermaid definition block."""
    name = entity.get("name", "")
    block = class_blocks.get(name, "")
    if block:
        return f"anchor: {name}\n{block}"
    # Fallback: simple text from ArchJSON
    lines = [f"anchor: {name}", f"type: {entity.get('type', '')}"]
    members = [m["name"] for m in entity.get("members", []) if m.get("type") == "method"]
    if members:
        lines.append("methods: " + ", ".join(members[:10]))
    return "\n".join(lines)


def entity_to_l3_text(entity: dict, method_blocks: dict[str, str]) -> str:
    """L3 text: method Mermaid definition + call edges."""
    name = entity.get("name", "")
    block = method_blocks.get(name, "")
    if block:
        return f"anchor: {name}\n{block}"
    # Fallback from ArchJSON
    return entity_to_l2_text(entity, {})


def entity_to_l4_text(entity: dict, method_blocks: dict[str, str]) -> str:
    """L4 text: same as L3 but labeled as JSON-structured (reduced ArchJSON context)."""
    name = entity.get("name", "")
    block = method_blocks.get(name, "")
    src_loc = entity.get("sourceLocation", {})
    file_ = src_loc.get("file", entity.get("file", "")) if isinstance(src_loc, dict) else entity.get("file", "")
    lines = [f"anchor: {name}", f"file: {file_}", "[representation: reduced ArchJSON]"]
    if block:
        lines.append(block)
    else:
        # Fallback: list members
        methods = [m["name"] for m in entity.get("members", []) if m.get("type") == "method"]
        if methods:
            lines.append("methods: " + ", ".join(methods[:15]))
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate true-name v2 probes for dimension estimation.")
    parser.add_argument("--out", default=str(OUT_DEFAULT))
    args = parser.parse_args(argv)

    print("Loading ArchJSON...", file=sys.stderr)
    archjson = load_archjson()
    anchors = select_anchors(archjson)
    print(f"Anchors selected: {len(anchors)}", file=sys.stderr)

    print("Loading level artifacts...", file=sys.stderr)
    l1_text = L1_MMD.read_text()
    l2_text = L2_MMD.read_text()
    l3_text = L3_MMD.read_text()
    l5_text = L5_SRC.read_text() if L5_SRC.exists() else ""

    print("Parsing class blocks from L2 mermaid...", file=sys.stderr)
    l2_blocks = extract_class_blocks(l2_text)
    print(f"  L2 entities extracted: {len(l2_blocks)}", file=sys.stderr)

    print("Parsing class blocks from L3 mermaid...", file=sys.stderr)
    l3_blocks = extract_class_blocks(l3_text)
    print(f"  L3 entities extracted: {len(l3_blocks)}", file=sys.stderr)

    l5_blocks = extract_source_blocks(l5_text)
    print(f"  L5 source blocks extracted: {len(l5_blocks)}", file=sys.stderr)

    probes: list[dict] = []
    missing_l2 = 0
    missing_l3 = 0
    missing_l5 = 0

    seen_names: set[str] = set()
    for entity in anchors:
        name = entity.get("name", "")
        src_loc = entity.get("sourceLocation", {})
        file_ = src_loc.get("file", entity.get("file", "")) if isinstance(src_loc, dict) else entity.get("file", "")

        # Build unique anchor key: use file slug if name is duplicated
        if name in seen_names:
            file_slug = file_.replace("/", "_").replace(".ts", "")
            anchor_key = f"{name}@{file_slug}"
        else:
            anchor_key = name
        seen_names.add(name)

        # Build package from file path (first directory component)
        pkg = file_.split("/")[0] if "/" in file_ else file_

        # L0: file-list level
        probes.append({
            "id": f"{anchor_key}:L0",
            "text": f"anchor: {name}\nfile: {file_}",
        })

        # L1: package context (full package.mmd is small enough)
        probes.append({
            "id": f"{anchor_key}:L1",
            "text": f"anchor: {name}\npackage: {pkg}\n\n[Package diagram]\n{l1_text.strip()}",
        })

        # L2: class diagram block
        l2_block = l2_blocks.get(name)
        if not l2_block:
            missing_l2 += 1
        probes.append({
            "id": f"{anchor_key}:L2",
            "text": entity_to_l2_text(entity, l2_blocks),
        })

        # L3: method diagram block
        l3_block = l3_blocks.get(name)
        if not l3_block:
            missing_l3 += 1
        probes.append({
            "id": f"{anchor_key}:L3",
            "text": entity_to_l3_text(entity, l3_blocks),
        })

        # L4: reduced JSON context (method-level, JSON-formatted marker)
        probes.append({
            "id": f"{anchor_key}:L4",
            "text": entity_to_l4_text(entity, l3_blocks),
        })

        # L5: source excerpt
        l5_block = l5_blocks.get(name)
        if not l5_block:
            missing_l5 += 1
        probes.append({
            "id": f"{anchor_key}:L5",
            "text": f"anchor: {name}\n[representation: TypeScript source]\n{l5_block}" if l5_block else f"anchor: {name}\nfile: {file_}\n[source not available in stripped view]",
        })

    print(f"\nProbe generation summary:", file=sys.stderr)
    print(f"  Total anchors: {len(anchors)}", file=sys.stderr)
    print(f"  Total probes: {len(probes)} ({len(anchors)} × 6 levels)", file=sys.stderr)
    print(f"  Missing L2 blocks: {missing_l2}/{len(anchors)}", file=sys.stderr)
    print(f"  Missing L3 blocks: {missing_l3}/{len(anchors)}", file=sys.stderr)
    print(f"  Missing L5 source: {missing_l5}/{len(anchors)}", file=sys.stderr)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(probes, indent=2, ensure_ascii=False))
    print(f"\nWritten: {out_path} ({len(probes)} probes)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
