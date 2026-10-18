export interface HealthInput {
  readonly sessionsFound: number;
  readonly errors: readonly string[];
  /** Dates the source advertises as having shows inside the window; null when the source doesn't say. */
  readonly advertisedDates: readonly string[] | null;
  /** Active future sessions we already had for this cinema in the window before this run. */
  readonly previouslyActive: number;
}

export interface Health {
  readonly ok: boolean;
  readonly reason: string | null;
}

/**
 * A cinema is degraded when its fetch failed or its data looks broken, not merely when it has no shows:
 * cinemas go dark on Mondays, between releases, or for refurbishment.
 */
export function assessHealth(h: HealthInput): Health {
  if (h.errors.length > 0 && h.sessionsFound === 0) return { ok: false, reason: h.errors[0] ?? 'fetch failed' };
  if (h.errors.some((e) => /ZodError|invalid_type|Expected/i.test(e))) return { ok: false, reason: `schema changed: ${h.errors[0]}` };
  if (h.sessionsFound === 0 && h.advertisedDates && h.advertisedDates.length > 0) {
    return { ok: false, reason: `zero sessions but source advertises ${h.advertisedDates.length} dates` };
  }
  // A cinema that had shows and now returns nothing (with or without advertised dates) looks broken, not dark.
  if (h.sessionsFound === 0 && h.previouslyActive >= 5) {
    return { ok: false, reason: `zero sessions, previously ${h.previouslyActive} upcoming` };
  }
  return { ok: true, reason: null };
}
