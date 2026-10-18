import { describe, expect, it } from 'vitest';
import { classify, LOW_CONFIDENCE } from './classifier.ts';
import type { Signal } from './types.ts';

const s = (kind: Signal['kind'], value: string): Signal => ({ kind, value });

describe('classify', () => {
  it('is unknown without evidence', () => {
    expect(classify([s('title', 'BTS - World tour C.A.')]).languageClass).toBe('unknown');
  });

  it('agreeing signals give high confidence', () => {
    const c = classify([s('title', 'FATHERLAND - V.O.S.'), s('label', 'V.O.S.'), s('lingua_field', 'Originale con sottotitoli italiani')]);
    expect(c.languageClass).toBe('vo');
    expect(c.confidence).toBeGreaterThan(0.95);
  });

  it('an explicit "Lingua originale" title beats a default ITALIANO attribute, with low confidence', () => {
    const c = classify([s('title', 'TXT WORLD TOUR ACT: TOMORROW - Lingua originale'), s('structured_language', 'ITALIANO')]);
    expect(c.languageClass).toBe('vo');
    expect(c.confidence).toBeLessThan(LOW_CONFIDENCE);
  });

  it('does not mistake words containing "vo" for a VO tag', () => {
    expect(classify([s('title', 'VOLARE'), s('title', 'Il nuovo mondo')]).languageClass).toBe('unknown');
  });

  it('extracts audio language from Italian language names', () => {
    expect(classify([s('lingua_field', 'Inglese con sottotitoli in Italiano')]).audioLanguage).toBe('en');
    expect(classify([s('description', 'X. Lingua: francese. Sottotitoli: italiano')]).audioLanguage).toBe('fr');
  });

  it('reads "FILM IN INGLESE" as VO with English audio', () => {
    const c = classify([s('title', 'TRAINSPOTTING | FILM IN INGLESE - V.M.14')]);
    expect(c.languageClass).toBe('vo');
    expect(c.audioLanguage).toBe('en');
    expect(classify([s('title', 'IL GIORNO IN ITALIANO')]).languageClass).toBe('unknown');
  });

  it('UCI autism-friendly (DSA) is the Italian version', () => {
    expect(classify([s('structured_language', 'DSA')]).languageClass).toBe('dubbed');
  });

  it('a URL slug alone is too weak to decide', () => {
    expect(classify([s('url_slug', 'il-tempo-di-anne-v-o-s-_2026/990832')]).languageClass).toBe('unknown');
  });
});
