import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classify } from '../classifier.ts';
import { projectPath } from '../config.ts';
import { cleanTitle } from '../normalize.ts';
import type { RawSession } from '../types.ts';
import { parseCalendar, splitDirector, toCasaSession } from './casadelcinema.ts';
import { parseNvrPage } from './nvr.ts';

const fixture = (rel: string): string => readFileSync(projectPath(`fixtures/${rel}`), 'utf8');
const byClass = (sessions: RawSession[], cls: string): string[] =>
  [...new Set(sessions.filter((s) => classify(s.signals).languageClass === cls).map((s) => cleanTitle(s.title)))].sort();

describe('Casa del Cinema adapter', () => {
  const events = parseCalendar(fixture('casadelcinema/calendar.html'));
  const upcoming = events.filter((e) => e.start >= '2026-10-18').map((e) => toCasaSession('casa-del-cinema', e));

  it('parses the inline FullCalendar events, one per screening', () => {
    expect(events).toHaveLength(66);
    const shame = events.find((e) => e.id === '32316')!;
    expect(shame).toEqual({ id: '32316', title: 'SHAME di Steve McQueen (v.o.s.)', url: 'https://www.casadelcinema.it/it/event/shame/', start: '2026-10-24T21:30' });
  });

  it('splits the director out of the title', () => {
    expect(splitDirector('SHAME di Steve McQueen (v.o.s.)')).toEqual({ title: 'SHAME (v.o.s.)', director: 'Steve McQueen' });
    expect(splitDirector('ROMA SILENT')).toEqual({ title: 'ROMA SILENT', director: null });
  });

  it('builds stable, unique session ids and Rome times', () => {
    const shame = upcoming.find((s) => s.title.startsWith('SHAME'))!;
    expect(shame.sourceSessionId).toBe('32316:2026-10-24T21:30');
    expect(shame.startsAt).toBe('2026-10-24T21:30:00+02:00');
    expect(new Set(upcoming.map((s) => s.sourceSessionId)).size).toBe(upcoming.length);
  });

  it('classifies (v.o.s.) as VO and untagged Italian films as Italian audio', () => {
    expect(byClass(upcoming, 'vo')).toContain('Shame');
    expect(byClass(upcoming, 'unknown')).toEqual([]);
    const alien = upcoming.find((s) => s.title.startsWith('ALIEN VS. CIRO'));
    expect(alien && classify(alien.signals).languageClass).toBe('dubbed');
  });
});

describe('NVR (Adriano, Atlantic) adapter', () => {
  const adriano = parseNvrPage('adriano', fixture('nvr/adriano.html'), '2026-10-18');
  const atlantic = parseNvrPage('atlantic', fixture('nvr/atlantic.html'), '2026-10-18');

  it('parses showtimes with inferred year and booking links', () => {
    expect(adriano.length).toBeGreaterThan(30);
    const blade = adriano.find((s) => s.title.startsWith('BLADE RUNNER'))!;
    expect(blade.startsAt).toBe('2026-10-27T20:30:00+01:00'); // after the DST switch on 25 Oct
    expect(blade.bookingUrl).toBe('https://www.nvrcinema.it/generic/seatsframe.php?sc=5304&sp=201911#seatsframe');
    expect(blade.sourceSessionId).toBe('201911');
  });

  it('classifies ORIGINAL VERSION as VO and everything else as Italian audio', () => {
    // Good Fellas (ORIGINAL VERSION) is announced but has no showtimes yet, so it yields no sessions.
    expect(byClass(adriano, 'vo')).toEqual(['Blade Runner', 'I Diavoli', 'The Invite', 'Trainspotting']);
    expect(byClass(adriano, 'unknown')).toEqual([]);
    expect(byClass(atlantic, 'vo')).toEqual([]);
    expect(atlantic.length).toBeGreaterThan(20);
  });
});
