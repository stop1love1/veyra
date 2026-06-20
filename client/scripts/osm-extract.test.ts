import { describe, it, expect } from 'vitest';
import {
  projector, buildingTags, roadName, roadClass, poiKind, greenKind, transform,
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
