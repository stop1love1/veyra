// Narrative beats for the Renown progression arc. Kept tiny and diegetic —
// the story is told through the gatekeeper and the rank-up moments, not walls
// of text.
import type { Localized } from './types';

// Hook line at the gate (prologue) — sets the season-long goal: belong here.
export const PROLOGUE: Localized = {
  vi: 'Ai cũng vào được Veyra. Nhưng ở lại được hay không là chuyện khác.',
  en: 'Anyone can enter Veyra. Whether you belong here is another matter.',
};

// Recognition line shown when the player reaches each rank (keyed by rank index).
export const RANK_BEATS: Record<number, Localized> = {
  2: { vi: 'Vài cửa hàng đã bắt đầu nhớ mặt bạn.', en: 'A few shops are starting to remember you.' },
  3: { vi: 'Bạn đã có một chỗ đứng ở Veyra — chào mừng cư dân mới.', en: 'You have a place in Veyra now — welcome, resident.' },
  4: { vi: 'Gu của bạn được cả khu công nhận.', en: 'Your taste is recognized across the district.' },
  5: { vi: 'Bạn giờ là người trong cuộc. Cánh cửa nội bộ Veyra đã mở.', en: 'You are an insider now. Veyra\'s inner doors are open to you.' },
};
