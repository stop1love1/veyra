/* eslint-disable no-console */
/**
 * Veyra seed script.
 *
 * Runnable via: `npm run seed` (ts-node src/seed/seed.ts).
 *
 * What it does (all idempotent — safe to re-run):
 *   1. Connects to Mongo (MONGO_URI env or mongodb://127.0.0.1:27017/veyra).
 *   2. Upserts an admin, a demo seller, and a demo user (bcrypt-hashed pwds).
 *   3. Registers the Kenney City Kit GLB pieces (buildings + roads/lights) as
 *      Items in the asset library, enumerating the real files on disk.
 *   4. Builds a published "world" map (slug `veyra-central`): a central
 *      roundabout, four straight-road avenues, buildings lining them, street
 *      lights, plus shop/npc slots — mirroring the client's worldKit layout but
 *      computed self-contained in a loop and persisted as MapInstance docs.
 *
 * It upserts by unique keys (user.email, item.key, map.slug) and prints a
 * summary. It does NOT require a live Mongo to type-check.
 */
import * as bcrypt from 'bcryptjs';
import { readdirSync } from 'fs';
import { join } from 'path';
import mongoose, { Model, Types } from 'mongoose';

import { Role } from '../common/roles.enum';
import { I18nType } from '../common/i18n';

import { User, UserSchema } from '../users/schemas/user.schema';
import {
  Item,
  ItemCategory,
  ItemSchema,
} from '../items/schemas/item.schema';
import { Map as MapEntity, MapSchema } from '../maps/schemas/map.schema';
import {
  MapInstance,
  MapInstanceSchema,
} from '../maps/schemas/map-instance.schema';
import { Shop, ShopSchema } from '../shops/schemas/shop.schema';
import { Npc, NpcSchema } from '../npcs/schemas/npc.schema';
import { Quest, QuestSchema } from '../quests/schemas/quest.schema';
import { Voucher, VoucherSchema } from '../vouchers/schemas/voucher.schema';
import {
  Collection,
  CollectionSchema,
} from '../collections/schemas/collection.schema';

// ── Config ──────────────────────────────────────────────────────────────────

const MONGO_URI =
  process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/veyra';

// Where the client serves the GLBs from, and where they physically live so we
// can enumerate the real filenames. URLs are the *served* paths the client
// fetches; the on-disk dir is only read to discover what exists.
const CLIENT_PUBLIC = join(__dirname, '../../../client/public');
const CITYKIT_DIR = join(CLIENT_PUBLIC, 'models/citykit');
const ROADS_DIR = join(CLIENT_PUBLIC, 'models/citykit-roads');
const CITYKIT_URL = '/models/citykit';
const ROADS_URL = '/models/citykit-roads';

// Layout constants — mirror worldKit.ts so the seeded world reads like the
// hard-coded client one (tile footprint, avenue length, spawn).
const TILE = 7; // one placed tile spans ~7 world units (= transformDefaults.scale)
const ARM = 6; // straight-road tiles per avenue
const START_T = 2; // first road tile index out from the roundabout
const ROUNDABOUT_R = TILE * 1.4;

// ── Small helpers ────────────────────────────────────────────────────────────

const i18n = (vi: string, en: string): I18nType => ({ vi, en });

/** Title-case a kebab key fragment for a readable English name. */
function titleize(s: string): string {
  return s
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Enumerate *.glb files in a directory (sorted), ignoring sub-dirs. */
function listGlbs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.glb'))
    .map((d) => d.name.replace(/\.glb$/i, ''))
    .sort();
}

// ── Item categorisation ──────────────────────────────────────────────────────

interface ItemSpec {
  key: string;
  name: I18nType;
  category: ItemCategory;
  url: string;
  tags: string[];
  collision: { type: 'none' | 'circle' | 'box'; radius?: number };
  walkable: boolean;
}

/**
 * Classify a citykit (build:) filename → an Item spec.
 * Buildings get a blocking circle collider; small decorative details are props.
 */
