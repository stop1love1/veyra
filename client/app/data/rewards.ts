// Voucher display catalogue. (The Renown quest ladder is now server-owned and
// fetched via the API — there is no hardcoded FE quest list anymore.)
import type { Voucher } from './types';

export const VOUCHERS: Voucher[] = [
  { id: 'WELCOME10', off: 0.1,    label: { vi: 'Giảm 10%', en: '10% off' },  note: { vi: 'Tối đa 50k', en: 'Up to 50k' } },
  { id: 'VEYRA50',   off: 50000,  label: { vi: 'Giảm 50.000₫', en: '50,000₫ off' }, note: { vi: 'Đơn từ 500k', en: 'Orders from 500k' } },
  { id: 'FREESHIP',  off: 0, ship: true, label: { vi: 'Miễn phí ship', en: 'Free shipping' }, note: { vi: 'Mọi đơn', en: 'Any order' } },
];
