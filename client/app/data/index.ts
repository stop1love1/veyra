// Public data API. `VEYRA` keeps the original aggregate shape used by screens.
import { money, tx, STR } from './strings';
import { t } from '../lib/i18n';
import { SHOPS, NPCS, PRODUCTS, productById } from './catalog';
import { QUESTS, VOUCHERS } from './rewards';

export * from './types';
export { money, tx, STR } from './strings';
export { t } from '../lib/i18n';
export { default as i18n } from '../lib/i18n';
export { SHOPS, NPCS, PRODUCTS, productById } from './catalog';
export { QUESTS, VOUCHERS } from './rewards';

export const VEYRA = {
  money, t, tx, STR,
  SHOPS, NPCS, PRODUCTS, productById,
  QUESTS, VOUCHERS,
} as const;
