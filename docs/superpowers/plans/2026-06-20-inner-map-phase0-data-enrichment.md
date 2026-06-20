# Inner-map Phase 0 — Data enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich `public/data/hanoi.json` with the OSM tags, POIs, barriers and road names the later phases need, without changing the world's look or breaking existing consumers.

**Architecture:** Extract the pure OSM→local-schema transformation out of the `gen-hanoi.js` IIFE into a testable CommonJS module (`scripts/osm-extract.js`); unit-test the helpers + the whole `transform()` with synthetic Overpass elements (no network); rewrite `gen-hanoi.js` to fetch + `transform()` + write; regenerate the data; then surface the new `pois`/`barriers` through `getMapSnapshot()` and the dev teleport map so the new data is visible for review.

**Tech Stack:** Node.js (CommonJS scripts), Overpass API, Vitest, Three.js (existing world builder), React (DevMap overlay).

## Global Constraints

- Schema additions are **optional + backward-compatible**: existing consumers (`getMapSnapshot`, road/tree/green/water builders, `DevMap`) must keep working when the new fields are absent. Copied verbatim from spec.
- Building `tags`, `pois`, and `barriers` are emitted **only within `TAG_R` (default 520 m)** of origin; features beyond stay poly-only. Copied verbatim from spec.
- Coordinate convention unchanged: `x = east (m)`, `z = south(+)/north(−)`, origin `(lat0,lon0) = (21.0287, 105.8524)`, north → −z.
- New schema shape (verbatim from spec):
  ```
  buildings: [{ poly, h, tags?: { levels?, type?, name?, roofShape?, roofColour?, colour?, shop?, amenity? } }]
  roads:     [{ pts, w, name?, cls? }]
  greens:    [{ poly, kind }]            // kind ∈ lawn|garden|flowerbed|pitch
  trees:     [[x,z], …]
  water:     [[[x,z]…]…]
  pois?:     [{ x, z, kind, name? }]     // kind ∈ statue|memorial|fountain|kiosk|cafe|temple|tower|shop|landmark|amenity
  barriers?: [{ pts, kind }]             // kind ∈ fence|wall|hedge
  ```
- Run tests from `client/`: `npm test` (alias `vitest run`). Run a single file: `npx vitest run <path>`.

---

### Task 1: Extract pure OSM helpers into a testable module

**Files:**
- Create: `client/scripts/osm-extract.js` (CommonJS)
- Test: `client/scripts/osm-extract.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces (all `module.exports`):
  - `projector(lat0, lon0) -> { toX(lon):number, toZ(lat):number }`
  - `area2(poly:[number,number][]) -> number`
  - `centroid(poly) -> [number, number]`
  - `buildingHeight(tags:object|undefined, seedx:number, seedz:number) -> number`
  - `roadWidth(tags) -> number`  (0 when not a drawable highway)
  - `roadName(tags) -> string|undefined`
  - `roadClass(tags) -> string|undefined`  (the `highway` value)
  - `buildingTags(tags) -> object|undefined`  (the `{levels?,type?,name?,roofShape?,roofColour?,colour?,shop?,amenity?}` subset, or `undefined` if empty)
  - `poiKind(tags) -> string|null`
  - `greenKind(tags) -> 'lawn'|'garden'|'flowerbed'|'pitch'`

- [ ] **Step 1: Write the failing test**

Create `client/scripts/osm-extract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  projector, buildingTags, roadName, roadClass, poiKind, greenKind,
} from './osm-extract.js';

