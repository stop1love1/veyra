// Shops, NPCs and products.
import type { Shop, Npc, Product } from './types';

export const SHOPS: Shop[] = [
  {
    id: 'aria', hue: 184, x: 50, y: 38, featured: true,
    name: { vi: 'Aria Atelier', en: 'Aria Atelier' },
    cat:  { vi: 'Thời trang', en: 'Fashion' },
    blurb:{ vi: 'May đo & phối đồ cùng stylist AI', en: 'Tailoring & styling with an AI stylist' },
    npc:  'mira',
  },
  {
    id: 'lumen', hue: 210, x: 22, y: 60,
    name: { vi: 'Lumen Beauty', en: 'Lumen Beauty' },
    cat:  { vi: 'Mỹ phẩm', en: 'Beauty' },
    blurb:{ vi: 'Soi da & tư vấn quy trình chăm sóc', en: 'Skin scan & routine advice' },
    npc:  'noa',
  },
  {
    id: 'nest', hue: 150, x: 76, y: 58,
    name: { vi: 'Nest & Co.', en: 'Nest & Co.' },
    cat:  { vi: 'Gia dụng & Decor', en: 'Home & Decor' },
    blurb:{ vi: 'Sắp đặt không gian sống', en: 'Style your living space' },
    npc:  'theo',
  },
  {
    id: 'pulse', hue: 250, x: 38, y: 80,
    name: { vi: 'Pulse', en: 'Pulse' },
    cat:  { vi: 'Công nghệ', en: 'Tech' },
    blurb:{ vi: 'Trải nghiệm thiết bị trong tay', en: 'Try gadgets hands-on' },
    npc:  'vi',
  },
];

export const NPCS: Record<string, Npc> = {
  mira: {
    name: 'Mira', hue: 184,
    role: { vi: 'Stylist thời trang', en: 'Fashion stylist' },
    hello:{ vi: 'Chào bạn! Mình là Mira. Hôm nay bạn muốn tìm kiểu đồ như thế nào?',
            en: 'Hi! I’m Mira. What kind of look are you after today?' },
    chips: [
      { vi: 'Đi làm thanh lịch', en: 'Smart for work', reply: { vi: 'Vậy thì bộ blazer dáng cứng phối quần âu sẽ rất hợp. Mình chọn cho bạn nhé:', en: 'A structured blazer with tailored trousers is perfect. Here’s my pick:' }, picks: ['blazer','trousers'] },
      { vi: 'Dạo phố cuối tuần', en: 'Weekend casual', reply: { vi: 'Áo linen oversized với chân váy midi cho cảm giác nhẹ nhàng:', en: 'A linen shirt with a midi skirt feels effortless:' }, picks: ['linen','skirt'] },
      { vi: 'Ngân sách dưới 700k', en: 'Under 700k', reply: { vi: 'Trong tầm giá này mình gợi ý áo len và túi tote — dễ phối:', en: 'In this range I’d suggest the knit and tote — easy to mix:' }, picks: ['knit','tote'] },
    ],
  },
  noa:  { name: 'Noa',  hue: 210, role: { vi: 'Cố vấn làm đẹp', en: 'Beauty advisor' }, hello: { vi: 'Chào bạn, mình giúp soi da nhé?', en: 'Hi, shall I scan your skin?' }, chips: [], picks: [] },
  theo: { name: 'Theo', hue: 150, role: { vi: 'Chuyên gia không gian', en: 'Space stylist' }, hello: { vi: 'Bạn muốn làm mới góc nào?', en: 'Which corner shall we refresh?' }, chips: [], picks: [] },
  vi:   { name: 'Vi',   hue: 250, role: { vi: 'Chuyên gia công nghệ', en: 'Tech specialist' }, hello: { vi: 'Bạn cần thiết bị cho việc gì?', en: 'What do you need a device for?' }, chips: [], picks: [] },
};

export const PRODUCTS: Product[] = [
  { id: 'linen',    shop: 'aria', price: 590000,  rating: 4.8, sold: 1240,
    name: { vi: 'Áo Sơ Mi Linen Oversized', en: 'Linen Oversized Shirt' },
    tag:  { vi: 'Bán chạy', en: 'Bestseller' },
    desc: { vi: 'Linen 100% thấm hút, form rộng thoải mái, lên dáng tối giản.', en: '100% breathable linen, relaxed fit, clean minimal drape.' },
    colors: ['#e9e4d8','#9fb8ad','#33403d'], sizes: ['S','M','L','XL'] },
  { id: 'skirt',    shop: 'aria', price: 720000,  rating: 4.7, sold: 860,
    name: { vi: 'Chân Váy Xếp Ly Midi', en: 'Pleated Midi Skirt' },
    tag:  { vi: 'Mới', en: 'New' },
    desc: { vi: 'Xếp ly sắc nét, chuyển động mềm, dài qua gối.', en: 'Crisp pleats, soft movement, falls below the knee.' },
    colors: ['#cdd6d0','#b9a98c','#3a4a55'], sizes: ['S','M','L'] },
  { id: 'blazer',   shop: 'aria', price: 1290000, rating: 4.9, sold: 540,
    name: { vi: 'Blazer Dáng Cứng', en: 'Structured Blazer' },
    tag:  { vi: 'Cao cấp', en: 'Premium' },
    desc: { vi: 'Vải dệt dày có form, vai dựng nhẹ, khóa 1 hàng nút.', en: 'Firm woven fabric, lightly built shoulders, single-breasted.' },
    colors: ['#2d3a3a','#6e7b73','#d8d2c4'], sizes: ['S','M','L','XL'] },
  { id: 'knit',     shop: 'aria', price: 650000,  rating: 4.6, sold: 1530,
    name: { vi: 'Áo Len Dệt Kim', en: 'Knit Sweater' },
    tag:  { vi: 'Yêu thích', en: 'Loved' },
    desc: { vi: 'Sợi mềm giữ ấm, dệt vân nhẹ, cổ tròn.', en: 'Soft warm yarn, subtle ribbed knit, crew neck.' },
    colors: ['#e7d9c5','#a7bcae','#43504c'], sizes: ['M','L','XL'] },
  { id: 'trousers', shop: 'aria', price: 780000,  rating: 4.7, sold: 690,
    name: { vi: 'Quần Âu May Đo', en: 'Tailored Trousers' },
    tag:  { vi: 'Mới', en: 'New' },
    desc: { vi: 'Cạp cao, ống suông, ly lê li gia cố dáng.', en: 'High waist, straight leg, pressed crease for structure.' },
    colors: ['#3a4040','#8a8170','#cfc9bb'], sizes: ['S','M','L','XL'] },
  { id: 'tote',     shop: 'aria', price: 350000,  rating: 4.8, sold: 2100,
    name: { vi: 'Túi Tote Canvas', en: 'Canvas Tote' },
    tag:  { vi: 'Bán chạy', en: 'Bestseller' },
    desc: { vi: 'Canvas dày, quai da, ngăn trong tiện dụng.', en: 'Heavy canvas, leather straps, handy inner pocket.' },
    colors: ['#d9d2c1','#9fb8ad','#3a4a55'], sizes: ['One'] },
];

export const productById = (id: string): Product | undefined =>
  PRODUCTS.find((p) => p.id === id);
