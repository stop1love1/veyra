// Helpers to present + apply API voucher docs ({ code, type, value }) without
// hardcoding a voucher table in the frontend.
import type { ApiVoucher } from './api/client';
import type { Lang } from '../data/types';

/** Short human label for an earned voucher, derived from type + value. */
export function voucherLabel(v: ApiVoucher, lang: Lang): string {
  if (v.type === 'percent') return lang === 'en' ? `${v.value}% off` : `Giảm ${v.value}%`;
  if (v.type === 'freeship') return lang === 'en' ? 'Free shipping' : 'Miễn phí ship';
  // amount
  const amt = v.value.toLocaleString('vi-VN') + '₫';
  return lang === 'en' ? `${amt} off` : `Giảm ${amt}`;
}

/** True when the voucher reduces shipping rather than the item subtotal. */
export function isFreeShip(v: ApiVoucher): boolean {
  return v.type === 'freeship';
}

/**
 * Discount (in ₫) a voucher applies to an item subtotal. Mirrors the previous
 * static rules: percent caps at 50k; amount needs a 500k minimum order.
 */
export function voucherDiscount(v: ApiVoucher, subtotal: number): number {
  if (v.type === 'percent') return Math.min(50000, subtotal * (v.value / 100));
  if (v.type === 'amount') return subtotal >= 500000 ? v.value : 0;
  return 0; // freeship affects shipping, not the subtotal
}
