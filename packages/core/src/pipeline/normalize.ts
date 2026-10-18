import { createHash } from 'node:crypto';
import { classify } from '../classifier.ts';
import type { Override } from '../config.ts';
import { cleanTitle, filmKey } from '../normalize.ts';
import { cinemaDayOf } from '../time.ts';
import type { Classification, RawSession, Session } from '../types.ts';

export interface NormalizedSession extends Session {
  readonly sourceSessionId: string;
  readonly overridden: boolean;
}

function matchingOverride(raw: RawSession, overrides: readonly Override[]): Override | undefined {
  return overrides.find(
    (o) =>
      (!o.cinema || o.cinema === raw.cinemaSlug) &&
      (!o.title || raw.title.toLowerCase().includes(o.title.toLowerCase())) &&
      (!o.sourceSessionId || o.sourceSessionId === raw.sourceSessionId) &&
      Boolean(o.cinema || o.title || o.sourceSessionId),
  );
}

function applyOverride(c: Classification, o: Override | undefined): Classification {
  if (!o) return c;
  return { ...c, languageClass: o.set, confidence: 1, reasons: [...c.reasons, `override: ${o.note}`] };
}

/** RawSession → Session: classify, apply manual overrides, derive grouping key and cinema day. */
export function normalizeSession(raw: RawSession, overrides: readonly Override[]): NormalizedSession {
  const override = matchingOverride(raw, overrides);
  const classification = applyOverride(classify(raw.signals), override);
  const key = filmKey(raw.title);
  const sourceSessionId =
    raw.sourceSessionId ??
    // Stable across reclassification, so an override or classifier change updates the row in place.
    createHash('sha1').update(`${raw.cinemaSlug}|${raw.startsAt}|${key}`).digest('hex').slice(0, 20);
  return {
    ...raw,
    ...classification,
    sourceSessionId,
    filmKey: key,
    displayTitle: cleanTitle(raw.title),
    cinemaDay: raw.cinemaDay ?? cinemaDayOf(raw.startsAt),
    overridden: override !== undefined,
  };
}

/** Same screening listed twice (e.g. UCI repeats a performance under two screen groups): keep one. */
export function dedupe(sessions: readonly NormalizedSession[]): NormalizedSession[] {
  const seen = new Map<string, NormalizedSession>();
  for (const s of sessions) seen.set(`${s.cinemaSlug}|${s.sourceSessionId}`, s);
  return [...seen.values()];
}
