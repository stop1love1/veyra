// Story quest ladder: every quest feeds the Renown engine via its `source`,
// climbing the 5-rank arc across 4 district chapters. Chapter 0 = daily.
import type { Quest } from './types';

export const QUESTS: Quest[] = [
  // ── Chapter 0: daily / repeatable ──
  { id: 'd-checkin', chapter: 0, daily: true, repeatable: true, source: 'daily',
    prog: 0, goal: 1, renown: 10, reward: { vi: '+20 xu', en: '+20 coins' },
    title: { vi: 'Điểm danh Veyra', en: 'Veyra check-in' } },
  { id: 'd-stroll', chapter: 0, daily: true, repeatable: true, source: 'explore',
    prog: 0, goal: 1, renown: 5, reward: { vi: 'Danh vọng', en: 'Renown' },
    title: { vi: 'Dạo 1 quận bất kỳ', en: 'Stroll a district' } },

  // ── Chapter 1 → Rank 2 · Khách quen (Aria · Mira) ──
  { id: 'c1-explore', chapter: 1, source: 'explore', prog: 0, goal: 3, renown: 30,
    reward: { vi: '+50 xu', en: '+50 coins' },
    title: { vi: 'Khám phá 3 cửa hàng', en: 'Explore 3 shops' } },
  { id: 'c1-stylist', chapter: 1, source: 'stylist', prog: 0, goal: 1, renown: 30,
    rewardId: 'WELCOME10', reward: { vi: 'Voucher 10%', en: '10% voucher' },
    title: { vi: 'Trò chuyện cùng stylist Mira', en: 'Chat with stylist Mira' } },
  { id: 'c1-curate', chapter: 1, source: 'curate', prog: 0, goal: 3, renown: 20,
    reward: { vi: '+30 xu', en: '+30 coins' },
    title: { vi: 'Lưu 3 món vào yêu thích', en: 'Save 3 favorites' } },

  // ── Chapter 2 → Rank 3 · Cư dân (Lumen · Noa) ──
  { id: 'c2-stylist', chapter: 2, source: 'stylist', prog: 0, goal: 1, renown: 30,
    reward: { vi: '+50 xu', en: '+50 coins' },
    title: { vi: 'Soi da & tư vấn cùng Noa', en: 'Skin scan with Noa' } },
  { id: 'c2-buy', chapter: 2, source: 'purchase', prog: 0, goal: 1, renown: 60,
    rewardId: 'FREESHIP', reward: { vi: 'Miễn phí ship', en: 'Free shipping' },
    title: { vi: 'Hoàn tất đơn hàng đầu tiên', en: 'Complete first order' } },
  { id: 'c2-look', chapter: 2, source: 'curate', prog: 0, goal: 3, renown: 40,
    reward: { vi: 'Huy hiệu', en: 'Badge' },
    title: { vi: 'Phối 1 "look" hoàn chỉnh', en: 'Style a full look' } },

  // ── Chapter 3 → Rank 4 · Người sành điệu (Nest · Theo) ──
  { id: 'c3-cats', chapter: 3, source: 'purchase', prog: 0, goal: 2, renown: 60,
    reward: { vi: '+80 xu', en: '+80 coins' },
    title: { vi: 'Mua ở 2 danh mục khác nhau', en: 'Buy across 2 categories' } },
  { id: 'c3-collection', chapter: 3, source: 'curate', prog: 0, goal: 1, renown: 80,
    reward: { vi: 'Huy hiệu hiếm', en: 'Rare badge' },
    title: { vi: 'Hoàn thành 1 bộ sưu tập look', en: 'Complete a look collection' } },
  { id: 'c3-review', chapter: 3, source: 'curate', prog: 0, goal: 1, renown: 40,
    reward: { vi: '+50 xu', en: '+50 coins' },
    title: { vi: 'Đánh giá 1 sản phẩm đã mua', en: 'Review a purchase' } },

  // ── Chapter 4 → Rank 5 · Công dân Veyra (Pulse · Vi) ──
  { id: 'c4-allfour', chapter: 4, source: 'explore', prog: 0, goal: 4, renown: 60,
    reward: { vi: '+100 xu', en: '+100 coins' },
    title: { vi: 'Ghé đủ cả 4 quận', en: 'Visit all 4 districts' } },
  { id: 'c4-loyal', chapter: 4, source: 'purchase', prog: 0, goal: 3, renown: 120,
    rewardId: 'VEYRA50', reward: { vi: 'Giảm 50.000₫', en: '50,000₫ off' },
    title: { vi: 'Đạt mốc chi tiêu trung thành', en: 'Reach loyalty spend' } },
  { id: 'c4-qr', chapter: 4, source: 'qr-scan', prog: 0, goal: 1, renown: 150,
    locked: true, reward: { vi: 'Sắp ra mắt', en: 'Coming soon' },
    title: { vi: 'Quét QR tại cửa hàng thật', en: 'Scan QR at a real store' } },
];
