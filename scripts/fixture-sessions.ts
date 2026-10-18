/** Parse every saved fixture with its adapter. Shared by the classifier report and its test. */
import { readFileSync } from 'node:fs';
import { parseCalendar, toCasaSession } from '../packages/core/src/adapters/casadelcinema.ts';
import { parseFetchFilms, toSessions } from '../packages/core/src/adapters/eighteen-tickets.ts';
import { parseFarneseHome } from '../packages/core/src/adapters/farnese.ts';
import { parseNvrPage } from '../packages/core/src/adapters/nvr.ts';
import { parsePiccoliHome } from '../packages/core/src/adapters/piccoli.ts';
import { parseTheSpaceFilms } from '../packages/core/src/adapters/thespace.ts';
import { parseOperaTitle, parseTroisiHome, toTroisiSession } from '../packages/core/src/adapters/troisi.ts';
import { parseUciProgramming } from '../packages/core/src/adapters/uci.ts';
import { projectPath } from '../packages/core/src/config.ts';
import type { RawSession } from '../packages/core/src/types.ts';

const read = (rel: string): string => readFileSync(projectPath(`fixtures/${rel}`), 'utf8');

const EIGHTEEN: [string, string, [string, string][]][] = [
  ['circuito', '18tickets/ccroma-fetch_films-2026-10-19.js', [['quattro fontane', 'quattro-fontane'], ['eurcine', 'eurcine'], ['giulio cesare', 'giulio-cesare']]],
  ['circuito', '18tickets/ccroma-fetch_films-2026-10-21-cinema8.js', [['nuovo olimpia', 'nuovo-olimpia']]],
  ['barberini', 'barberini/cinema.barberini-fetch_films-2026-10-19.js', [['cinema barberini', 'barberini']]],
  ['alhambra', 'barberini/alhambra-fetch_films-2026-10-18.js', [['multisala alhambra', 'alhambra']]],
  ['lux', 'cdr/lux.cdr.18tickets.it-fetch_films-2026-10-19.js', [['multisala lux roma', 'lux']]],
  ['odeon', 'cdr/odeon.cdr.18tickets.it-fetch_films-2026-10-19.js', [['odeon multiscreen', 'odeon']]],
  ['greenwich', 'greenwich/green.multisalagreenwichroma.com-fetch_films-2026-10-19.js', [['multisala greenwich', 'greenwich']]],
  ['mignon', 'greenwich/mignon-fetch_films-2026-10-19.js', [['cinema mignon', 'mignon']]],
];

/** Liveticket opera page titles captured from the first live run (operaId → title). */
const operaTitles = (): Record<string, string> => JSON.parse(read('troisi/opera-titles.json')) as Record<string, string>;

export function allFixtureSessions(): RawSession[] {
  const out: RawSession[] = [];
  for (const f of ['porta-di-roma-roma', 'romaest-roma', 'parco-leonardo-roma']) {
    out.push(...parseUciProgramming('uci', JSON.parse(read(`uci/programming-uci-cinemas-${f}-2026-10-18.json`))));
  }
  for (const d of ['18', '20', '22']) out.push(...parseUciProgramming('uci', JSON.parse(read(`uci/programming-uci-luxe-maximo-2026-10-${d}.json`))));
  for (const [, file, names] of EIGHTEEN) out.push(...toSessions(parseFetchFilms(read(file)), new Map(names)));
  for (const f of ['films-1021-2026-10-18.json', 'films-1025-2026-10-18.json', 'films-1025-2026-10-20.json', 'films-1025-2026-10-23.json']) {
    out.push(...parseTheSpaceFilms('thespace', JSON.parse(read(`thespace/${f}`))));
  }
  const titles: Record<string, string> = { ...operaTitles(), '697046': parseOperaTitle(read('troisi/liveticket-opera-697046.html')) ?? '' };
  for (const e of parseTroisiHome(read('troisi/home.html'))) out.push(toTroisiSession('troisi', e, (e.operaId && titles[e.operaId]) || null));
  out.push(...parsePiccoliHome('piccoli', read('piccoli/home.html')));
  out.push(...parseFarneseHome('farnese', read('farnese/home.html')).sessions);
  out.push(...parseCalendar(read('casadelcinema/calendar.html')).filter((e) => e.start >= '2026-10-18').map((e) => toCasaSession('casa-del-cinema', e)));
  for (const c of ['adriano', 'atlantic']) out.push(...parseNvrPage(c, read(`nvr/${c}.html`), '2026-10-18'));
  return out;
}
