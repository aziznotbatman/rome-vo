import { describe, expect, it } from 'vitest';
import { cleanTitle, filmKey } from './normalize.ts';

describe('cleanTitle', () => {
  it.each([
    ['FATHERLAND - V.O.S.', 'Fatherland'],
    ['DIGGER - V. O.', 'Digger'],
    ['THE SOCIAL - V.O', 'The Social'],
    ['PRIMETIME - V. O. - FILM+APERITIVO', 'Primetime'],
    ['TRAINSPOTTING - ORIGINAL LANGUAGE', 'Trainspotting'],
    ['TRAINSPOTTING (RIED.) - V. O.', 'Trainspotting'],
    ['BLADE RUNNER - FINAL CUT 4K | ORIGINAL VERSION', 'Blade Runner'],
    ['Fatherland - VOS (CINEMINI)', 'Fatherland'],
    ['I DIAVOLI (THE DEVILS) - VOS 01:00', 'I Diavoli (the Devils)'],
    ['DIGGER dal 1 ottobre', 'Digger'],
    ['JE SO&#39; PAZZO', "Je So' Pazzo"],
    ['L&#8217;ESTRANEA', 'L’Estranea'],
    ['La bambola (V.O. sott.)', 'La bambola'],
    ['Trainspotting C.A.', 'Trainspotting'],
    ['GOOD FELLAS | ORIGINAL VERSION CON SOTTOTITOLI IN ITALIANO - V.M.14', 'Good Fellas'],
    ['TRAINSPOTTING | FILM IN INGLESE - V.M.14', 'Trainspotting'],
    ['ODISSEA [2026]', 'Odissea'],
    ['WILD HORSE NINE - ANTEPRIMA', 'Wild Horse Nine'],
    ['I DIAVOLI 19 – 20 – 21 ottobre', 'I Diavoli'],
    ['TXT WORLD TOUR ACT: TOMORROW - Lingua originale', 'Txt World Tour Act: Tomorrow'],
  ])('%s → %s', (raw, expected) => {
    expect(cleanTitle(raw)).toBe(expected);
  });
});

describe('filmKey', () => {
  it('groups VO and dubbed entries of the same film', () => {
    expect(filmKey('FATHERLAND - V.O.S.')).toBe(filmKey('Fatherland'));
    expect(filmKey("L'ESTRANEA")).toBe(filmKey('L&#8217;estranea'));
    expect(filmKey('TRAINSPOTTING (RIED.) - V. O.')).toBe(filmKey('Trainspotting'));
    expect(filmKey('I DIAVOLI (THE DEVILS) - VOS 01:00')).toBe(filmKey('I DIAVOLI 19 – 20 – 21 ottobre'));
    expect(filmKey('Trainspotting C.A.')).toBe(filmKey('TRAINSPOTTING - ORIGINAL LANGUAGE'));
  });
});
