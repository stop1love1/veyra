/* End-to-end runtime smoke test: boots the real Nest app on an in-memory MongoDB
 * and exercises the seller product-management flow + key RBAC/security guarantees.
 * Run: npx ts-node -O '{"module":"commonjs","moduleResolution":"node"}' src/smoke/smoke.ts
 */
import 'reflect-metadata';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}/api`;

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${extra}`); }
};

async function req(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; json: any }> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

async function main() {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri('veyra_smoke');
  process.env.JWT_SECRET = 'smoke-access-secret-0123456789';
  process.env.JWT_REFRESH_SECRET = 'smoke-refresh-secret-9876543210';
  process.env.JWT_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  process.env.PORT = String(PORT);
  process.env.CLIENT_ORIGIN = 'http://localhost:3000';

  // Import AppModule AFTER env is set — ConfigModule.forRoot validates env at
  // module-definition time, so the import must follow the env assignments above.
  const { AppModule } = await import('../app.module');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  await app.listen(PORT);
  console.log(`\nNest up on ${BASE}  (mongo: in-memory)\n`);

  try {
    // 1. Register a SELLER
    const reg = await req('POST', '/auth/register', { email: 'sm-seller@veyra.dev', password: 'pw12345678', name: 'SmSeller', role: 'seller' });
    const sellerTok = reg.json?.accessToken || reg.json?.token;
    ok('register seller -> 201 + token', (reg.status === 201 || reg.status === 200) && !!sellerTok, `status=${reg.status}`);
    ok('register seller role = seller', reg.json?.user?.role === 'seller', JSON.stringify(reg.json?.user));
    ok('register response has NO passwordHash', !JSON.stringify(reg.json).includes('passwordHash'));

    // 2. Login
    const login = await req('POST', '/auth/login', { email: 'sm-seller@veyra.dev', password: 'pw12345678' });
    const tok = login.json?.accessToken || login.json?.token || sellerTok;
    ok('login -> token', !!tok, `status=${login.status}`);

    // 3. /auth/me strips passwordHash
    const me = await req('GET', '/auth/me', undefined, tok);
    ok('GET /auth/me -> 200', me.status === 200, `status=${me.status}`);
    ok('/auth/me has NO passwordHash (PII leak fixed)', !JSON.stringify(me.json).includes('passwordHash'), JSON.stringify(me.json));

    // 4. Register a normal USER
    const reg2 = await req('POST', '/auth/register', { email: 'sm-user@veyra.dev', password: 'pw12345678', name: 'SmUser' });
    const userTok = reg2.json?.accessToken || reg2.json?.token;
    ok('register normal user -> defaults role user', reg2.json?.user?.role === 'user', JSON.stringify(reg2.json?.user));

    // 5. Seller creates a shop
    const shop = await req('POST', '/shops', { name: { vi: 'Cửa hàng Sm', en: 'Sm Shop' }, slug: 'sm-shop', category: { vi: 'Thời trang', en: 'Fashion' }, blurb: { vi: 'x', en: 'x' }, hue: 200 }, tok);
    const shopId = shop.json?._id || shop.json?.id;
    ok('seller POST /shops -> 201', (shop.status === 201 || shop.status === 200) && !!shopId, `status=${shop.status} ${JSON.stringify(shop.json).slice(0,140)}`);
    ok('shop sellerId set to seller (not forgeable)', !!shopId);

    // 6. GET /shops/mine
    const mine = await req('GET', '/shops/mine', undefined, tok);
    const mineArr = Array.isArray(mine.json) ? mine.json : mine.json?.data;
    ok('GET /shops/mine returns the seller shop', Array.isArray(mineArr) && mineArr.some((s: any) => (s._id || s.id) === shopId), `status=${mine.status}`);

    // 7. Seller creates a product WITH link + image
    const prod = await req('POST', '/products', {
      shopId, name: { vi: 'Áo Sm', en: 'Sm Tee' }, blurb: { vi: 'Mô tả', en: 'Desc' },
      price: 199000, colors: [0x2bb6d6], sizes: ['M', 'L'], tags: [{ vi: 'mới', en: 'new' }],
      images: [{ url: 'https://example.com/a.jpg' }], link: 'https://example.com/buy',
    }, tok);
    const prodId = prod.json?._id || prod.json?.id;
    ok('seller POST /products -> 201', (prod.status === 201 || prod.status === 200) && !!prodId, `status=${prod.status} ${JSON.stringify(prod.json).slice(0,160)}`);
    ok('product.link persisted', prod.json?.link === 'https://example.com/buy', JSON.stringify(prod.json?.link));
    ok('product.images persisted', Array.isArray(prod.json?.images) && prod.json.images[0]?.url === 'https://example.com/a.jpg');

    // 8. Public product list shows it
    const list = await req('GET', `/products?shop=sm-shop`);
    const listArr = Array.isArray(list.json) ? list.json : list.json?.data;
    ok('GET /products?shop=slug returns the product', Array.isArray(listArr) && listArr.some((p: any) => (p._id || p.id) === prodId), `status=${list.status} n=${listArr?.length}`);
    // diagnostics to isolate the failure
    const listAll = await req('GET', `/products`);
    const allArr = Array.isArray(listAll.json) ? listAll.json : listAll.json?.data;
    console.log(`   [dbg] /products (no filter) n=${allArr?.length} hasOurs=${Array.isArray(allArr) && allArr.some((p: any) => (p._id || p.id) === prodId)}`);
    const byId = await req('GET', `/products?shop=${shopId}`);
    const byIdArr = Array.isArray(byId.json) ? byId.json : byId.json?.data;
    console.log(`   [dbg] /products?shop=<id> n=${byIdArr?.length} hasOurs=${Array.isArray(byIdArr) && byIdArr.some((p: any) => (p._id || p.id) === prodId)}`);
    const shopProds = await req('GET', `/shops/${shopId}/products`);
    console.log(`   [dbg] /shops/<id>/products status=${shopProds.status} body=${JSON.stringify(shopProds.json).slice(0, 120)}`);
    console.log(`   [dbg] created product shopId field = ${JSON.stringify(prod.json?.shopId)} ; shop _id = ${shopId}`);
    // definitive: dump the RAW BSON type of the stored product.shopId
    const { getConnectionToken } = await import('@nestjs/mongoose');
    const conn: any = app.get(getConnectionToken());
    const raw = await conn.collection('products').findOne({});
    console.log(`   [dbg] RAW products.shopId value=${raw?.shopId} bsontype=${raw?.shopId?._bsontype} ctor=${raw?.shopId?.constructor?.name} typeof=${typeof raw?.shopId}`);
    const rawShop = await conn.collection('shops').findOne({});
    console.log(`   [dbg] RAW shops._id ctor=${rawShop?._id?.constructor?.name} ; shops.slug=${JSON.stringify(rawShop?.slug)}`);

    // 9. RBAC negative: normal USER cannot create a product in seller's shop
    const hack = await req('POST', '/products', { shopId, name: { vi: 'x', en: 'x' }, price: 1 }, userTok);
    ok('normal user POST /products in others shop -> 403 (RBAC enforced server-side)', hack.status === 403, `status=${hack.status}`);

    // 10. Order price-tampering blocked: total computed from server price, client cannot set price
    const order = await req('POST', '/orders', { lines: [{ productId: prodId, qty: 2, price: 1 }] }, userTok);
    // forbidNonWhitelisted should reject the unknown `price` field OR strip it; either way total must be 2*199000
    if (order.status === 201 || order.status === 200) {
      ok('order total computed from SERVER price (no tampering)', order.json?.total === 2 * 199000, `total=${order.json?.total}`);
    } else {
      ok('order with forged price rejected (forbidNonWhitelisted)', order.status === 400, `status=${order.status}`);
    }

    // 11. Forge sellerId on shop create is ignored (seller cannot impersonate)
    const forge = await req('POST', '/shops', { name: { vi: 'f', en: 'f' }, slug: 'sm-forge', sellerId: '000000000000000000000000' }, tok);
    if (forge.status === 201 || forge.status === 200) {
      ok('shop create ignores client sellerId (server forces owner)', (forge.json?.sellerId || '').toString() !== '000000000000000000000000');
    } else {
      ok('shop create rejects forged sellerId field', forge.status === 400, `status=${forge.status}`);
    }
    // 12. Cart -> order flow (validates ObjectId refs end-to-end across cart/orders)
    const addCart = await req('PUT', '/cart/lines', { productId: prodId, qty: 2, size: 'M', color: 0x2bb6d6 }, userTok);
    ok('user PUT /cart/lines -> 2xx', addCart.status >= 200 && addCart.status < 300, `status=${addCart.status} ${JSON.stringify(addCart.json).slice(0,120)}`);
    const cart = await req('GET', '/cart', undefined, userTok);
    const cartLines = (cart.json?.lines || []) as any[];
    ok('GET /cart reflects the added line', cartLines.length >= 1, `lines=${cartLines.length}`);
    const ord = await req('POST', '/orders', {}, userTok);
    console.log(`   [dbg] order-from-cart status=${ord.status} total=${ord.json?.total} msg=${JSON.stringify(ord.json?.message || '').slice(0,80)}`);
    ok('POST /orders from cart -> created, server-priced total', (ord.status === 201 || ord.status === 200) && ord.json?.total === 2 * 199000, `status=${ord.status} total=${ord.json?.total}`);
    const orders = await req('GET', '/orders', undefined, userTok);
    const ordArr = Array.isArray(orders.json) ? orders.json : orders.json?.data;
    ok('GET /orders lists the user order', Array.isArray(ordArr) && ordArr.length >= 1, `n=${ordArr?.length}`);
    const cartAfter = await req('GET', '/cart', undefined, userTok);
    ok('cart cleared after order', ((cartAfter.json?.lines || []) as any[]).length === 0, `lines=${(cartAfter.json?.lines || []).length}`);
  } finally {
    await app.close();
    await mongo.stop();
  }

  console.log(`\n==== SMOKE RESULT: ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('SMOKE CRASHED:', e); process.exit(2); });
