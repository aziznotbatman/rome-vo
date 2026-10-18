import { describe, expect, it } from 'vitest';
import { buildReport } from '../../../scripts/classifier-report.ts';

describe('classifier on labelled fixtures', () => {
  it('has no false VO and finds all VO except the one known source error', () => {
    const r = buildReport(false);
    expect(r.labelled).toBeGreaterThan(150);
    expect(r.precision).toBe(1);
    expect(r.errors).toEqual(['barberini|PINK FLOYD - THE DARK SIDE OF THE MOON| → predicted dubbed, labelled vo']);
  });

  it('is perfect once overrides are applied', () => {
    const r = buildReport(true);
    expect(r.errors).toEqual([]);
    expect(r.recall).toBe(1);
  });
});
