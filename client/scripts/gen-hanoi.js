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
