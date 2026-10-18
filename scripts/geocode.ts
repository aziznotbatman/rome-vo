/** Fill missing lat/lon in config/cinemas.yaml using OpenStreetMap Nominatim (1 req/s, per its policy). */
import { readFileSync, writeFileSync } from 'node:fs';
import { isMap, isSeq, parseDocument, type YAMLMap } from 'yaml';
import { projectPath } from '../packages/core/src/config.ts';
import { fetchJson } from '../packages/core/src/http.ts';
import { log } from '../packages/core/src/log.ts';

const path = projectPath('config/cinemas.yaml');
const doc = parseDocument(readFileSync(path, 'utf8'));
const sources = doc.get('sources');
if (!isSeq(sources)) throw new Error('config has no sources list');

for (const source of sources.items) {
  if (!isMap(source)) continue;
  const cinemas = source.get('cinemas');
  if (!isSeq(cinemas)) continue;
  for (const item of cinemas.items) {
    const cinema = item as YAMLMap;
    if (cinema.get('lat') !== undefined) continue;
    const address = String(cinema.get('address'));
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=it&q=${encodeURIComponent(address)}`;
    const hits = (await fetchJson(url)) as { lat: string; lon: string; display_name: string }[];
    const hit = hits[0];
    if (!hit) {
      log.warn('geocode miss', { address });
      continue;
    }
    cinema.set('lat', Number(Number(hit.lat).toFixed(6)));
    cinema.set('lon', Number(Number(hit.lon).toFixed(6)));
    log.info('geocoded', { slug: cinema.get('slug'), found: hit.display_name.slice(0, 80) });
  }
}
writeFileSync(path, doc.toString({ lineWidth: 0 }));
