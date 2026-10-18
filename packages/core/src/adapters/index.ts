import type { SourceConfig } from '../config.ts';
import { casaDelCinemaAdapter } from './casadelcinema.ts';
import { eighteenTicketsAdapter } from './eighteen-tickets.ts';
import { farneseAdapter } from './farnese.ts';
import { nvrAdapter } from './nvr.ts';
import { piccoliAdapter } from './piccoli.ts';
import { theSpaceAdapter } from './thespace.ts';
import { troisiAdapter } from './troisi.ts';
import type { SourceAdapter } from './types.ts';
import { uciAdapter } from './uci.ts';

const ADAPTERS: Record<SourceConfig['adapter'], SourceAdapter> = {
  uci: uciAdapter,
  'eighteen-tickets': eighteenTicketsAdapter,
  thespace: theSpaceAdapter,
  troisi: troisiAdapter,
  piccoli: piccoliAdapter,
  farnese: farneseAdapter,
  casadelcinema: casaDelCinemaAdapter,
  nvr: nvrAdapter,
};

export function adapterFor(source: SourceConfig): SourceAdapter {
  return ADAPTERS[source.adapter];
}