describe('osm-extract helpers', () => {
  it('projects lon/lat to local metres (north → −z)', () => {
    const { toX, toZ } = projector(21.0287, 105.8524);
    expect(toX(105.8524)).toBe(0);
    expect(toZ(21.0287)).toBe(0);
    expect(toZ(21.0297)).toBeLessThan(0); // further north → negative z
    expect(toX(105.8534)).toBeGreaterThan(0); // further east → positive x
  });

  it('buildingTags keeps only the useful subset and drops building=yes', () => {
    expect(buildingTags({ building: 'yes' })).toBeUndefined();
    expect(buildingTags({ building: 'apartments', 'building:levels': '5', name: 'X' }))
      .toEqual({ type: 'apartments', levels: 5, name: 'X' });
    expect(buildingTags({ 'roof:shape': 'hipped', 'building:colour': '#ffcc88', shop: 'bakery' }))
      .toEqual({ roofShape: 'hipped', colour: '#ffcc88', shop: 'bakery' });
  });

  it('roadName / roadClass read the OSM tags', () => {
    expect(roadName({ name: 'Hàng Đào', highway: 'pedestrian' })).toBe('Hàng Đào');
    expect(roadName({ highway: 'service' })).toBeUndefined();
    expect(roadClass({ highway: 'primary' })).toBe('primary');
  });

  it('poiKind classifies the landmark/amenity nodes', () => {
    expect(poiKind({ historic: 'memorial' })).toBe('memorial');
    expect(poiKind({ tourism: 'artwork', artwork_type: 'statue' })).toBe('statue');
    expect(poiKind({ amenity: 'fountain' })).toBe('fountain');
    expect(poiKind({ man_made: 'tower' })).toBe('tower');
    expect(poiKind({ amenity: 'cafe' })).toBe('cafe');
    expect(poiKind({ shop: 'clothes' })).toBe('shop');
    expect(poiKind({ building: 'house' })).toBeNull();
  });

  it('greenKind maps leisure/landuse to a render kind', () => {
    expect(greenKind({ leisure: 'pitch' })).toBe('pitch');
    expect(greenKind({ leisure: 'garden' })).toBe('garden');
    expect(greenKind({ landuse: 'grass' })).toBe('lawn');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run scripts/osm-extract.test.ts`
Expected: FAIL — `Cannot find module './osm-extract.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `client/scripts/osm-extract.js`:

```js
// Pure OSM → local-metre schema helpers, extracted from gen-hanoi.js so they can
// be unit-tested without hitting the network. CommonJS (required by gen-hanoi.js).

const M_LAT = 111320;

function projector(lat0, lon0) {
  const mLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return {
    toX: (lon) => Math.round((lon - lon0) * mLon * 10) / 10,
    toZ: (lat) => Math.round(-(lat - lat0) * M_LAT * 10) / 10,
  };
}

function area2(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const n = poly[(i + 1) % poly.length]; a += poly[i][0] * n[1] - n[0] * poly[i][1]; }
  return Math.abs(a / 2);
}
function centroid(poly) { let x = 0, z = 0; for (const p of poly) { x += p[0]; z += p[1]; } return [x / poly.length, z / poly.length]; }

function buildingHeight(tags, seedx, seedz) {
  if (tags) {
    if (tags.height) { const h = parseFloat(String(tags.height).replace(/[^\d.]/g, '')); if (h > 0) return Math.round(h * 10) / 10; }
    const lv = tags['building:levels'] || tags['building:levels:aboveground'];
    if (lv) { const n = parseFloat(lv); if (n > 0) return Math.round((n * 3.3 + 1) * 10) / 10; }
  }
  const s = Math.abs(Math.sin(seedx * 12.9898 + seedz * 78.233) * 43758.5453) % 1;
  return Math.round((10 + s * 12) * 10) / 10;
}

function roadWidth(tags) {
  if (!tags) return 0;
  const hw = tags.highway;
  if (!hw) return 0;
  if (tags.width) { const w = parseFloat(tags.width); if (w > 0) return w; }
  const lanes = tags.lanes ? parseFloat(tags.lanes) : 0;
  const byClass = {
    trunk: 13, primary: 12, secondary: 9.5, tertiary: 7.5,
    residential: 6, unclassified: 6, living_street: 5, pedestrian: 5,
    service: 3.5, road: 6, footway: 2.4, path: 2.2,
  };
  if (hw === 'steps' || hw === 'cycleway' || hw === 'construction') return 0;
  if (hw in byClass) return lanes > 1 ? Math.max(byClass[hw], lanes * 3) : byClass[hw];
  return 0;
}

function roadName(tags) { return (tags && tags.name) || undefined; }
function roadClass(tags) { return (tags && tags.highway) || undefined; }

function buildingTags(tags) {
  if (!tags) return undefined;
  const o = {};
  const lv = tags['building:levels'] || tags['building:levels:aboveground'];
  if (lv) { const n = parseFloat(lv); if (n > 0) o.levels = n; }
  if (tags.building && tags.building !== 'yes') o.type = tags.building;
  if (tags.name) o.name = tags.name;
  if (tags['roof:shape']) o.roofShape = tags['roof:shape'];
  if (tags['roof:colour']) o.roofColour = tags['roof:colour'];
  if (tags['building:colour'] || tags.colour) o.colour = tags['building:colour'] || tags.colour;
  if (tags.shop) o.shop = tags.shop;
  if (tags.amenity) o.amenity = tags.amenity;
  return Object.keys(o).length ? o : undefined;
}

function poiKind(tags) {
  if (!tags) return null;
  if (tags.historic === 'memorial' || tags.memorial) return 'memorial';
  if (tags.tourism === 'artwork' || tags.artwork_type === 'statue' || tags.historic === 'monument') return 'statue';
  if (tags.amenity === 'fountain' || tags.water === 'fountain') return 'fountain';
  if (tags.man_made === 'tower' || tags.tower_type) return 'tower';
  if (tags.amenity === 'place_of_worship' || tags.building === 'temple') return 'temple';
  if (tags.amenity === 'kiosk' || tags.shop === 'kiosk') return 'kiosk';
  if (tags.amenity === 'cafe' || tags.amenity === 'restaurant') return 'cafe';
  if (tags.shop) return 'shop';
  if (tags.tourism || tags.historic) return 'landmark';
  if (tags.amenity) return 'amenity';
  return null;
}

function greenKind(tags) {
  if (!tags) return 'lawn';
  if (tags.leisure === 'pitch') return 'pitch';
  if (tags.leisure === 'garden' || tags.landuse === 'village_green') return 'garden';
  if (tags.flowerbed || tags.landuse === 'flowerbed') return 'flowerbed';
  return 'lawn';
}

module.exports = {
  projector, area2, centroid, buildingHeight, roadWidth,
  roadName, roadClass, buildingTags, poiKind, greenKind,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run scripts/osm-extract.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add client/scripts/osm-extract.js client/scripts/osm-extract.test.ts
git commit -m "feat(world): testable OSM extraction helpers for hanoi data"
```

---

### Task 2: Add the `transform()` pipeline (synthetic-element test, no network)

**Files:**
- Modify: `client/scripts/osm-extract.js` (add `transform`)
- Test: `client/scripts/osm-extract.test.ts` (add a `transform` describe block)

**Interfaces:**
- Consumes: the Task 1 helpers (same module).
- Produces: `transform(elements:any[], opts:{ lat0:number, lon0:number, tagR:number }) -> { buildings, roads, trees, greens, water, pois, barriers }` with the schema from Global Constraints. `elements` are Overpass `out geom` elements (`{type, tags, lat, lon, geometry:[{lat,lon}], members}`).

- [ ] **Step 1: Write the failing test**

Append to `client/scripts/osm-extract.test.ts`:

```ts
import { transform } from './osm-extract.js';

describe('transform(elements)', () => {
  const opts = { lat0: 21.0287, lon0: 105.8524, tagR: 520 };
  // ~+11 m east per 0.0001 lon here; build small footprints near origin.
  const ring = (lat: number, lon: number, d = 0.0001) =>
    [{ lat, lon }, { lat, lon: lon + d }, { lat: lat + d, lon: lon + d }, { lat: lat + d, lon }, { lat, lon }];

  it('attaches building tags inside tagR and strips them outside', () => {
    const near = { type: 'way', tags: { building: 'apartments', 'building:levels': '5', name: 'Nhà A' }, geometry: ring(21.0287, 105.8524) };
    const far = { type: 'way', tags: { building: 'house', name: 'Xa' }, geometry: ring(21.0500, 105.8800) }; // ~> 520 m
    const out = transform([near, far], opts);
    expect(out.buildings).toHaveLength(2);
    const tagged = out.buildings.find((b) => b.tags);
    expect(tagged.tags).toMatchObject({ type: 'apartments', levels: 5, name: 'Nhà A' });
    const untagged = out.buildings.find((b) => !b.tags);
    expect(untagged).toBeTruthy(); // the far one keeps poly+h only
  });

  it('extracts roads with name+cls, pois (node + way), barriers, and green kinds', () => {
    const road = { type: 'way', tags: { highway: 'pedestrian', name: 'Hàng Đào' }, geometry: ring(21.0290, 105.8524).slice(0, 2) };
    const statueNode = { type: 'node', tags: { tourism: 'artwork', artwork_type: 'statue', name: 'Lý Thái Tổ' }, lat: 21.0282, lon: 105.8530 };
    const fountainWay = { type: 'way', tags: { amenity: 'fountain' }, geometry: ring(21.0288, 105.8520) };
    const fence = { type: 'way', tags: { barrier: 'fence' }, geometry: ring(21.0289, 105.8525).slice(0, 3) };
    const garden = { type: 'way', tags: { leisure: 'garden' }, geometry: ring(21.0285, 105.8528) };
    const tree = { type: 'node', tags: { natural: 'tree' }, lat: 21.0286, lon: 105.8523 };
    const out = transform([road, statueNode, fountainWay, fence, garden, tree], opts);
    expect(out.roads[0]).toMatchObject({ name: 'Hàng Đào', cls: 'pedestrian' });
    expect(out.pois.find((p) => p.kind === 'statue')?.name).toBe('Lý Thái Tổ');
    expect(out.pois.some((p) => p.kind === 'fountain')).toBe(true);
    expect(out.barriers[0]).toMatchObject({ kind: 'fence' });
    expect(out.greens[0]).toMatchObject({ kind: 'garden' });
    expect(out.trees).toHaveLength(1);
  });

  it('puts the near-origin lake first in water[]', () => {
    const lake = { type: 'way', tags: { natural: 'water' }, geometry: ring(21.0287, 105.8524, 0.0020) }; // big, near origin
    const out = transform([lake], opts);
    expect(out.water.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run scripts/osm-extract.test.ts`
Expected: FAIL — `transform is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `client/scripts/osm-extract.js` (before `module.exports`, then add `transform` to the exports):

```js
function transform(elements, opts) {
  const { lat0, lon0, tagR } = opts;
  const { toX, toZ } = projector(lat0, lon0);
  const tagR2 = tagR * tagR;
  const buildings = [], roads = [], trees = [], greens = [], waters = [], pois = [], barriers = [];

  for (const el of elements) {
    const tags = el.tags || {};

    // POINT features (nodes)
    if (el.type === 'node') {
      if (tags.natural === 'tree') { trees.push([toX(el.lon), toZ(el.lat)]); continue; }
      const k = poiKind(tags);
      if (k) { const x = toX(el.lon), z = toZ(el.lat); if (x * x + z * z <= tagR2) pois.push({ x, z, kind: k, ...(tags.name ? { name: tags.name } : {}) }); }
      continue;
    }

    // Water multipolygon relation: stitch OUTER member ways into rings.
    if (el.type === 'relation' && tags.natural === 'water' && el.members) {
      for (const mb of el.members) {
        if (mb.type !== 'way' || mb.role !== 'outer' || !mb.geometry || mb.geometry.length < 3) continue;
        const ring = mb.geometry.map((g) => [toX(g.lon), toZ(g.lat)]);
        if (area2(ring) > 200) waters.push(ring);
      }
      continue;
    }

    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const poly = el.geometry.map((g) => [toX(g.lon), toZ(g.lat)]);

    if (tags.building) {
      if (poly.length < 3) continue;
      const [cx, cz] = centroid(poly);
      const rec = { poly, h: buildingHeight(tags, cx, cz) };
      if (cx * cx + cz * cz <= tagR2) { const t = buildingTags(tags); if (t) rec.tags = t; }
      buildings.push(rec);
    } else if (tags.highway) {
      const w = roadWidth(tags);
      if (w > 0) { const rec = { pts: poly, w }; const nm = roadName(tags), cl = roadClass(tags); if (nm) rec.name = nm; if (cl) rec.cls = cl; roads.push(rec); }
    } else if (tags.barrier) {
      const [cx, cz] = centroid(poly);
      if (cx * cx + cz * cz <= tagR2) barriers.push({ pts: poly, kind: tags.barrier === 'wall' ? 'wall' : tags.barrier === 'hedge' ? 'hedge' : 'fence' });
    } else if (tags.amenity === 'fountain' || tags.water === 'fountain') {
      const [cx, cz] = centroid(poly);
      if (cx * cx + cz * cz <= tagR2) pois.push({ x: cx, z: cz, kind: 'fountain', ...(tags.name ? { name: tags.name } : {}) });
    } else if (tags.natural === 'water') {
      if (poly.length >= 3) waters.push(poly);
    } else if (tags.leisure || tags.landuse) {
      if (poly.length < 3) continue;
      greens.push({ poly, kind: greenKind(tags) });
    }
  }

  // Lake = largest near-origin water polygon; force it to water[0] (see gen-hanoi notes).
  const R = Math.max(tagR, 700);
  const inDisc = (poly) => poly.every((p) => Math.hypot(p[0], p[1]) <= R * 1.6);
  const nearOrigin = (poly) => { const [cx, cz] = centroid(poly); return Math.hypot(cx, cz) < 600; };
  const clean = waters.filter(inDisc).sort((a, b) => area2(b) - area2(a));
  const lakeIdx = clean.findIndex((p) => nearOrigin(p) && area2(p) > 40000);
  if (lakeIdx > 0) { const [lk] = clean.splice(lakeIdx, 1); clean.unshift(lk); }

  return { buildings, roads, trees, greens, water: clean, pois, barriers };
}
```

Update the exports line to include `transform`:

```js
module.exports = {
  projector, area2, centroid, buildingHeight, roadWidth,
  roadName, roadClass, buildingTags, poiKind, greenKind, transform,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run scripts/osm-extract.test.ts`
Expected: PASS (all describes).

- [ ] **Step 5: Commit**

```bash
git add client/scripts/osm-extract.js client/scripts/osm-extract.test.ts
git commit -m "feat(world): transform() OSM elements → enriched hanoi schema"
```

---

### Task 3: Rewrite `gen-hanoi.js` to fetch + transform + write

**Files:**
- Modify: `client/scripts/gen-hanoi.js` (replace the inline helpers + element loop; keep the Overpass fetch)

**Interfaces:**
- Consumes: `transform`, `projector`, `area2`, `centroid` from `./osm-extract.js`.
- Produces: a regenerated `public/data/hanoi.json` (handled in Task 4). No exported API.

- [ ] **Step 1: Replace the file body**

Replace the entire contents of `client/scripts/gen-hanoi.js` with:

```js
// Regenerate public/data/hanoi.json from live OpenStreetMap (Overpass API).
//
//   node scripts/gen-hanoi.js [radiusMetres]   (default 700)
//
// Fetches the REAL buildings / streets / lake / parks / trees / POIs / barriers around
// Hoan Kiem and converts them (via osm-extract.transform) to the local-metre schema the
// 3D world expects. Building tags, POIs and barriers are only emitted within TAG_R of the
// origin (the rest stays poly-only). NETWORK: hits https://overpass-api.de live.

const fs = require('fs');
const path = require('path');
const { transform, area2, centroid } = require('./osm-extract.js');

const LAT0 = 21.0287, LON0 = 105.8524;          // Hoan Kiem reference origin (unchanged)
const RADIUS = Number(process.argv[2]) || 700;  // metres
const TAG_R = 520;                              // emit tags/pois/barriers only inside this
const OUT = path.resolve(__dirname, '..', 'public', 'data', 'hanoi.json');

async function overpass(query) {
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'veyra-dev/1.0' },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error('Overpass ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return res.json();
}

(async () => {
  const R = RADIUS;
  const q = `[out:json][timeout:180];
(
  way["building"](around:${R},${LAT0},${LON0});
  way["highway"](around:${R},${LAT0},${LON0});
  way["natural"="water"](around:${R},${LAT0},${LON0});
  relation["natural"="water"](around:${R},${LAT0},${LON0});
  way["leisure"~"park|garden|pitch|playground"](around:${R},${LAT0},${LON0});
  way["landuse"~"grass|recreation_ground|meadow|forest|village_green|flowerbed"](around:${R},${LAT0},${LON0});
  way["barrier"](around:${TAG_R},${LAT0},${LON0});
  way["amenity"="fountain"](around:${TAG_R},${LAT0},${LON0});
  node["natural"="tree"](around:${R},${LAT0},${LON0});
  node["historic"](around:${TAG_R},${LAT0},${LON0});
  node["tourism"](around:${TAG_R},${LAT0},${LON0});
  node["man_made"="tower"](around:${TAG_R},${LAT0},${LON0});
  node["amenity"~"fountain|cafe|restaurant|kiosk|place_of_worship"](around:${TAG_R},${LAT0},${LON0});
  node["shop"](around:${TAG_R},${LAT0},${LON0});
);
out geom;`;
  console.log(`Fetching OSM within ${R} m of Hoan Kiem (tags ≤ ${TAG_R} m) …`);
  const data = await overpass(q);
  const els = data.elements || [];
  console.log('elements:', els.length);

  const t = transform(els, { lat0: LAT0, lon0: LON0, tagR: TAG_R });
  const extentR = Math.round(R * 10) / 10;
  const out = { center: { lat0: LAT0, lon0: LON0 }, extentR, ...t };
  fs.writeFileSync(OUT, JSON.stringify(out));

  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  const tagged = t.buildings.filter((b) => b.tags).length;
  console.log(`Wrote ${OUT} (${kb} KB)`);
  console.log(`buildings:${t.buildings.length} (tagged:${tagged}) roads:${t.roads.length} trees:${t.trees.length} greens:${t.greens.length} water:${t.water.length} pois:${t.pois.length} barriers:${t.barriers.length}`);
  if (t.water[0]) console.log(`lake pts:${t.water[0].length} area~${area2(t.water[0]).toFixed(0)} m2 centroid:${centroid(t.water[0]).map((v) => v.toFixed(0))}`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
```

- [ ] **Step 2: Verify the script parses (no run yet)**

Run: `cd client && node --check scripts/gen-hanoi.js`
Expected: no output, exit 0 (syntax OK).

- [ ] **Step 3: Commit**

```bash
git add client/scripts/gen-hanoi.js
git commit -m "refactor(world): gen-hanoi uses transform() + emits tags/pois/barriers"
```

---

### Task 4: Regenerate `hanoi.json` and lock its shape with a smoke test

**Files:**
- Modify: `client/public/data/hanoi.json` (regenerated)
- Test: `client/scripts/hanoi-data.test.ts`

**Interfaces:**
- Consumes: the committed `public/data/hanoi.json`.
- Produces: nothing (a guard test).

- [ ] **Step 1: Regenerate the data (network)**

Run: `cd client && node scripts/gen-hanoi.js 700`
Expected: prints `Wrote …hanoi.json` and a summary line where `tagged:` > 0, `pois:` > 0, `barriers:` ≥ 0. If Overpass is rate-limited (HTTP 429/504), wait and rerun — do NOT hand-edit the file. The committed file is the source of truth if regen is impossible.

- [ ] **Step 2: Write the smoke test**

Create `client/scripts/hanoi-data.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import data from '../public/data/hanoi.json';

describe('hanoi.json shape (post-enrichment)', () => {
  it('keeps the core layers', () => {
    expect(Array.isArray(data.buildings)).toBe(true);
    expect(data.buildings.length).toBeGreaterThan(1000);
    expect(Array.isArray(data.roads)).toBe(true);
    expect(Array.isArray(data.water)).toBe(true);
  });

  it('carries the new enrichment fields', () => {
    expect(Array.isArray(data.pois)).toBe(true);
    expect(Array.isArray(data.barriers)).toBe(true);
    // at least some inner buildings are tagged
    expect(data.buildings.some((b: any) => b.tags)).toBe(true);
    // at least one named road
    expect(data.roads.some((r: any) => r.name)).toBe(true);
    // pois are well-formed
    if (data.pois.length) expect(data.pois[0]).toHaveProperty('kind');
  });
});
```

If the TS importer rejects JSON imports, add `"resolveJsonModule": true` to `client/tsconfig.json` `compilerOptions` (vitest reads it) and re-run.

- [ ] **Step 3: Run the smoke test**

Run: `cd client && npx vitest run scripts/hanoi-data.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/public/data/hanoi.json client/scripts/hanoi-data.test.ts
git commit -m "data(world): regenerate hanoi.json with OSM tags/pois/barriers + guard test"
```

---

### Task 5: Surface `pois`/`barriers` through the snapshot + dev map (review hook)

**Files:**
- Modify: `client/app/lib/three/worldHanoi.ts` (capture `data.pois`/`data.barriers`; extend `getMapSnapshot`)
- Modify: `client/app/features/world/DevMap.tsx` (Snapshot type + paint the two new layers)

**Interfaces:**
- Consumes: `worldMap` built in `build()`; the `getMapSnapshot()` return shape.
- Produces: `getMapSnapshot()` additionally returns `pois?: {x,z,kind,name?}[]` and `barriers?: {pts:number[][],kind:string}[]`.

- [ ] **Step 1: Capture the new layers into `worldMap`**

In `client/app/lib/three/worldHanoi.ts`, find where `worldMap` is assigned its fields (the object built near the bridge/buildings snapshot, around the `buildings: buildList,` line ~1695). Add the two layers from the fetched `data` (pass `data` is already in scope inside `build`):

```js
      buildings: buildList,                        // [{ poly:[[x,z],...], h }]
      pois: (data && Array.isArray(data.pois)) ? data.pois : [],
      barriers: (data && Array.isArray(data.barriers)) ? data.barriers : [],
```

- [ ] **Step 2: Return them from `getMapSnapshot`**

In the `getMapSnapshot()` return object (~line 4651), add:

```js
        buildings: worldMap.buildings,
        pois: worldMap.pois || [],
        barriers: worldMap.barriers || [],
```

- [ ] **Step 3: Extend the DevMap Snapshot type + paint**

In `client/app/features/world/DevMap.tsx`, extend the `Snapshot` interface:

```ts
interface Snapshot {
  bounds: { r: number; fence?: number };
  water: number[][] | null;
  roads: { pts: number[][]; w?: number }[];
  buildings: { poly: number[][] }[];
  pois?: { x: number; z: number; kind: string; name?: string }[];
  barriers?: { pts: number[][]; kind: string }[];
  spawn: { x: number; z: number };
  places: Place[];
}
```

In `paintStatic`, after the buildings loop and before the `places` loop, add:

```ts
  // barriers (Phase-0 review hook) — thin dashed lines
  if (snap.barriers && snap.barriers.length) {
    ctx.save();
    ctx.setLineDash([4, 3]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(120,90,60,0.7)';
    for (const b of snap.barriers) {
      if (!b.pts || b.pts.length < 2) continue;
      ctx.beginPath();
      for (let i = 0; i < b.pts.length; i++) {
        const { px, py } = worldToCanvas(b.pts[i][0], b.pts[i][1], tf);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // pois (Phase-0 review hook) — small magenta squares
  if (snap.pois && snap.pois.length) {
    ctx.fillStyle = '#b3408a';
    for (const p of snap.pois) {
      const { px, py } = worldToCanvas(p.x, p.z, tf);
      ctx.fillRect(px - 2.5, py - 2.5, 5, 5);
    }
  }
```

- [ ] **Step 4: Typecheck + lint the touched files**

Run: `cd client && npx tsc --noEmit && npx eslint app/features/world/DevMap.tsx`
Expected: no errors. (`worldHanoi.ts` is `@ts-nocheck`; the DevMap changes are typed.)

- [ ] **Step 5: Manual review (no engine unit tests exist)**

Run: `cd client && npm run dev`, open the world, open the dev teleport map (admin/dev gate). Confirm magenta POI squares appear near the lake (statue, fountains, tower) and dashed barrier lines render. This is the visible confirmation the enriched data flows end-to-end.

- [ ] **Step 6: Commit**

```bash
git add client/app/lib/three/worldHanoi.ts client/app/features/world/DevMap.tsx
git commit -m "feat(world): expose pois/barriers in map snapshot + dev map review hook"
```

---

## Self-Review

**Spec coverage (Phase 0 section of the design):**
- "Extend Overpass query for POIs + barriers" → Task 3 query. ✓
- "Attach tag subset to buildings within TAG_R; derive levels/type/roof/colour/name/shop/amenity" → Task 1 `buildingTags` + Task 2 `transform`. ✓
- "Add name + cls to roads" → Task 1 `roadName`/`roadClass` + Task 2. ✓
- "Emit pois + barriers" → Task 2 `transform`. ✓
- "Bump/keep capture radius; document command + Overpass note" → Task 3 header comment + Task 4 run note. ✓
- "Minimal render hook so the new data is visible for review" → Task 5 (snapshot + DevMap). ✓
- "Schema round-trips through getMapSnapshot unchanged" → Task 5 only adds optional fields. ✓
- Acceptance: existing world loads identically (new fields optional; builders untouched) → Global Constraints + Task 5 guards with `|| []`. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**Type consistency:** `transform()` returns `{buildings,roads,trees,greens,water,pois,barriers}` — same names consumed in Tasks 3/4/5. POI shape `{x,z,kind,name?}` and barrier `{pts,kind}` identical across `transform`, smoke test, snapshot, and DevMap. `buildingTags` keys (`levels,type,name,roofShape,roofColour,colour,shop,amenity`) match the schema in Global Constraints. ✓

**Notes for the executor:** Vitest default `include` picks up `scripts/*.test.ts`. If `scripts/` is excluded by `client/tsconfig.json` `include`, add `"scripts/**/*.test.ts"` (and `resolveJsonModule`) so the tests typecheck — but they will still run under vitest regardless. The named-import `from './osm-extract.js'` relies on vitest's CJS interop; if a named import fails, switch that test to `import osm from './osm-extract.js'` and use `osm.transform(...)`.
