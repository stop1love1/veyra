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
