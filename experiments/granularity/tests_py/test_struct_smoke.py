"""Stage 67.2 — S-struct smoke test.

Runs node2vec on the ArchGuard callgraph (225 nodes, 375 call edges) with the
pre-registered parameters (plan §Stage 67.2) and verifies:
  - Embedding matrix shape = (225, 64)
  - No exception raised
  - Output contains all node names
"""

import json
import os
import pytest

# Skip if node2vec not installed (CI without S-struct deps)
node2vec = pytest.importorskip("node2vec", reason="node2vec not installed")
import networkx as nx
import numpy as np

CALLGRAPH_PATH = os.path.join(
    os.path.dirname(__file__), "..", "artifacts", "gt", "callgraph.json"
)

# Pre-registered node2vec parameters (Stage 67.2 / plan §70.3)
PARAMS = dict(
    dimensions=64,
    walk_length=40,
    num_walks=10,
    workers=1,
    p=1.0,
    q=1.0,
    seed=59,
)


def load_call_edges():
    with open(CALLGRAPH_PATH) as f:
        cg = json.load(f)
    return [(e["source"], e["target"]) for e in cg["edges"] if e["kind"] == "call"]


def build_graph(edges):
    G = nx.DiGraph()
    G.add_edges_from(edges)
    return G


class TestStructSmoke:
    def test_load_callgraph(self):
        edges = load_call_edges()
        assert len(edges) == 375, f"Expected 375 call edges, got {len(edges)}"

    def test_node_count(self):
        edges = load_call_edges()
        G = build_graph(edges)
        assert G.number_of_nodes() == 225, (
            f"Expected 225 nodes, got {G.number_of_nodes()}"
        )

    def test_node2vec_embedding_shape(self):
        edges = load_call_edges()
        G = build_graph(edges)
        G_undirected = G.to_undirected()

        n2v = node2vec.Node2Vec(G_undirected, **PARAMS, quiet=True)
        model = n2v.fit(window=5, min_count=1)

        nodes = list(G_undirected.nodes())
        assert len(nodes) == 225

        embeddings = np.array([model.wv[n] for n in nodes if n in model.wv])
        assert embeddings.shape == (225, 64), (
            f"Expected embedding shape (225, 64), got {embeddings.shape}"
        )

    def test_no_missing_nodes(self):
        """All 225 nodes must appear in the embedding vocabulary."""
        edges = load_call_edges()
        G = build_graph(edges).to_undirected()
        n2v = node2vec.Node2Vec(G, **PARAMS, quiet=True)
        model = n2v.fit(window=5, min_count=1)
        missing = [n for n in G.nodes() if n not in model.wv]
        assert missing == [], f"Missing {len(missing)} nodes in embedding vocabulary"
