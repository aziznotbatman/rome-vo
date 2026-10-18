import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classify } from '../classifier.ts';
import { projectPath } from '../config.ts';
import { cleanTitle } from '../normalize.ts';
import type { RawSession } from '../types.ts';
import { parseFetchFilms, toSessions } from './eighteen-tickets.ts';
import { parseUciProgramming } from './uci.ts';

const fixture = (rel: string): string => readFileSync(projectPath(`fixtures/${rel}`), 'utf8');
const voTitles = (sessions: RawSession[]): string[] =>
  [...new Set(sessions.filter((s) => classify(s.signals).languageClass === 'vo').map((s) => cleanTitle(s.title)))].sort();

describe('UCI adapter', () => {
  const sessions = parseUciProgramming('uci-porta-di-roma', JSON.parse(fixture('uci/programming-uci-cinemas-porta-di-roma-roma-2026-10-18.json')));

  it('parses performances with Rome offsets and booking links', () => {
    expect(sessions.length).toBeGreaterThan(50);
    const first = sessions[0]!;
    expect(first.startsAt).toMatch(/^2026-10-18T\d{2}:\d{2}:00\+02:00$/);
    expect(first.bookingUrl).toMatch(/^https:\/\/ucicinemas\.it\/movies\//);
    expect(first.cinemaDay).toBe('2026-10-18');
  });

  it('finds the one OV film and treats autism-friendly (DSA) as not VO', () => {
    expect(voTitles(sessions)).toEqual(['Street Fighter']);
    const dsa = sessions.filter((s) => s.signals.some((x) => x.value === 'DSA'));
    expect(dsa.length).toBeGreaterThan(0);
    expect(dsa.every((s) => classify(s.signals).languageClass === 'dubbed')).toBe(true);
  });
});

describe('18tickets adapter', () => {
  const circuito = new Map([
    ['quattro fontane', 'quattro-fontane'],
    ['eurcine', 'eurcine'],
    ['giulio cesare', 'giulio-cesare'],
    ['nuovo olimpia', 'nuovo-olimpia'],
  ]);

  it('parses the Circuito feed: dates, entries, sessions', () => {
    const day = parseFetchFilms(fixture('18tickets/ccroma-fetch_films-2026-10-19.js'));
    expect(day.advertisedDates[0]).toBe('2026-10-18');
    expect(day.entries.length).toBe(22);
    const fatherland = day.entries.find((e) => e.title === 'FATHERLAND - V.O.S.')!;
    expect(fatherland.lingua).toBe('Originale con i sottotitoli in italiano');
    expect(fatherland.labels).toContain('V.O.S.');
    const sessions = toSessions(day, circuito);
    expect(sessions.every((s) => ['quattro-fontane', 'eurcine', 'giulio-cesare', 'nuovo-olimpia'].includes(s.cinemaSlug))).toBe(true);
    expect(sessions.some((s) => (s.room ?? '').length > 0)).toBe(true);
  });

  it('converts data-time epoch ms to Rome wall time', () => {
    const day = parseFetchFilms(fixture('18tickets/ccroma-fetch_films-2026-10-19.js'));
    const s = toSessions(day, circuito).find((x) => x.startsAt === '2026-10-19T21:45:00+02:00');
    expect(s?.cinemaSlug).toBe('eurcine');
  });

  it('classifies Circuito VO entries (Rome cinemas only)', () => {
    const sessions = toSessions(parseFetchFilms(fixture('18tickets/ccroma-fetch_films-2026-10-19.js')), circuito);
    expect(voTitles(sessions)).toEqual(['Digger', 'Fatherland', 'Il Tempo di Anne']);
  });

  it('classifies Barberini VO entries, including one with no title tag', () => {
    const day = parseFetchFilms(fixture('barberini/cinema.barberini-fetch_films-2026-10-19.js'));
    const sessions = toSessions(day, new Map([['cinema barberini', 'barberini']]));
    expect(voTitles(sessions)).toEqual(['Digger', 'I Diavoli (the Devils)', 'Primetime', 'The Social']);
  });

  it('reads the audio language from Lux "Inglese con sottotitoli"', () => {
    const day = parseFetchFilms(fixture('cdr/lux.cdr.18tickets.it-fetch_films-2026-10-19.js'));
    const sessions = toSessions(day, new Map([['multisala lux roma', 'lux']]));
    expect(voTitles(sessions)).toEqual(['I Diavoli', 'Primetime', 'Trainspotting']);
    const vo = sessions.find((s) => s.title.includes('ORIGINAL LANGUAGE'))!;
    expect(classify(vo.signals).audioLanguage).toBe('en');
  });

  it('returns no entries for an empty day', () => {
    const day = parseFetchFilms(fixture('barberini/alhambra-fetch_films-2026-10-19-empty.js'));
    expect(day.entries).toEqual([]);
  });
});
