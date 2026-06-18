// Public data API. `VEYRA` keeps the original aggregate shape used by screens.
import { money, t, tx, STR } from './strings';
import { SHOPS, NPCS, PRODUCTS, productById } from './catalog';
import { QUESTS, VOUCHERS } from './rewards';

export * from './types';
export { money, t, tx, STR } from './strings';
export { SHOPS, NPCS, PRODUCTS, productById } from './catalog';
export { QUESTS, VOUCHERS } from './rewards';

export const VEYRA = {
  money, t, tx, STR,
  SHOPS, NPCS, PRODUCTS, productById,
  QUESTS, VOUCHERS,
} as const;