function buildItem(file: string): ItemSpec {
  const isDetail = file.startsWith('detail-');
  const isLowDetail = file.startsWith('low-detail-');
  const isSkyscraper = file.startsWith('building-skyscraper-');
  const isBuilding = file.startsWith('building-') || isLowDetail;

  let category: ItemCategory = 'building';
  let tags: string[] = ['building'];
  let collision: ItemSpec['collision'] = { type: 'circle', radius: 4.5 };
  let walkable = false;

  if (isDetail) {
    category = 'prop';
    tags = ['detail', 'streetside'];
    collision = { type: 'none' };
    walkable = true;
  } else if (isSkyscraper) {
    tags = ['building', 'skyscraper', 'tall'];
    collision = { type: 'circle', radius: 5.5 };
  } else if (isLowDetail) {
    tags = ['building', 'low-detail', 'skyline'];
    collision = { type: 'circle', radius: 4.5 };
  } else if (isBuilding) {
    tags = ['building', 'storefront'];
  }

  return {
    key: `build:${file}`,
    name: i18n(`Tòa nhà ${titleize(file)}`, titleize(file)),
    category,
    url: `${CITYKIT_URL}/${file}.glb`,
    tags,
    collision,
    walkable,
  };
}

/**
 * Classify a citykit-roads (road:) filename → an Item spec.
 * Roads/tiles are walkable ground (no collision); lights/signs/barriers block.
 */
function roadItem(file: string): ItemSpec {
  let category: ItemCategory = 'road';
  let tags: string[] = ['road'];
  let collision: ItemSpec['collision'] = { type: 'none' };
  let walkable = true;

  if (file.startsWith('light-')) {
    category = 'light';
    tags = ['light', 'streetlight'];
    collision = { type: 'circle', radius: 0.8 };
    walkable = true;
  } else if (file.startsWith('sign-')) {
    category = 'sign';
    tags = ['sign', 'highway'];
    collision = { type: 'circle', radius: 0.8 };
    walkable = true;
  } else if (file.startsWith('construction-')) {
    category = 'prop';
    tags = ['construction', 'barrier'];
    collision = { type: 'circle', radius: 0.8 };
    walkable = true;
  } else if (file.startsWith('bridge-')) {
    category = 'prop';
    tags = ['bridge'];
    collision = { type: 'circle', radius: 1.2 };
    walkable = false;
  } else if (file.startsWith('tile-')) {
    category = 'ground';
    tags = ['tile', 'ground'];
    collision = { type: 'none' };
    walkable = true;
  } else {
    // road-* family
    category = 'road';
    tags = ['road', file.replace(/^road-/, '')];
    collision = { type: 'none' };
    walkable = true;
  }

  return {
    key: `road:${file}`,
    name: i18n(titleize(file), titleize(file)),
    category,
    url: `${ROADS_URL}/${file}.glb`,
    tags,
    collision,
    walkable,
  };
}

// ── Seed routine ─────────────────────────────────────────────────────────────

