// Quests and vouchers.
import type { Quest, Voucher } from './types';

export const QUESTS: Quest[] = [
  { id: 'q1', reward: { vi: '+50 xu', en: '+50 coins' }, prog: 1, goal: 3,
    title: { vi: 'Khám phá 3 cửa hàng', en: 'Explore 3 shops' } },
  { id: 'q2', reward: { vi: 'Voucher 10%', en: '10% voucher' }, prog: 0, goal: 1,
    title: { vi: 'Trò chuyện cùng stylist', en: 'Chat with a stylist' } },
  { id: 'q3', reward: { vi: 'Miễn phí ship', en: 'Free shipping' }, prog: 0, goal: 1,
    title: { vi: 'Hoàn tất đơn đầu tiên', en: 'Complete first order' } },
  { id: 'q4', reward: { vi: '+20 xu', en: '+20 coins' }, prog: 1, goal: 1, daily: true,
    title: { vi: 'Điểm danh hằng ngày', en: 'Daily check-in' } },
];

export const VOUCHERS: Voucher[] = [
  { id: 'WELCOME10', off: 0.1,    label: { vi: 'Giảm 10%', en: '10% off' },  note: { vi: 'Tối đa 50k', en: 'Up to 50k' } },
  { id: 'VEYRA50',   off: 50000,  label: { vi: 'Giảm 50.000₫', en: '50,000₫ off' }, note: { vi: 'Đơn từ 500k', en: 'Orders from 500k' } },
  { id: 'FREESHIP',  off: 0, ship: true, label: { vi: 'Miễn phí ship', en: 'Free shipping' }, note: { vi: 'Mọi đơn', en: 'Any order' } },
];
