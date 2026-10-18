import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';
import { projectPath } from '../packages/core/src/config.ts';
import type { RawSession } from '../packages/core/src/types.ts';

/** Identifies one distinct listing: cinema, raw title, and the per-session language field if any. */
export function labelKey(s: RawSession): string {
  const extra = s.signals.find((x) => x.kind === 'structured_language' || x.kind === 'time_tag')?.value ?? '';
  return `${s.cinemaSlug}|${s.title}|${extra}`;
}

export function loadLabels(): Map<string, 'vo' | 'dubbed'> {
  const raw = parse(readFileSync(projectPath('fixtures/labels.yaml'), 'utf8')) as unknown;
  const parsed = z.object({ labels: z.record(z.string(), z.enum(['vo', 'dubbed'])) }).parse(raw);
  return new Map(Object.entries(parsed.labels));
}
