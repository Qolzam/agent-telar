/** Classic Reciprocal Rank Fusion weight for a 1-based rank position. */
export const RRF_K = 60;

export function rrfScore(rank: number): number {
  if (!Number.isFinite(rank) || rank < 1) return 0;
  return 1 / (RRF_K + rank);
}

/** Fuse optional vector/keyword ranks (missing side contributes 0). */
export function fuseRrfScores(
  vectorRank: number | null | undefined,
  keywordRank: number | null | undefined,
): number {
  return (
    (vectorRank != null ? rrfScore(vectorRank) : 0) +
    (keywordRank != null ? rrfScore(keywordRank) : 0)
  );
}
