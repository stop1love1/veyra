// Bilingual UI strings + formatting helpers.
import type { Lang, Localized } from './types';

export const money = (n: number): string => n.toLocaleString('vi-VN') + '₫';

export const STR: Record<string, Localized> = {
  appName:        { vi: 'Veyra',                       en: 'Veyra' },
  tagline:        { vi: 'Bước vào thế giới mua sắm',  en: 'Step into the shopping world' },
  enter:          { vi: 'Vào thế giới',           en: 'Enter world' },
  createChar:     { vi: 'Tạo nhân vật',            en: 'Create character' },
  guest:          { vi: 'Vào nhanh',                en: 'Quick play' },
  yourName:       { vi: 'Tên nhân vật',            en: 'Character name' },
  style:          { vi: 'Phong cách',               en: 'Style' },
  skin:           { vi: 'Tông da',                  en: 'Skin tone' },
  vibe:           { vi: 'Sắc thái',                 en: 'Vibe' },
  start:          { vi: 'Bắt đầu hành trình',     en: 'Start journey' },
  worldTitle:     { vi: 'Quảng trường Veyra',      en: 'Veyra Plaza' },
  tapShop:        { vi: 'Chạm vào cửa hàng để ghé thăm', en: 'Tap a shop to visit' },
  enterShop:      { vi: 'Vào cửa hàng',            en: 'Enter shop' },
  talkTo:         { vi: 'Trò chuyện',               en: 'Talk to' },
  staff:          { vi: 'Tư vấn viên',            en: 'Advisor' },
  shelf:          { vi: 'Sản phẩm nổi bật',       en: 'Featured' },
  send:           { vi: 'Gửi',                      en: 'Send' },
  suggest:        { vi: 'Gợi ý cho tôi',          en: 'Suggest for me' },
  addCart:        { vi: 'Thêm vào giỏ',           en: 'Add to cart' },
  buyNow:         { vi: 'Mua ngay',                  en: 'Buy now' },
  mixMatch:       { vi: 'Phối đồ',                 en: 'Mix & match' },
  size:           { vi: 'Kích cỡ',                 en: 'Size' },
  color:          { vi: 'Màu sắc',                 en: 'Color' },
  sold:           { vi: 'đã bán',                  en: 'sold' },
  cart:           { vi: 'Giỏ hàng',                en: 'Cart' },
  emptyCart:      { vi: 'Giỏ hàng trống',         en: 'Your cart is empty' },
  emptyCartSub:   { vi: 'Ghé các cửa hàng để khám phá', en: 'Visit shops to discover items' },
  subtotal:       { vi: 'Tạm tính',                en: 'Subtotal' },
  shipping:       { vi: 'Vận chuyển',              en: 'Shipping' },
  discount:       { vi: 'Giảm giá',                en: 'Discount' },
  total:          { vi: 'Tổng cộng',               en: 'Total' },
  free:           { vi: 'Miễn phí',                en: 'Free' },
  checkout:       { vi: 'Thanh toán',               en: 'Checkout' },
  applyVoucher:   { vi: 'Áp dụng voucher',         en: 'Apply voucher' },
  payNow:         { vi: 'Thanh toán ngay',          en: 'Pay now' },
  payment:        { vi: 'Phương thức',            en: 'Payment method' },
  address:        { vi: 'Địa chỉ giao hàng',     en: 'Delivery address' },
  orderDone:      { vi: 'Đặt hàng thành công!',  en: 'Order placed!' },
  orderDoneSub:   { vi: 'Bạn nhận được +120 xu và 1 huy hiệu', en: 'You earned +120 coins and a badge' },
  backToWorld:    { vi: 'Về thế giới',            en: 'Back to world' },
  quests:         { vi: 'Nhiệm vụ',                en: 'Quests' },
  vouchers:       { vi: 'Voucher',                   en: 'Vouchers' },
  rewards:        { vi: 'Phần thưởng',            en: 'Rewards' },
  claim:          { vi: 'Nhận',                     en: 'Claim' },
  claimed:        { vi: 'Đã nhận',                en: 'Claimed' },
  use:            { vi: 'Dùng',                     en: 'Use' },
  level:          { vi: 'Cấp',                      en: 'Lvl' },
  map:            { vi: 'Bản đồ',                 en: 'Map' },
  lite:           { vi: 'Chế độ nhẹ',           en: 'Lite mode' },
  back:           { vi: 'Quay lại',                 en: 'Back' },
  items:          { vi: 'sản phẩm',                en: 'items' },
  reviews:        { vi: 'đánh giá',               en: 'reviews' },
  inStock:        { vi: 'Còn hàng',                en: 'In stock' },
  dropScene:      { vi: '3D scene — thay render tại đây', en: '3D scene — drop render here' },
  dropProduct:    { vi: 'Ảnh sản phẩm',           en: 'product shot' },
  recommended:    { vi: 'Stylist gợi ý',          en: 'Stylist picks' },
};

export const t = (key: string, lang: Lang): string => {
  const e = STR[key];
  if (!e) return key;
  return e[lang] || e.vi;
};

export const tx = (obj: Localized | undefined, lang: Lang): string =>
  obj ? (obj[lang] || obj.vi) : '';
