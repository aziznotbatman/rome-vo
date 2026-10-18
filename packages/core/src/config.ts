import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const cinemaSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  area: z.string(),
  match: z.string(),
  address: z.string(),
  lat: z.number().optional(),
  lon: z.number().optional(),
});

const sourceSchema = z.object({
  id: z.string(),
  adapter: z.enum(['uci', 'eighteen-tickets', 'thespace', 'troisi', 'piccoli', 'farnese', 'casadelcinema', 'nvr']),
  host: z.string().optional(),
  cinemas: z.array(cinemaSchema).min(1),
});

const configSchema = z.object({ sources: z.array(sourceSchema) });

const overrideSchema = z.object({
  cinema: z.string().optional(),
  title: z.string().optional(), // case-insensitive substring of the raw title
  sourceSessionId: z.string().optional(),
  set: z.enum(['vo', 'dubbed', 'unknown']),
  note: z.string(),
});

const overridesSchema = z.object({ overrides: z.array(overrideSchema).default([]) });

export type CinemaConfig = z.infer<typeof cinemaSchema>;
export type SourceConfig = z.infer<typeof sourceSchema>;
export type Override = z.infer<typeof overrideSchema>;

export function projectPath(rel: string): string {
  return ROOT + rel;
}

export function loadSources(path = projectPath('config/cinemas.yaml')): SourceConfig[] {
  const parsed = configSchema.parse(parse(readFileSync(path, 'utf8')));
  const slugs = parsed.sources.flatMap((s) => s.cinemas.map((c) => c.slug));
  const dup = slugs.find((s, i) => slugs.indexOf(s) !== i);
  if (dup) throw new Error(`Duplicate cinema slug in config: ${dup}`);
  return parsed.sources;
}

export function loadOverrides(path = projectPath('config/overrides.yaml')): Override[] {
  return overridesSchema.parse(parse(readFileSync(path, 'utf8')) ?? {}).overrides;
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}
