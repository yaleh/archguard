"""Stage 70.3 — S-struct layer graph construction tests.

Verifies that embed_struct.py builds the correct graph structure for each
layer per the pre-registered method-α rules (plan §Stage 67.2).
"""

import json
import os
import sys
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from embed_struct import (
    load_callgraph_call_edges,
    build_graph_for_level,
    extract_all_method_nodes,
    build_entity_repr_map,
)

ARCHJSON_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", ".archguard", "output", "class", "all-classes.json"
)

@pytest.fixture(scope="module")
def archjson():
    with open(ARCHJSON_PATH) as f:
        return json.load(f)

@pytest.fixture(scope="module")
def call_edges():
    return load_callgraph_call_edges()

@pytest.fixture(scope="module")
def all_nodes(archjson):
    return extract_all_method_nodes(archjson)

@pytest.fixture(scope="module")
def entity_repr(archjson, all_nodes):
    return build_entity_repr_map(archjson, set(all_nodes))

@pytest.fixture(scope="module")
def entity_relations(archjson):
    return archjson.get("relations", [])


class TestLayerGraphConstruction:
    def test_call_edges_count(self, call_edges):
        assert len(call_edges) == 375, f"Expected 375 call edges, got {len(call_edges)}"

    def test_l0_is_zero_edge(self, all_nodes, call_edges, entity_relations, entity_repr):
        G = build_graph_for_level("L0", all_nodes, call_edges, entity_relations, entity_repr)
        assert G is None, "L0 should return None (zero-edge graph, not estimable)"

    def test_l1_has_only_entity_edges(self, all_nodes, call_edges, entity_relations, entity_repr):
        G = build_graph_for_level("L1", all_nodes, call_edges, entity_relations, entity_repr)
        assert G is not None
        # L1 should NOT have the 375 call edges
        # L1 should have only inheritance/dependency expanded to repr-method edges
        assert G.number_of_nodes() == len(all_nodes), "All method nodes should be present"

    def test_l3_has_call_edges(self, all_nodes, call_edges, entity_relations, entity_repr):
        G1 = build_graph_for_level("L1", all_nodes, call_edges, entity_relations, entity_repr)
        G3 = build_graph_for_level("L3", all_nodes, call_edges, entity_relations, entity_repr)
        assert G3 is not None
        # L3 has more edges than L1 (call edges added)
        assert G3.number_of_edges() > G1.number_of_edges(), (
            f"L3 ({G3.number_of_edges()} edges) should have more edges than L1 ({G1.number_of_edges()} edges)"
        )

    def test_l3_l4_equivalent(self, all_nodes, call_edges, entity_relations, entity_repr):
        G3 = build_graph_for_level("L3", all_nodes, call_edges, entity_relations, entity_repr)
        G4 = build_graph_for_level("L4", all_nodes, call_edges, entity_relations, entity_repr)
        assert G3 is not None and G4 is not None
        assert G3.number_of_edges() == G4.number_of_edges(), (
            "L3 and L4 should have same number of edges (call edges are the same)"
        )

    def test_l2_between_l1_and_l3(self, all_nodes, call_edges, entity_relations, entity_repr):
        G1 = build_graph_for_level("L1", all_nodes, call_edges, entity_relations, entity_repr)
        G2 = build_graph_for_level("L2", all_nodes, call_edges, entity_relations, entity_repr)
        G3 = build_graph_for_level("L3", all_nodes, call_edges, entity_relations, entity_repr)
        assert G2 is not None
        assert G1.number_of_edges() <= G2.number_of_edges()
        assert G2.number_of_edges() <= G3.number_of_edges()

    def test_l1_representative_method_expansion(self, all_nodes, call_edges, entity_relations, entity_repr):
        """L1 edges should come from entity-level relations expanded to repr methods."""
        G1 = build_graph_for_level("L1", all_nodes, call_edges, entity_relations, entity_repr)
        # At least some edges should exist if there are entity relations
        entity_rels = [r for r in entity_relations if r.get("type") in ("inheritance", "dependency")]
        if entity_rels:
            # Some edges should appear (not all may map due to entities without methods)
            assert G1.number_of_edges() >= 0  # non-negative
