/**
 * Articulation points (cut vertices) of an undirected graph — Tarjan's
 * low-link algorithm. Used for the A-class "关节点" ground truth
 * (proposal §5: built-in graph algorithms over ArchJSON relations).
 *
 * Directed ArchJSON relations are treated as undirected edges; self-loops
 * and duplicate edges are ignored.
 */

export interface GraphEdge {
  from: string;
  to: string;
}

export function articulationPoints(
  nodes: readonly string[],
  edges: readonly GraphEdge[]
): string[] {
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n, new Set());
  for (const e of edges) {
    if (e.from === e.to) continue;
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    if (!adj.has(e.to)) adj.set(e.to, new Set());
    adj.get(e.from)!.add(e.to);
    adj.get(e.to)!.add(e.from);
  }

  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const cut = new Set<string>();
  let timer = 0;

  function dfs(u: string, parent: string | null): void {
    timer += 1;
    disc.set(u, timer);
    low.set(u, timer);
    let children = 0;

    for (const v of adj.get(u) ?? []) {
      if (v === parent) continue;
      if (disc.has(v)) {
        low.set(u, Math.min(low.get(u)!, disc.get(v)!));
        continue;
      }
      children += 1;
      dfs(v, u);
      low.set(u, Math.min(low.get(u)!, low.get(v)!));
      if (parent !== null && low.get(v)! >= disc.get(u)!) {
        cut.add(u);
      }
    }

    if (parent === null && children > 1) {
      cut.add(u);
    }
  }

  for (const n of adj.keys()) {
    if (!disc.has(n)) dfs(n, null);
  }

  return [...cut].sort();
}
