// Pure OSM → local-metre schema helpers, extracted from gen-hanoi.js so they can
// be unit-tested without hitting the network. CommonJS (required by gen-hanoi.js).

const M_LAT = 111320;

function projector(lat0, lon0) {
  const mLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return {
    toX: (lon) => Math.round((lon - lon0) * mLon * 10) / 10,
    toZ: (lat) => {
      const z = Math.round(-(lat - lat0) * M_LAT * 10) / 10;
      return z === 0 ? 0 : z;
    },
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
