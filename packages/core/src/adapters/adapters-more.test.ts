import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classify } from '../classifier.ts';
import { projectPath } from '../config.ts';
import { cleanTitle } from '../normalize.ts';
import type { RawSession } from '../types.ts';
import { parseFarneseHome } from './farnese.ts';
import { parsePiccoliHome } from './piccoli.ts';
import { parseShowingDates, parseTheSpaceFilms } from './thespace.ts';
import { parseOperaTitle, parseTroisiHome, toTroisiSession } from './troisi.ts';

const fixture = (rel: string): string => readFileSync(projectPath(`fixtures/${rel}`), 'utf8');
const byClass = (sessions: RawSession[], cls: string): string[] =>
  [...new Set(sessions.filter((s) => classify(s.signals).languageClass === cls).map((s) => cleanTitle(s.title)))].sort();

describe('The Space adapter', () => {
  it('parses sessions with timezone-aware start times', () => {
    const sessions = parseTheSpaceFilms('space-parco-de-medici', JSON.parse(fixture('thespace/films-1025-2026-10-20.json')));
    expect(sessions.length).toBeGreaterThan(30);
    expect(sessions[0]!.startsAt).toMatch(/\+02:00$/);
    expect(sessions[0]!.bookingUrl).toMatch(/^https:\/\/www\.thespacecinema\.it\/prenotare-il-biglietto\//);
  });

  it('flags LINGUA ORIGINALE sessions as VO', () => {
    const sessions = ['films-1021-2026-10-18.json', 'films-1025-2026-10-18.json', 'films-1025-2026-10-20.json', 'films-1025-2026-10-23.json'].flatMap((f) =>
      parseTheSpaceFilms('x', JSON.parse(fixture(`thespace/${f}`))),
    );
    expect(byClass(sessions, 'vo')).toEqual(['Clayface', 'Primetime']);
    expect(byClass(sessions, 'unknown')).toEqual([]);
  });

  it('reads only dates that have showings', () => {
    expect(parseShowingDates(JSON.parse(fixture('thespace/showingDates-1021.json')))).toEqual([
      '2026-10-18',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
    ]);
  });

  it('accepts an unpublished date as an empty list', () => {
    expect(parseTheSpaceFilms('x', JSON.parse(fixture('thespace/films-1021-2026-10-19-unpublished.json')))).toEqual([]);
  });
});

describe('Troisi adapter', () => {
  const events = parseTroisiHome(fixture('troisi/home.html'));

  it('parses all 74 JSON-LD events with Liveticket ids', () => {
    expect(events).toHaveLength(74);
    const digger = events.find((e) => e.title === 'Digger')!;
    expect(digger.startsAt).toBe('2026-10-18T14:00:00+02:00');
    expect(digger.operaId).toBe('697046');
    expect(digger.runtimeMin).toBe(128);
  });

  it('reads VOS from the Liveticket opera title, and its absence as dubbed', () => {
    expect(parseOperaTitle(fixture('troisi/liveticket-opera-697046.html'))).toBe('Digger - VOS');
    expect(parseOperaTitle(fixture('troisi/liveticket-opera-696619.html'))).toBe('Pocahontas');
    const digger = events.find((e) => e.operaId === '697046')!;
    const pocahontas = events.find((e) => e.operaId === '696619')!;
    expect(classify(toTroisiSession('troisi', digger, 'Digger - VOS').signals).languageClass).toBe('vo');
    expect(classify(toTroisiSession('troisi', pocahontas, 'Pocahontas').signals).languageClass).toBe('dubbed');
  });

  it('is unknown without the opera page and vo when the event name says VOS', () => {
    const plain = events.find((e) => e.name.startsWith('Fatherland - 18'))!;
    const tagged = events.find((e) => e.name.startsWith('Fatherland - VOS'))!;
    expect(classify(toTroisiSession('troisi', plain, null).signals).languageClass).toBe('unknown');
    expect(classify(toTroisiSession('troisi', tagged, null).signals).languageClass).toBe('vo');
  });
});

describe('Piccoli adapter', () => {
  const sessions = parsePiccoliHome('piccoli', fixture('piccoli/home.html'));

  it('parses events with their linked movie', () => {
    expect(sessions).toHaveLength(9);
    expect(sessions[0]!.startsAt).toBe('2026-10-21T18:45:00+02:00');
    expect(sessions[0]!.runtimeMin).toBe(70);
  });

  it('uses the stated audio language', () => {
    expect(byClass(sessions, 'vo')).toEqual(['La Bambola - La Poupée', 'Un giorno senza donne']);
    expect(byClass(sessions, 'dubbed')).toEqual(['I racconti del giardino incantato', 'Paw Patrol - Missione Dinosauri']);
    const bambola = sessions.find((s) => s.title.startsWith('La Bambola'))!;
    expect(classify(bambola.signals).audioLanguage).toBe('fr');
  });
});

describe('Farnese adapter', () => {
  const { sessions, advertisedDates } = parseFarneseHome('farnese', fixture('farnese/home.html'));

  it('parses per-day blocks and the day picker', () => {
    expect(advertisedDates).toHaveLength(7);
    expect(sessions.length).toBe(31);
    expect(sessions.every((s) => /^2026-10-(18|19|20|21)T/.test(s.startsAt))).toBe(true);
  });

  it('classifies per showtime: "vos ita" is VO, "ita" is dubbed', () => {
    const digger = sessions.find((s) => s.title.startsWith('DIGGER'))!;
    const calle = sessions.find((s) => s.title === 'Calle Málaga')!;
    expect(classify(digger.signals).languageClass).toBe('vo');
    expect(classify(calle.signals).languageClass).toBe('dubbed');
    expect(byClass(sessions, 'unknown')).toEqual([]);
  });
});
