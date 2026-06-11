/**
 * In-degree ranking over ArchJSON-style relations — A-class "入度排名"
 * ground truth (proposal §5). Self-relations are excluded; ties are
 * broken by id for deterministic, freezable output.
 */

export interface RelationLike {
  from: string;
  to: string;
  type?: string;
}

export interface InDegreeEntry {
  id: string;
  inDegree: number;
}

export function inDegreeRanking(relations: readonly RelationLike[]): InDegreeEntry[] {
  const counts = new Map<string, number>();
  for (const r of relations) {
    if (r.from === r.to) continue;
    counts.set(r.to, (counts.get(r.to) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, inDegree]) => ({ id, inDegree }))
    .sort((a, b) => b.inDegree - a.inDegree || a.id.localeCompare(b.id));
}
