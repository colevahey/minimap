import { describe, expect, it } from 'vitest';
import { toGeo, toLocal } from '../src/core/geo';
import { raycast } from '../src/core/raycast';
import type { BuildingWithRing, LngLat } from '../src/core/types';

const observer: LngLat = { lat: 47.606, lng: -122.333 };

/** A 40m square footprint centred at local metres (cx, cy) around the observer. */
function squareBuilding(id: string, cx: number, cy: number): BuildingWithRing {
  const half = 20;
  const corners: [number, number][] = [
    [cx - half, cy - half],
    [cx + half, cy - half],
    [cx + half, cy + half],
    [cx - half, cy + half],
  ];
  const ring = corners.map(([x, y]) => {
    const [lat, lng] = toGeo(x, y, observer);
    return [lng, lat] as [number, number];
  });
  return { id, city: 'sea', source: 'test-fixture', ring };
}

describe('raycast (§5 test vectors)', () => {
  const north = squareBuilding('north', 0, 120);
  const east = squareBuilding('east', 120, 0);
  const buildings = [north, east];

  it('0° (N) hits the north building at t ≈ 100m', () => {
    const hit = raycast(observer, 0, buildings);
    expect(hit).not.toBeNull();
    expect(hit!.b.id).toBe('north');
    expect(hit!.t).toBeCloseTo(100, 0);
  });

  it('90° (E) hits the east building at t ≈ 100m', () => {
    const hit = raycast(observer, 90, buildings);
    expect(hit).not.toBeNull();
    expect(hit!.b.id).toBe('east');
    expect(hit!.t).toBeCloseTo(100, 0);
  });

  it('180° (S) hits nothing', () => {
    expect(raycast(observer, 180, buildings)).toBeNull();
  });

  it('45° hits nothing (both buildings off-axis)', () => {
    expect(raycast(observer, 45, buildings)).toBeNull();
  });
});

describe('toLocal/toGeo round-trip', () => {
  it('recovers the original lng/lat within floating-point tolerance', () => {
    const point: LngLat = { lng: -122.335, lat: 47.61 };
    const local = toLocal(point.lng, point.lat, observer);
    const [lat, lng] = toGeo(local.x, local.y, observer);
    expect(lat).toBeCloseTo(point.lat, 9);
    expect(lng).toBeCloseTo(point.lng, 9);
  });
});
