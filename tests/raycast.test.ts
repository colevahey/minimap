import { describe, expect, it } from 'vitest';
import { toGeo, toLocal } from '../src/core/geo';
import { raycast, raycastWithPitch } from '../src/core/raycast';
import type { BuildingWithRing, LngLat } from '../src/core/types';

const observer: LngLat = { lat: 47.606, lng: -122.333 };

/** A square footprint centred at local metres (cx, cy) around the observer. */
function squareBuilding(
  id: string,
  cx: number,
  cy: number,
  opts: { half?: number; height_m?: number; floors?: number } = {},
): BuildingWithRing {
  const half = opts.half ?? 20;
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
  return {
    id,
    city: 'sea',
    source: 'test-fixture',
    ring,
    height_m: opts.height_m,
    floors: opts.floors,
  };
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

describe('raycastWithPitch (§8 height-occlusion)', () => {
  // A short building 40m north (roofline ≈ atan2(18.4, 40) ≈ 24.7°) directly
  // in front of a much taller one 300m north (roofline ≈ atan2(198.4, 290) ≈
  // 34.4°) — looking up over the short building's roof should reveal the tall
  // one behind it, exactly the M4 DoD scenario ("aiming up at a tall tower
  // behind a low building selects the tower").
  const short = squareBuilding('short', 0, 50, { half: 10, height_m: 20 });
  const tall = squareBuilding('tall', 0, 300, { half: 10, height_m: 200 });
  const buildings = [short, tall];

  it('level pitch selects the near short building', () => {
    const hit = raycastWithPitch(observer, 0, 0, buildings);
    expect(hit?.b.id).toBe('short');
  });

  it('pitching up past the short building\'s roofline selects the tall building behind it', () => {
    const hit = raycastWithPitch(observer, 0, 30, buildings);
    expect(hit?.b.id).toBe('tall');
  });

  it('pitching up past both rooflines hits nothing', () => {
    expect(raycastWithPitch(observer, 0, 80, buildings)).toBeNull();
  });

  it('falls back to flat first-intersection when height data is missing', () => {
    const noHeight = squareBuilding('no-height', 0, 50, { half: 10 });
    const hit = raycastWithPitch(observer, 0, 45, [noHeight]);
    expect(hit?.b.id).toBe('no-height');
  });

  it('uses floors × 3.5m when height_m is absent but floors is present', () => {
    // 6 floors × 3.5 = 21m, close to the 20m explicit-height case above.
    const byFloors = squareBuilding('by-floors', 0, 50, { half: 10, floors: 6 });
    const hitLevel = raycastWithPitch(observer, 0, 0, [byFloors]);
    expect(hitLevel?.b.id).toBe('by-floors');
    const hitTooHigh = raycastWithPitch(observer, 0, 60, [byFloors]);
    expect(hitTooHigh).toBeNull();
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
