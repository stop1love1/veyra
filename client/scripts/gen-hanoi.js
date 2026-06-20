// Regenerate public/data/hanoi.json from live OpenStreetMap (Overpass API).
//
//   node scripts/gen-hanoi.js [radiusMetres]   (default 700)
//
// Fetches the REAL buildings / streets / lake / parks / trees around Hoan Kiem and
// converts them to the local-metre schema the 3D world (worldHanoi.ts) expects:
//   { center:{lat0,lon0}, extentR, buildings:[{poly:[[x,z]],h}], roads:[{pts:[[x,z]],w}],
//     trees:[[x,z]], greens:[{poly:[[x,z]],kind}], water:[[[x,z]]] }
// Coordinate convention: x = east (m), z = south(+)/north(-), origin = (lat0,lon0).
// The previous export was capped at ~2000 buildings; this pulls the full set so the
// Old Quarter is as dense as it really is.

const fs = require('fs');
const path = require('path');

const LAT0 = 21.0287, LON0 = 105.8524;          // Hoan Kiem reference origin (unchanged)
const RADIUS = Number(process.argv[2]) || 700;  // metres
const OUT = path.resolve(__dirname, '..', 'public', 'data', 'hanoi.json');

// Local-metre projection (equirectangular about the origin). north → -z.
const M_LAT = 111320;
const M_LON = 111320 * Math.cos(LAT0 * Math.PI / 180);
const toX = (lon) => Math.round((lon - LON0) * M_LON * 10) / 10;
const toZ = (lat) => Math.round(-(lat - LAT0) * M_LAT * 10) / 10;

// Building height: prefer real tags (height, building:levels); else a varied default
// (~3–5 floors) seeded by position so the skyline isn't uniform.
function buildingHeight(tags, seedx, seedz) {
  if (tags) {
    if (tags.height) { const h = parseFloat(String(tags.height).replace(/[^\d.]/g, '')); if (h > 0) return Math.round(h * 10) / 10; }
    const lv = tags['building:levels'] || tags['building:levels:aboveground'];
    if (lv) { const n = parseFloat(lv); if (n > 0) return Math.round((n * 3.3 + 1) * 10) / 10; }
  }
  const s = Math.abs(Math.sin(seedx * 12.9898 + seedz * 78.233) * 43758.5453) % 1;
  return Math.round((10 + s * 12) * 10) / 10;   // 10–22 m (≈3–6 floors)
}

// Road carriageway width by class.
function roadWidth(tags) {
  if (!tags) return 0;
  const hw = tags.highway;
  if (!hw) return 0;
  if (tags.width) { const w = parseFloat(tags.width); if (w > 0) return w; }
  const lanes = tags.lanes ? parseFloat(tags.lanes) : 0;
  const byClass = {
    trunk: 13, primary: 12, secondary: 9.5, tertiary: 7.5,
    residential: 6, unclassified: 6, living_street: 5, pedestrian: 5,
    service: 3.5, road: 6,
    // Old-Quarter alleys (ngõ ngách) — keep them, narrow, so the warren reads right.
    footway: 2.4, path: 2.2,
  };
  if (hw === 'steps' || hw === 'cycleway' || hw === 'construction') return 0;
  if (hw in byClass) return lanes > 1 ? Math.max(byClass[hw], lanes * 3) : byClass[hw];
  return 0;
}

function area2(poly) { let a = 0; for (let i = 0; i < poly.length; i++) { const n = poly[(i + 1) % poly.length]; a += poly[i][0] * n[1] - n[0] * poly[i][1]; } return Math.abs(a / 2); }
function centroid(poly) { let x = 0, z = 0; for (const p of poly) { x += p[0]; z += p[1]; } return [x / poly.length, z / poly.length]; }

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
  way["landuse"~"grass|recreation_ground|meadow|forest|village_green"](around:${R},${LAT0},${LON0});
  node["natural"="tree"](around:${R},${LAT0},${LON0});
);
out geom;`;
  console.log(`Fetching OSM within ${R} m of Hoan Kiem …`);
  const data = await overpass(q);
  const els = data.elements || [];
  console.log('elements:', els.length);

  const buildings = [], roads = [], trees = [], greens = [], waters = [];
  for (const el of els) {
    const tags = el.tags || {};
    if (el.type === 'node' && tags.natural === 'tree') {
      trees.push([toX(el.lon), toZ(el.lat)]);
      continue;
    }
    // Water multipolygon (Hoan Kiem lake = relation 198437): stitch the OUTER member
    // ways' geometry into rings. `out geom` gives each member way its own geometry.
    if (el.type === 'relation' && tags.natural === 'water' && el.members) {
      for (const mb of el.members) {
        if (mb.type !== 'way' || mb.role !== 'outer' || !mb.geometry || mb.geometry.length < 3) continue;
        const ring = mb.geometry.map((g) => [toX(g.lon), toZ(g.lat)]);
        if (area2(ring) > 200) waters.push(ring);   // skip tiny inner artefacts
      }
      continue;
    }
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const poly = el.geometry.map((g) => [toX(g.lon), toZ(g.lat)]);

    if (tags.building) {
      if (poly.length < 3) continue;
      const [cx, cz] = centroid(poly);
      buildings.push({ poly, h: buildingHeight(tags, cx, cz) });
    } else if (tags.highway) {
      const w = roadWidth(tags);
      if (w > 0) roads.push({ pts: poly, w });
    } else if (tags.natural === 'water') {
      if (poly.length >= 3) waters.push(poly);
    } else if (tags.leisure || tags.landuse) {
      if (poly.length < 3) continue;
      const kind = tags.leisure === 'pitch' ? 'pitch' : 'lawn';
      greens.push({ poly, kind });
    }
  }

  // Lake = the largest water polygon NEAR the origin (Hoan Kiem) — NOT a distant river.
  // A wider capture pulls in the Red River, whose relation geometry sprawls many km and
  // would otherwise hijack water[0] (the world uses water[0] as THE lake and places the
  // whole landmark cluster on it). Drop waters whose geometry leaves the captured disc,
  // then force Hoan Kiem (largest water with a near-origin centroid) to the front.
  const inDisc = (poly) => poly.every((p) => Math.hypot(p[0], p[1]) <= R * 1.1);
  const nearOrigin = (poly) => { const [cx, cz] = centroid(poly); return Math.hypot(cx, cz) < 600; };
  const cleanWaters = waters.filter(inDisc).sort((a, b) => area2(b) - area2(a));
  const lakeIdx = cleanWaters.findIndex((p) => nearOrigin(p) && area2(p) > 40000);
  if (lakeIdx > 0) { const [lk] = cleanWaters.splice(lakeIdx, 1); cleanWaters.unshift(lk); }
  waters.length = 0; waters.push(...cleanWaters);

  const extentR = Math.round(R * 10) / 10;
  const out = { center: { lat0: LAT0, lon0: LON0 }, extentR, buildings, roads, trees, greens, water: waters };
  fs.writeFileSync(OUT, JSON.stringify(out));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`Wrote ${OUT} (${kb} KB)`);
  console.log(`buildings:${buildings.length} roads:${roads.length} trees:${trees.length} greens:${greens.length} water:${waters.length}`);
  if (waters[0]) console.log(`lake pts:${waters[0].length} area~${area2(waters[0]).toFixed(0)} m2 centroid:${centroid(waters[0]).map((v) => v.toFixed(0))}`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
