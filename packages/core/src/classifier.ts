import type { Classification, LanguageClass, Signal, SignalKind } from './types.ts';

/** Below this, the UI labels a session "check with cinema". */
export const LOW_CONFIDENCE = 0.6;
/** Minimum combined evidence needed to commit to vo/dubbed instead of unknown. */
const DECISION_THRESHOLD = 0.5;

const SEP = String.raw`(?:^|[\s\-–(|\[/])`;
const END = String.raw`(?=$|[\s\-–)|\].,/])`;

const VO_PATTERNS: readonly RegExp[] = [
  new RegExp(`${SEP}v\\.\\s?o\\.?(\\s?s\\.?)?${END}`, 'i'), // V.O.S. / V. O. / V.O
  new RegExp(`${SEP}vos(\\s?ita)?${END}`, 'i'),
  new RegExp(`${SEP}(vo|ov)${END}`, 'i'),
  /original(e)?\s+(language|version)/i,
  /versione\s+originale/i,
  /lingua\s+originale/i,
  /^\s*originale\b/i,
];

const EXPLICIT_VO = /lingua\s+originale|versione\s+originale|original\s+(language|version)/i;

const DUB_PATTERNS: readonly RegExp[] = [/doppiat[oa]/i, /versione\s+italiana/i];

/** Italian (and English) language names → ISO 639-1. */
const LANGUAGE_NAMES: Record<string, string> = {
  italiano: 'it', inglese: 'en', english: 'en', francese: 'fr', spagnolo: 'es', tedesco: 'de',
  giapponese: 'ja', coreano: 'ko', cinese: 'zh', mandarino: 'zh', cantonese: 'zh', portoghese: 'pt',
  russo: 'ru', polacco: 'pl', arabo: 'ar', turco: 'tr', persiano: 'fa', farsi: 'fa', hindi: 'hi',
  danese: 'da', svedese: 'sv', norvegese: 'no', finlandese: 'fi', islandese: 'is', olandese: 'nl',
  greco: 'el', ebraico: 'he', ungherese: 'hu', rumeno: 'ro', ceco: 'cs', serbo: 'sr', croato: 'hr',
  ucraino: 'uk', georgiano: 'ka', armeno: 'hy', thailandese: 'th', vietnamita: 'vi', indonesiano: 'id',
};

const ISO_CODES: Record<string, string> = { EN: 'en', ENG: 'en', FR: 'fr', ES: 'es', DE: 'de', JA: 'ja', KO: 'ko', IT: 'it', ITA: 'it' };

interface Vote {
  readonly cls: Exclude<LanguageClass, 'unknown'>;
  readonly weight: number;
  readonly audio?: string;
}

/** "FILM IN INGLESE", "in lingua francese": a foreign language named as the screening language. */
const IN_LANGUAGE = /\b(?:film\s+)?in\s+(?:lingua\s+)?([a-zà-ÿ]+)\b/gi;

function namedScreeningLanguage(s: string): string | null {
  for (const m of s.matchAll(IN_LANGUAGE)) {
    const iso = LANGUAGE_NAMES[(m[1] ?? '').toLowerCase()];
    if (iso && iso !== 'it') return iso;
  }
  return null;
}

/** True if the text claims original-language screening in any form we recognise. Adapters use this too. */
export const mentionsOriginalLanguage = (s: string): boolean => VO_PATTERNS.some((re) => re.test(s)) || namedScreeningLanguage(s) !== null;

const hasVoTag = mentionsOriginalLanguage;
const hasDubTag = (s: string): boolean => DUB_PATTERNS.some((re) => re.test(s));

/** First language named in a "Lingua: inglese, islandese" style string. */
function namedLanguage(s: string): string | null {
  const words = s.toLowerCase().split(/[^a-zà-ÿ]+/);
  for (const w of words) {
    const iso = LANGUAGE_NAMES[w];
    if (iso) return iso;
  }
  return null;
}

/** Text after "Lingua:" in a description, if present. */
function linguaPart(s: string): string | null {
  const m = /lingua\s*:\s*([^.;]+)/i.exec(s);
  return m?.[1]?.trim() ?? null;
}

