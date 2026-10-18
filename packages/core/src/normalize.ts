/**
 * Title cleanup. Cinemas decorate titles with version tags ("- V.O.S.", "| ORIGINAL VERSION"),
 * event notes ("FILM+APERITIVO", "(CINEMINI)") and dates ("dal 1 ottobre"). We strip them for
 * display and grouping; the classifier still sees the raw title.
 */

const ENTITY_MAP: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITY_MAP[n.toLowerCase()] ?? m);
}

/** Version/language decorations, matched case-insensitively at the end or inside separators. */
const DECORATIONS: readonly RegExp[] = [
  /\bv\.?\s?o\.?\s?s\.?(?=\W|$)(\s*(ita|sott\.?\s*ita\.?))?/gi,
  /\bv\.\s?o\.?(?=\W|$)/gi,
  /\bvo\b/gi,
  /\boriginal(e)?\s+(language|version|versione)\b/gi,
  /\blingua\s+originale\b/gi,
  /\bversione\s+originale(\s+sottotitolata)?\b/gi,
  /\b(con\s+)?sott(otitoli|\.)?\s*(in\s*)?ita(liano|liani)?\.?/gi,
  /\bv\.?\s?m\.?\s?1[48]\b/gi, // age rating "V.M.14"
  /\bsott(otitolat[oa]|otitoli)?\.?(?=\W|$)/gi,
  /\(ried\.?\)|\briedizione\b/gi,
  /\bfilm\s*\+\s*aperitivo\b/gi,
  /\(cinemini\)/gi,
  /\b(final cut\s*)?4k\b/gi,
  /\bdal\s+\d{1,2}\s+[a-z]+\b/gi,
  /\binfinity vision\b/gi,
  /\[\d{4}\]/g, // "ODISSEA [2026]"
  /\|?\s*\bfilm\s+in\s+(lingua\s+)?[a-zà-ÿ]+(?=\s*[-–|]|\s*$)/gi, // "| FILM IN INGLESE"
  /(^|\s)c\.a\.(?=\s|$)/gi, // UCI "contenuti alternativi" (events) suffix
  /[-–]?\s*\banteprima\b/gi,
  /\b\d{1,2}(\s*[–-]\s*\d{1,2})*\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b/gi,
  /\b\d{2}:\d{2}\b/g,
];

export function cleanTitle(raw: string): string {
  let t = decodeEntities(raw).replace(/\s+/g, ' ').trim();
  for (const re of DECORATIONS) t = t.replace(re, ' ');
  t = t
    .replace(/\(\s*\)/g, ' ')
    .replace(/(\s*[-–|:]\s*)+$/g, '')
    .replace(/^(\s*[-–|:]\s*)+/g, '')
    .replace(/\s+[-–|]\s+(?=[-–|]|$)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return toTitleCase(t);
}

const SMALL_WORDS = new Set(['di', 'da', 'del', 'della', 'il', 'la', 'le', 'lo', 'e', 'a', 'in', 'of', 'the', 'and', 'on', 'nel', 'per', 'con']);

/** Shouty all-caps titles become Title Case; mixed-case titles are kept as the cinema wrote them. */
function toTitleCase(t: string): string {
  const letters = t.replace(/[^a-zà-ÿ]/gi, '');
  if (letters.length === 0 || letters !== letters.toUpperCase()) return t;
  return t
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.replace(/^(\p{L})/u, (c) => c.toUpperCase())))
    .join(' ')
    .replace(/(['’])(\p{L})/gu, (_, q: string, c: string) => q + c.toUpperCase());
}

/**
 * Grouping key: accent-free, punctuation-free, lower-case, without parenthesised alternates.
 * "L'Estranea" → "l estranea"; "I DIAVOLI (THE DEVILS)" → "i diavoli".
 */
export function filmKey(raw: string): string {
  const withoutAlternates = cleanTitle(raw).replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  return (withoutAlternates || cleanTitle(raw))
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
