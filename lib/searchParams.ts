import type { HikeKind, LatLng, Mode, SacDifficulty } from '@ch-alpineroute/shared';

export interface SearchParams {
  mode: Mode;
  origin: LatLng | null;
  originLabel: string;
  maxMinutes: number;
  toleranceMinutes: number;
  hikeKind: HikeKind;
  maxSacDifficulty: SacDifficulty | '';
}

export const defaultSearchParams: SearchParams = {
  mode: 'ski',
  origin: null,
  originLabel: '',
  maxMinutes: 90,
  toleranceMinutes: 15,
  hikeKind: 'any',
  maxSacDifficulty: '',
};