async function seed(): Promise<void> {
  console.log(`[seed] connecting to ${MONGO_URI} …`);
  await mongoose.connect(MONGO_URI);

  // Bind models directly to the schemas exported by the modules. Use the same
  // model names Nest registers (the class names) so refs (ref:'User' etc.) line up.
  const Users: Model<User> = mongoose.model<User>(User.name, UserSchema);
  const Items: Model<Item> = mongoose.model<Item>(Item.name, ItemSchema);
  const Maps: Model<MapEntity> = mongoose.model<MapEntity>(
    MapEntity.name,
    MapSchema,
  );
  const Instances: Model<MapInstance> = mongoose.model<MapInstance>(
    MapInstance.name,
    MapInstanceSchema,
  );
  const Shops: Model<Shop> = mongoose.model<Shop>(Shop.name, ShopSchema);
  const Npcs: Model<Npc> = mongoose.model<Npc>(Npc.name, NpcSchema);
  const Vouchers: Model<Voucher> = mongoose.model<Voucher>(
    Voucher.name,
    VoucherSchema,
  );
  const Quests: Model<Quest> = mongoose.model<Quest>(Quest.name, QuestSchema);
  const Collections: Model<Collection> = mongoose.model<Collection>(
    Collection.name,
    CollectionSchema,
  );

  // ── 1. Users (upsert by email) ────────────────────────────────────────────
  async function upsertUser(
    email: string,
    password: string | null,
    name: string,
    role: Role,
    extra: Partial<User> = {},
  ): Promise<Types.ObjectId> {
    const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;
    const set: Record<string, unknown> = { name, role, ...extra };
    if (passwordHash) set.passwordHash = passwordHash;
    const doc = await Users.findOneAndUpdate(
      { email },
      { $set: set, $setOnInsert: { email } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec();
    return doc._id as Types.ObjectId;
  }

  const adminId = await upsertUser(
    'admin@veyra.dev',
    'admin1234',
    'Veyra Admin',
    Role.Admin,
    { status: 'active', coins: 999999 },
  );
  const sellerId = await upsertUser(
    'seller@veyra.dev',
    'seller1234',
    'Demo Seller',
    Role.Seller,
    {
      status: 'active',
      sellerProfile: {
        displayName: 'Demo Seller',
        bio: 'Cửa hàng demo của Veyra',
        approved: true,
      },
    },
  );
  const userId = await upsertUser(
    'user@veyra.dev',
    'user1234',
    'Demo User',
    Role.User,
    { status: 'active', coins: 1280 },
  );
  console.log(`[seed] users ok (admin=${adminId.toString()})`);

  // ── 2. Items (upsert by key) ──────────────────────────────────────────────
  const buildFiles = listGlbs(CITYKIT_DIR);
  const roadFiles = listGlbs(ROADS_DIR);
  const specs: ItemSpec[] = [
    ...buildFiles.map(buildItem),
    ...roadFiles.map(roadItem),
  ];

  // key -> _id, so the map builder can reference items by logical key.
  const itemIdByKey = new Map<string, Types.ObjectId>();
  for (const s of specs) {
    const doc = await Items.findOneAndUpdate(
      { key: s.key },
      {
        $set: {
          name: s.name,
          category: s.category,
          source: 'kenney',
          license: 'CC0 (Kenney City Kit)',
          asset: { glb: { url: s.url } },
          transformDefaults: { scale: TILE, yOffset: 0, faceAxis: '+z' },
          collision: s.collision,
          snap: { gridTiles: 1, walkable: s.walkable },
          tags: s.tags,
          status: 'active',
          createdBy: adminId,
        },
        $setOnInsert: { key: s.key, version: 1 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec();
    itemIdByKey.set(s.key, doc._id as Types.ObjectId);
  }
  console.log(`[seed] items ok (${specs.length} registered)`);

  // Resolve an item key -> _id (throws clearly if a referenced piece is missing
  // from disk, rather than silently producing dangling instances).
  function itemId(key: string): Types.ObjectId {
    const id = itemIdByKey.get(key);
    if (!id) throw new Error(`[seed] missing item for key '${key}'`);
    return id;
  }

  // ── 3. World map (upsert by slug) ─────────────────────────────────────────
  const mapDoc = await Maps.findOneAndUpdate(
    { slug: 'veyra-central' },
    {
      $set: {
        name: 'Veyra Central',
        kind: 'world',
        description:
          'Khu mua sắm trung tâm của Veyra — vòng xuyến trung tâm, các đại lộ và dãy cửa hàng.',
        tileSize: TILE,
        environment: {
          skyColor: '#9fd4ea',
          sun: {
            intensity: 2.1,
            azimuth: 0.7,
            elevation: 0.9,
            color: '#fff2da',
          },
          fog: { near: 180, far: 900, color: '#bfe0d8' },
          ibl: 'room',
        },
        bounds: { outerRadius: (START_T + ARM + 2.5) * TILE },
      },
      $setOnInsert: { slug: 'veyra-central', createdBy: adminId, version: 1 },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).exec();
  const mapId = mapDoc._id as Types.ObjectId;

  // Rebuild the instance set deterministically: clear this map's instances then
  // re-emit, so re-running stays idempotent (no duplicate placements).
  await Instances.deleteMany({ mapId }).exec();

  type InstanceDoc = {
    mapId: Types.ObjectId;
    itemId: Types.ObjectId;
    transform: { pos: { x: number; y: number; z: number }; rot: { x: number; y: number; z: number }; scale: number };
    layer: 'ground' | 'roads' | 'buildings' | 'props' | 'skyline';
    shadow: boolean;
  };
  const instances: InstanceDoc[] = [];
  const shopSlotPositions: { x: number; z: number; ry: number }[] = [];

  function place(
    key: string,
    x: number,
    z: number,
    ry: number,
    layer: InstanceDoc['layer'],
  ): void {
    instances.push({
      mapId,
      itemId: itemId(key),
      transform: { pos: { x, y: 0, z }, rot: { x: 0, y: ry, z: 0 }, scale: TILE },
      layer,
      shadow: layer !== 'skyline',
    });
  }

  // Central roundabout at the origin.
  place('road:road-roundabout', 0, 0, 0, 'roads');

  // Building catalogue cycled deterministically along the avenues.
  const BUILD = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n'];
  const SKY = ['a', 'b', 'c', 'd', 'e'];

  // Four avenues N/S (along Z) and E/W (along X).
  const arms = [
    { dx: 0, dz: 1, roadRy: 0 },
    { dx: 0, dz: -1, roadRy: Math.PI },
    { dx: 1, dz: 0, roadRy: -Math.PI / 2 },
    { dx: -1, dz: 0, roadRy: Math.PI / 2 },
  ];

  let buildCursor = 0;
  for (const { dx, dz, roadRy } of arms) {
    const px = -dz;
    const pz = dx; // perpendicular (sidewalk / building offset axis)
    for (let i = START_T; i < START_T + ARM; i++) {
      const x = dx * i * TILE;
      const z = dz * i * TILE;
      place('road:road-straight', x, z, roadRy, 'roads');

      // sidewalks + buildings on both sides
      for (const sgn of [1, -1]) {
        place(
          'road:road-side',
          x + px * sgn * TILE,
          z + pz * sgn * TILE,
          roadRy + (sgn > 0 ? 0 : Math.PI),
          'roads',
        );
        const bx = x + px * sgn * 2 * TILE;
        const bz = z + pz * sgn * 2 * TILE;
        const faceRy = Math.atan2(-px * sgn, -pz * sgn); // face the avenue centreline
        const nearPlaza = i <= START_T + 1;
        // skyscrapers anchor the plaza corners; storefronts line the rest
        const key = nearPlaza
          ? `build:building-skyscraper-${SKY[buildCursor % SKY.length]}`
          : `build:building-${BUILD[buildCursor % BUILD.length]}`;
        place(key, bx, bz, faceRy, 'buildings');
        buildCursor++;

        // the two storefronts closest to the plaza on each avenue become shop slots
        if (i === START_T) {
          shopSlotPositions.push({
            x: bx + Math.sin(faceRy) * (TILE * 0.9),
            z: bz + Math.cos(faceRy) * (TILE * 0.9),
            ry: faceRy + Math.PI,
          });
        }
      }

      // street lights at intervals on the sidewalk edge
      if (i % 2 === 0) {
        place(
          'road:light-square',
          x + px * 0.75 * TILE,
          z + pz * 0.75 * TILE,
          roadRy,
          'props',
        );
        place(
          'road:light-square',
          x - px * 0.75 * TILE,
          z - pz * 0.75 * TILE,
          roadRy + Math.PI,
          'props',
        );
      }
    }
  }

  // A couple of awnings near the plaza for street character.
  place('build:detail-awning', 2 * TILE, START_T * TILE, Math.PI, 'props');
  place('build:detail-parasol-a', -2 * TILE, START_T * TILE, Math.PI, 'props');

  await Instances.insertMany(instances);

  // ── Shops + NPCs that attach into the map slots ───────────────────────────
  const shopDoc = await Shops.findOneAndUpdate(
    { slug: 'demo-boutique' },
    {
      $set: {
        sellerId,
        name: i18n('Cửa hàng Demo', 'Demo Boutique'),
        category: i18n('Thời trang', 'Fashion'),
        blurb: i18n(
          'Cửa hàng demo ngay cạnh quảng trường trung tâm.',
          'A demo storefront right by the central plaza.',
        ),
        hue: 200,
        featured: true,
        status: 'published',
      },
      $setOnInsert: { slug: 'demo-boutique' },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).exec();
  const shopId = shopDoc._id as Types.ObjectId;

  const npcDoc = await Npcs.findOneAndUpdate(
    { name: 'Lan the Greeter' },
    {
      $set: {
        persona: i18n('Hướng dẫn viên', 'Town Greeter'),
        appearance: { hue: 320, skin: 1, style: 'casual' },
        dialogue: [
          {
            id: 'hello',
            lines: [
              i18n(
                'Chào mừng đến Veyra Central!',
                'Welcome to Veyra Central!',
              ),
            ],
          },
        ],
        shopId,
        behavior: { kind: 'idle' },
        status: 'active',
        createdBy: adminId,
      },
      $setOnInsert: { name: 'Lan the Greeter' },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).exec();
  const npcId = npcDoc._id as Types.ObjectId;

  // Attach the shop to the first slot and the greeter NPC to the second.
  const a = shopSlotPositions[0];
  const b = shopSlotPositions[1] ?? shopSlotPositions[0];
  const spawnZ = (START_T + 1.5) * TILE;
  await Maps.updateOne(
    { _id: mapId },
    {
      $set: {
        status: 'published',
        publishedAt: new Date(),
        spawnPoints: [
          { id: 's1', pos: { x: 0, z: spawnZ }, ry: Math.PI },
        ],
        shopSlots: [
          { id: 'shop-1', pos: { x: a.x, z: a.z }, ry: a.ry, shopId },
        ],
        npcSlots: [
          { id: 'npc-1', pos: { x: b.x, z: b.z }, ry: b.ry, npcId },
        ],
      },
    },
  ).exec();

  console.log(`[seed] map 'veyra-central' published (${instances.length} instances)`);

  // ── 4. Vouchers (upsert by code) ──────────────────────────────────────────
  // Platform-wide reward vouchers granted by the Renown quest ladder.
  async function upsertVoucher(
    code: string,
    type: 'percent' | 'amount' | 'freeship',
    value: number,
  ): Promise<Types.ObjectId> {
    const doc = await Vouchers.findOneAndUpdate(
      { code },
      { $set: { type, value }, $setOnInsert: { code, uses: 0 } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec();
    return doc._id as Types.ObjectId;
  }
  const voucherIdByCode = new Map<string, Types.ObjectId>([
    ['WELCOME10', await upsertVoucher('WELCOME10', 'percent', 10)],
    ['VEYRA50', await upsertVoucher('VEYRA50', 'amount', 50000)],
    ['FREESHIP', await upsertVoucher('FREESHIP', 'freeship', 0)],
    // Day-7 daily-streak milestone reward.
    ['STREAK7', await upsertVoucher('STREAK7', 'percent', 15)],
  ]);
  console.log(`[seed] vouchers ok (${voucherIdByCode.size})`);

  // ── 5. Quests (upsert by key) — the Renown story ladder ───────────────────
  interface QuestSpec {
    key: string;
    title: I18nType;
    source: string;
    goal: number;
    chapter: number;
    renown: number;
    coins?: number;
    voucher?: string;
    daily?: boolean;
    locked?: boolean;
  }
  const questSpecs: QuestSpec[] = [
    // Chapter 0 — daily
    { key: 'd-checkin', chapter: 0, daily: true, source: 'daily', goal: 1, renown: 10, coins: 20, title: i18n('Điểm danh Veyra', 'Veyra check-in') },
    { key: 'd-stroll', chapter: 0, daily: true, source: 'explore', goal: 1, renown: 5, title: i18n('Dạo 1 quận bất kỳ', 'Stroll a district') },
    // Chapter 1 — Khách quen (Aria · Mira)
    { key: 'c1-explore', chapter: 1, source: 'explore', goal: 3, renown: 30, coins: 50, title: i18n('Khám phá 3 cửa hàng', 'Explore 3 shops') },
    { key: 'c1-stylist', chapter: 1, source: 'stylist', goal: 1, renown: 30, voucher: 'WELCOME10', title: i18n('Trò chuyện cùng stylist Mira', 'Chat with stylist Mira') },
    { key: 'c1-curate', chapter: 1, source: 'curate', goal: 3, renown: 20, coins: 30, title: i18n('Lưu 3 món vào yêu thích', 'Save 3 favorites') },
    // Chapter 2 — Cư dân (Lumen · Noa)
    { key: 'c2-stylist', chapter: 2, source: 'stylist', goal: 1, renown: 30, coins: 50, title: i18n('Soi da & tư vấn cùng Noa', 'Skin scan with Noa') },
    { key: 'c2-buy', chapter: 2, source: 'purchase', goal: 1, renown: 60, voucher: 'FREESHIP', title: i18n('Hoàn tất đơn hàng đầu tiên', 'Complete first order') },
    { key: 'c2-look', chapter: 2, source: 'curate', goal: 3, renown: 40, title: i18n('Phối 1 "look" hoàn chỉnh', 'Style a full look') },
    // Chapter 3 — Người sành điệu (Nest · Theo)
    { key: 'c3-cats', chapter: 3, source: 'purchase', goal: 2, renown: 60, coins: 80, title: i18n('Mua ở 2 danh mục khác nhau', 'Buy across 2 categories') },
    { key: 'c3-collection', chapter: 3, source: 'curate', goal: 1, renown: 80, title: i18n('Hoàn thành 1 bộ sưu tập look', 'Complete a look collection') },
    { key: 'c3-review', chapter: 3, source: 'curate', goal: 1, renown: 40, coins: 50, title: i18n('Đánh giá 1 sản phẩm đã mua', 'Review a purchase') },
    // Chapter 4 — Công dân Veyra (Pulse · Vi)
    { key: 'c4-allfour', chapter: 4, source: 'explore', goal: 4, renown: 60, coins: 100, title: i18n('Ghé đủ cả 4 quận', 'Visit all 4 districts') },
    { key: 'c4-loyal', chapter: 4, source: 'purchase', goal: 3, renown: 120, voucher: 'VEYRA50', title: i18n('Đạt mốc chi tiêu trung thành', 'Reach loyalty spend') },
    { key: 'c4-qr', chapter: 4, source: 'qr-scan', goal: 1, renown: 150, locked: true, title: i18n('Quét QR tại cửa hàng thật', 'Scan QR at a real store') },
  ];
  for (const q of questSpecs) {
    const reward: Record<string, unknown> = { renown: q.renown };
    if (q.coins) reward.coins = q.coins;
    if (q.voucher) reward.voucherId = voucherIdByCode.get(q.voucher);
    await Quests.findOneAndUpdate(
      { key: q.key },
      {
        $set: {
          title: q.title,
          goal: { type: q.source, count: q.goal },
          reward,
          source: q.source,
          chapter: q.chapter,
          daily: !!q.daily,
          locked: !!q.locked,
          active: true,
        },
        $setOnInsert: { key: q.key },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec();
  }
  console.log(`[seed] quests ok (${questSpecs.length})`);

  // ── 6. Collections (upsert by key) — Collector look sets ──────────────────
  const collectionSpecs = [
    {
      key: 'work-elegant',
      title: i18n('Thanh lịch công sở', 'Office Elegant'),
      productIds: ['blazer', 'trousers', 'tote'],
      styledReward: { coins: 40, renown: 30 },
      ownedReward: { coins: 200, renown: 80, voucherCode: 'WELCOME10' },
    },
    {
      key: 'weekend-casual',
      title: i18n('Dạo phố cuối tuần', 'Weekend Casual'),
      productIds: ['linen', 'skirt', 'knit'],
      styledReward: { coins: 40, renown: 30 },
      ownedReward: { coins: 200, renown: 80, voucherCode: 'FREESHIP' },
    },
  ];
  for (const c of collectionSpecs) {
    await Collections.findOneAndUpdate(
      { key: c.key },
      {
        $set: {
          title: c.title,
          productIds: c.productIds,
          styledReward: c.styledReward,
          ownedReward: c.ownedReward,
          active: true,
        },
        $setOnInsert: { key: c.key },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec();
  }
  console.log(`[seed] collections ok (${collectionSpecs.length})`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('────────────────────────────────────────────');
  console.log('Veyra seed summary');
  console.log(`  users     : 3 (admin / seller / user)`);
  console.log(`  items     : ${specs.length}  (build:${buildFiles.length}, road:${roadFiles.length})`);
  console.log(`  map       : veyra-central (published)`);
  console.log(`  instances : ${instances.length}`);
  console.log(`  shopSlots : 1   npcSlots: 1   shops: 1   npcs: 1`);
  console.log('────────────────────────────────────────────');
  void userId;
  void npcId;

  await mongoose.disconnect();
}

seed()
  .then(() => {
    console.log('[seed] done.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  });
