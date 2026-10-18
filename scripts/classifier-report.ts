/** Precision/recall of the VO classifier on the labelled fixture set. Usage: pnpm classifier:report */
import { fileURLToPath } from 'node:url';
import { classify } from '../packages/core/src/classifier.ts';
import { loadOverrides } from '../packages/core/src/config.ts';
import { normalizeSession } from '../packages/core/src/pipeline/normalize.ts';
import { allFixtureSessions } from './fixture-sessions.ts';
import { labelKey, loadLabels } from './labels.ts';

export interface Report {
  readonly labelled: number;
  readonly unlabelled: number;
  readonly precision: number;
  readonly recall: number;
  readonly unknownRate: number;
  readonly errors: string[];
}

/** One row per distinct listing (cinema + title + language field), so busy films don't dominate. */
export function buildReport(useOverrides: boolean): Report {
  const labels = loadLabels();
  const overrides = useOverrides ? loadOverrides() : [];
  const rows = new Map<string, string>();
  for (const s of allFixtureSessions()) {
    rows.set(labelKey(s), useOverrides ? normalizeSession(s, overrides).languageClass : classify(s.signals).languageClass);
  }
  let tp = 0, fp = 0, fn = 0, unknown = 0, labelled = 0;
  const errors: string[] = [];
  for (const [key, predicted] of rows) {
    const truth = labels.get(key);
    if (!truth) continue;
    labelled++;
    if (predicted === 'unknown') unknown++;
    if (predicted === 'vo' && truth === 'vo') tp++;
    else if (predicted === 'vo') fp++;
    else if (truth === 'vo') fn++;
    if (predicted !== truth) errors.push(`${key} → predicted ${predicted}, labelled ${truth}`);
  }
  const ratio = (a: number, b: number): number => (b === 0 ? 1 : Math.round((a / b) * 1000) / 1000);
  return { labelled, unlabelled: rows.size - labelled, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), unknownRate: ratio(unknown, labelled), errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const useOverrides of [false, true]) {
    const r = buildReport(useOverrides);
    process.stdout.write(
      `\n${useOverrides ? 'With overrides' : 'Classifier only'}: ${r.labelled} labelled listings (${r.unlabelled} unlabelled)\n` +
        `  VO precision ${r.precision}  recall ${r.recall}  unknown rate ${r.unknownRate}\n` +
        r.errors.map((e) => `  ✗ ${e}\n`).join(''),
    );
  }
}