function voteForLanguageText(text: string, voWeight: number, dubWeight: number): Vote | null {
  if (hasDubTag(text)) return { cls: 'dubbed', weight: dubWeight };
  const lang = namedLanguage(text);
  if (hasVoTag(text) || /originale/i.test(text)) {
    return { cls: 'vo', weight: voWeight, ...(lang && lang !== 'it' ? { audio: lang } : {}) };
  }
  if (lang === 'it') return { cls: 'dubbed', weight: dubWeight };
  if (lang) return { cls: 'vo', weight: voWeight, audio: lang };
  return null;
}

type Rule = (value: string) => Vote | null;

const RULES: Record<SignalKind, Rule> = {
  structured_language: (v) => {
    const u = v.trim().toUpperCase();
    if (u === 'ITA' || u === 'ITALIANO') return { cls: 'dubbed', weight: 0.95 };
    if (u === 'DSA') return { cls: 'dubbed', weight: 0.8 }; // UCI "autism friendly" Italian version
    if (/ORIGINAL/.test(u) || hasVoTag(u)) return { cls: 'vo', weight: 0.95 };
    const iso = ISO_CODES[u];
    if (iso) return { cls: 'vo', weight: 0.95, audio: iso };
    return null;
  },
  lingua_field: (v) => voteForLanguageText(v, 0.95, 0.85),
  description: (v) => {
    const part = linguaPart(v);
    return part ? voteForLanguageText(part, 0.95, 0.9) : hasVoTag(v) ? { cls: 'vo', weight: 0.7 } : null;
  },
  // A spelled-out statement in the title is deliberate and as strong as a default language attribute.
  title: (v) => {
    const lang = namedScreeningLanguage(v);
    if (lang) return { cls: 'vo', weight: 0.95, audio: lang };
    if (EXPLICIT_VO.test(v)) return { cls: 'vo', weight: 0.95 };
    if (hasVoTag(v)) return { cls: 'vo', weight: 0.85 };
    return hasDubTag(v) ? { cls: 'dubbed', weight: 0.85 } : null;
  },
  label: (v) => (hasVoTag(v) ? { cls: 'vo', weight: 0.9 } : null),
  time_tag: (v) => {
    if (hasVoTag(v)) return { cls: 'vo', weight: 0.95 };
    if (/^\s*ita\s*$/i.test(v)) return { cls: 'dubbed', weight: 0.9 };
    return null;
  },
  // Booking page titles (Liveticket) are consistently tagged, so a missing tag is weak dubbed evidence.
  page_title: (v) => (hasVoTag(v) ? { cls: 'vo', weight: 0.9 } : { cls: 'dubbed', weight: 0.55 }),
  untagged: () => ({ cls: 'dubbed', weight: 0.55 }),
  url_slug: (v) => (/(^|[-_/])v-o(-s)?(-|_|$)/i.test(v) ? { cls: 'vo', weight: 0.3 } : null),
  note: () => null,
};

/** Probabilistic OR: independent pieces of evidence for the same class reinforce each other. */
function combine(weights: readonly number[]): number {
  return 1 - weights.reduce((acc, w) => acc * (1 - w), 1);
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function classify(signals: readonly Signal[]): Classification {
  const reasons: string[] = [];
  const votes: Vote[] = [];
  for (const s of signals) {
    const vote = RULES[s.kind](s.value);
    if (!vote) continue;
    votes.push(vote);
    reasons.push(`${s.kind}:"${s.value.slice(0, 60)}"→${vote.cls}(${vote.weight})`);
  }
  const vo = combine(votes.filter((v) => v.cls === 'vo').map((v) => v.weight));
  const dub = combine(votes.filter((v) => v.cls === 'dubbed').map((v) => v.weight));
  const audioLanguage = votes.find((v) => v.audio)?.audio ?? null;

  if (Math.max(vo, dub) < DECISION_THRESHOLD) {
    return { languageClass: 'unknown', confidence: round2(Math.max(vo, dub)), reasons: [...reasons, 'insufficient evidence'], audioLanguage };
  }
  const winner = vo >= dub ? 'vo' : 'dubbed';
  const [win, lose] = winner === 'vo' ? [vo, dub] : [dub, vo];
  // Contradicting evidence lowers confidence; strong contradictions push it under LOW_CONFIDENCE.
  const confidence = round2(win * (1 - 0.7 * lose));
  if (lose > 0) reasons.push(`conflict: vo=${round2(vo)} dubbed=${round2(dub)}`);
  return { languageClass: winner, confidence, reasons, audioLanguage: winner === 'vo' ? audioLanguage : null };
}
