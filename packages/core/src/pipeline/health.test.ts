import { describe, expect, it } from 'vitest';
import { assessHealth } from './health.ts';

const base = { sessionsFound: 10, errors: [], advertisedDates: null, previouslyActive: 0 };

describe('assessHealth', () => {
  it('is ok with sessions and no errors', () => {
    expect(assessHealth(base).ok).toBe(true);
  });

  it('is ok when a cinema is simply dark (no advertised dates, nothing before)', () => {
    expect(assessHealth({ ...base, sessionsFound: 0, advertisedDates: [] }).ok).toBe(true);
  });

  it('degrades on total fetch failure', () => {
    expect(assessHealth({ ...base, sessionsFound: 0, errors: ['HTTP 500'] })).toEqual({ ok: false, reason: 'HTTP 500' });
  });

  it('degrades on schema change even with partial data', () => {
    expect(assessHealth({ ...base, errors: ['ZodError: invalid_type at data.0.title'] }).ok).toBe(false);
  });

  it('degrades on zero sessions for advertised dates', () => {
    expect(assessHealth({ ...base, sessionsFound: 0, advertisedDates: ['2026-10-19'] }).ok).toBe(false);
  });

  it('degrades on an empty response even when the source advertises no dates (layout change, throttled page)', () => {
    expect(assessHealth({ ...base, sessionsFound: 0, advertisedDates: [], previouslyActive: 30 }).ok).toBe(false);
  });

  it('degrades when a cinema that had shows suddenly has none', () => {
    expect(assessHealth({ ...base, sessionsFound: 0, previouslyActive: 12 }).ok).toBe(false);
  });
});
