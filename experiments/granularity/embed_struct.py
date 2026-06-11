"""Stage 70.3 — S-struct sensor: node2vec graph embeddings (no LLM).

Implements plan §Stage 70.3 / proposal §8.1 S-struct.

For each level L1–L5, builds a graph over method nodes using:
  - L0: zero-edge graph → marked "not_estimable", skipped
  - L1: entity-level inheritance/dependency edges, expanded to representative
        method nodes (first method of each entity; entities with no methods skip)
  - L2: L1 edges + composition/aggregation edges (same expansion rule)
  - L3/L4: L2 edges + 375 call edges from callgraph.json (kind='call')
  - L5: same as L3/L4

Then runs node2vec with pre-registered parameters and saves per-level embedding
matrices to artifacts/embeddings/dim-struct-raw.json.

CLI:
    python embed_struct.py <archjson> <output.json> [--seed N]

where <archjson> is the ArchJSON file produced by ArchGuard analyze -f json.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import networkx as nx
import numpy as np

from lib_py.common import read_json, write_json_atomic

try:
    import node2vec as n2v_module
except ImportError:
    print("ERROR: node2vec not installed. Run: pip install node2vec==0.4.6", file=sys.stderr)
    sys.exit(1)

# Pre-registered node2vec parameters (Stage 67.2, proposal §12.1)
NODE2VEC_PARAMS = dict(
    dimensions=64,
    walk_length=40,
    num_walks=10,
    workers=1,
    p=1.0,
    q=1.0,
    seed=59,
)
NODE2VEC_FIT_PARAMS = dict(window=5, min_count=1)

CALLGRAPH_PATH = Path(__file__).parent / "artifacts" / "gt" / "callgraph.json"

# Entity-level relation types included per level (plan §Stage 70.3, method α)
ENTITY_REL_L1 = {"inheritance", "dependency"}
ENTITY_REL_L2 = ENTITY_REL_L1 | {"composition", "aggregation"}


def load_callgraph_call_edges() -> list[tuple[str, str]]:
    """Load the 375 kind='call' edges from callgraph.json."""
    cg = read_json(str(CALLGRAPH_PATH))
    return [(e["source"], e["target"]) for e in cg["edges"] if e["kind"] == "call"]


def extract_all_method_nodes(archjson: dict) -> list[str]:
    """Extract all method node IDs from callgraph (authoritative scope for S-struct).

    Uses callgraph.json (kind='call') nodes as the fixed node set — this captures
    ALL methods in scope (including private methods not in ArchJSON public members).
    ArchJSON public members are a strict subset of callgraph nodes for the mermaid+parser scope.
    """
    call_edges = load_callgraph_call_edges()
    nodes_set: set[str] = set()
    for src, tgt in call_edges:
        nodes_set.add(src)
        nodes_set.add(tgt)
    return sorted(nodes_set)


def get_representative_method(entity: dict, known_nodes: set[str]) -> str | None:
    """Return the first method node id for an entity that exists in known_nodes.

    Searches ArchJSON public members first; falls back to scanning known_nodes
    for any node matching 'file#ClassName.*'. This handles private methods
    that appear in the callgraph but not in ArchJSON members.
    """
    cls = entity.get("name", "")
    src_loc = entity.get("sourceLocation", {})
    rel_file = src_loc.get("file", "") if isinstance(src_loc, dict) else ""

    # Try ArchJSON public methods first
    for member in entity.get("members", []):
        if member.get("type") != "method":
            continue
        mname = member.get("name", "")
        if mname:
            node_id = f"{rel_file}#{cls}.{mname}"
            if node_id in known_nodes:
                return node_id

    # Fallback: scan known_nodes for any method of this class
    prefix = f"{rel_file}#{cls}."
    for node in known_nodes:
        if node.startswith(prefix):
            return node

    return None  # entity not in callgraph scope; skip its edges


def build_entity_repr_map(archjson: dict, known_nodes: set[str]) -> dict[str, str | None]:
    """Map entity name → representative method node (or None if not in callgraph scope)."""
    result: dict[str, str | None] = {}
    for entity in archjson.get("entities", []):
        name = entity.get("name", "")
        result[name] = get_representative_method(entity, known_nodes)
    return result


def build_graph_for_level(
    level: str,
    all_nodes: list[str],
    call_edges: list[tuple[str, str]],
    entity_relations: list[dict],
    entity_repr: dict[str, str | None],
) -> nx.Graph | None:
    """
    Build undirected graph for the given level.

    Returns None for L0 (zero-edge graph → not estimable).
    """
    G = nx.Graph()
    G.add_nodes_from(all_nodes)

    if level == "L0":
        # Zero-edge graph; not estimable
        return None

    # L1+: add entity-level edges (expanded to representative method nodes)
    if level in ("L1", "L2", "L3", "L4", "L5"):
        rel_types = ENTITY_REL_L1 if level == "L1" else ENTITY_REL_L2
        for rel in entity_relations:
            if rel.get("type") not in rel_types:
                continue
            src_repr = entity_repr.get(rel.get("from", ""))
            tgt_repr = entity_repr.get(rel.get("to", ""))
            if src_repr and tgt_repr and src_repr != tgt_repr:
                G.add_edge(src_repr, tgt_repr)

    # L3/L4/L5: add call edges
    if level in ("L3", "L4", "L5"):
        for src, tgt in call_edges:
            if G.has_node(src) and G.has_node(tgt):
                G.add_edge(src, tgt)

    return G


def embed_graph(G: nx.Graph, seed: int = 59) -> dict[str, Any]:
    """Run node2vec on G and return {node: embedding_list} + metadata."""
    params = {**NODE2VEC_PARAMS, "seed": seed}
    n2v = n2v_module.Node2Vec(G, **params, quiet=True)
    model = n2v.fit(**NODE2VEC_FIT_PARAMS)

    node_embeddings: dict[str, list[float]] = {}
    outside_graph: list[str] = []
    for node in G.nodes():
        if node in model.wv:
            node_embeddings[node] = model.wv[node].tolist()
        else:
            outside_graph.append(node)

    return {
        "embeddings": node_embeddings,
        "outside_graph_nodes": outside_graph,
        "n_nodes": G.number_of_nodes(),
        "n_edges": G.number_of_edges(),
        "params": params,
        "fit_params": NODE2VEC_FIT_PARAMS,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build S-struct node2vec embeddings per level (plan Stage 70.3)."
    )
    parser.add_argument("archjson", help="ArchJSON file from ArchGuard analyze -f json")
    parser.add_argument("output", help="Output JSON path for dim-struct-raw.json")
    parser.add_argument("--seed", type=int, default=59)
    args = parser.parse_args(argv)

    archjson = read_json(args.archjson)
    call_edges = load_callgraph_call_edges()
    all_nodes = extract_all_method_nodes(archjson)
    known_nodes_set = set(all_nodes)
    entity_repr = build_entity_repr_map(archjson, known_nodes_set)
    entity_relations = archjson.get("relations", [])

    print(f"Method nodes: {len(all_nodes)}", file=sys.stderr)
    print(f"Call edges (kind='call'): {len(call_edges)}", file=sys.stderr)

    levels = ["L0", "L1", "L2", "L3", "L4", "L5"]
    results: dict[str, Any] = {}

    for lvl in levels:
        print(f"Building graph for {lvl}...", file=sys.stderr)
        G = build_graph_for_level(lvl, all_nodes, call_edges, entity_relations, entity_repr)
        if G is None:
            print(f"  {lvl}: zero-edge graph → not_estimable", file=sys.stderr)
            results[lvl] = {"status": "not_estimable", "reason": "L0_zero_edge_graph"}
            continue

        n_edges = G.number_of_edges()
        print(f"  {lvl}: {G.number_of_nodes()} nodes, {n_edges} edges → running node2vec...", file=sys.stderr)
        result = embed_graph(G, seed=args.seed)
        result["status"] = "ok"
        results[lvl] = result
        print(f"  {lvl}: done, outside_graph={len(result['outside_graph_nodes'])}", file=sys.stderr)

    write_json_atomic(args.output, {
        "sensor": "S-struct",
        "method": "node2vec",
        "params": NODE2VEC_PARAMS,
        "levels": results,
        "call_edges_source": str(CALLGRAPH_PATH),
        "call_edges_count": len(call_edges),
        "all_method_nodes_count": len(all_nodes),
    })
    print(f"Written: {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
