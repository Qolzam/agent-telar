import { describe, it, expect } from 'vitest';
import { fuseRrfScores, rrfScore, RRF_K } from '../lib/rrf';

describe('rrfScore', () => {
  it('uses classic 1/(k+rank) with k=60', () => {
    expect(rrfScore(1)).toBeCloseTo(1 / (RRF_K + 1));
    expect(rrfScore(20)).toBeCloseTo(1 / (RRF_K + 20));
  });

  it('ranks better (lower) positions higher', () => {
    expect(rrfScore(1)).toBeGreaterThan(rrfScore(20));
  });

  it('rejects invalid ranks', () => {
    expect(rrfScore(0)).toBe(0);
    expect(rrfScore(-1)).toBe(0);
  });
});

describe('fuseRrfScores', () => {
  it('sums both sides when present', () => {
    expect(fuseRrfScores(1, 1)).toBeCloseTo(rrfScore(1) + rrfScore(1));
  });

  it('treats a missing side as zero', () => {
    expect(fuseRrfScores(1, null)).toBeCloseTo(rrfScore(1));
    expect(fuseRrfScores(undefined, 2)).toBeCloseTo(rrfScore(2));
  });

  it('prefers documents that hit both rankings', () => {
    const both = fuseRrfScores(5, 5);
    const vectorOnly = fuseRrfScores(1, null);
    expect(both).toBeGreaterThan(vectorOnly);
  });
});
