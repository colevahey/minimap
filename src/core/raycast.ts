import { toLocal } from './geo';
import { EYE_HEIGHT_M, M_PER_FLOOR } from './constants';
import type { BuildingWithRing, LngLat } from './types';

export interface RaycastHit {
  t: number; // distance to façade, metres
  b: BuildingWithRing;
  x: number; // hit point, local metres east
  y: number; // hit point, local metres north
}

/** This building's nearest edge-crossing along the ray (dx,dy from `o`), or null if it doesn't cross. */
function nearestCrossing(
  o: LngLat,
  dx: number,
  dy: number,
  b: BuildingWithRing,
  maxRange: number,
): RaycastHit | null {
  const ring = b.ring;
  let nearest: RaycastHit | null = null;
  for (let i = 0; i < ring.length; i++) {
    const A = toLocal(ring[i][0], ring[i][1], o);
    const j = (i + 1) % ring.length;
    const B = toLocal(ring[j][0], ring[j][1], o);
    const ex = B.x - A.x;
    const ey = B.y - A.y;
    const det = -dx * ey + ex * dy; // parallel if ~0
    if (Math.abs(det) < 1e-9) continue;
    const t = (-A.x * ey + ex * A.y) / det; // metres along ray
    const u = (dx * A.y - dy * A.x) / det; // position along edge [0,1]
    if (t > 0.5 && t < maxRange && u >= 0 && u <= 1) {
      if (!nearest || t < nearest.t) nearest = { t, b, x: t * dx, y: t * dy };
    }
  }
  return nearest;
}

function headingToUnitVector(headingDeg: number): { dx: number; dy: number } {
  const th = (headingDeg * Math.PI) / 180;
  return { dx: Math.sin(th), dy: Math.cos(th) }; // unit dir (east, north)
}

/** Casts a ray from observer `o` along `headingDeg` (clockwise from true north)
 * against building footprint rings and returns the nearest hit, or null. */
export function raycast(
  o: LngLat,
  headingDeg: number,
  buildings: BuildingWithRing[],
  maxRange = 650,
): RaycastHit | null {
  const { dx, dy } = headingToUnitVector(headingDeg);
  let best: RaycastHit | null = null;
  for (const b of buildings) {
    const hit = nearestCrossing(o, dx, dy, b, maxRange);
    if (hit && (!best || hit.t < best.t)) best = hit;
  }
  return best;
}

/** Every building the ray crosses along `headingDeg`, nearest-first. Used by
 * `raycastWithPitch` (§8) to walk candidates front-to-back. */
export function raycastAllHits(
  o: LngLat,
  headingDeg: number,
  buildings: BuildingWithRing[],
  maxRange = 650,
): RaycastHit[] {
  const { dx, dy } = headingToUnitVector(headingDeg);
  const hits: RaycastHit[] = [];
  for (const b of buildings) {
    const hit = nearestCrossing(o, dx, dy, b, maxRange);
    if (hit) hits.push(hit);
  }
  return hits.sort((a, b) => a.t - b.t);
}

/**
 * Height-aware raycast for AR mode (§8): flat first-intersection is wrong
 * when a short building sits in front of a taller one you're looking *over*.
 * Walks crossings front-to-back and picks the first whose vertical span
 * (base→roof angle, from `pitchDeg`'s point of view) contains the observer's
 * actual pitch. A nearer short building only occludes a farther tall one
 * below the near building's roofline angle.
 *
 * Where height is missing (no `height_m` or `floors`), that candidate is
 * treated as the flat first-intersection (§8) — it's picked outright rather
 * than angle-tested, matching plain `raycast`'s behavior for the same case.
 */
export function raycastWithPitch(
  o: LngLat,
  headingDeg: number,
  pitchDeg: number,
  buildings: BuildingWithRing[],
  maxRange = 650,
): RaycastHit | null {
  const hits = raycastAllHits(o, headingDeg, buildings, maxRange);
  for (const hit of hits) {
    const heightM = hit.b.height_m ?? (hit.b.floors != null ? hit.b.floors * M_PER_FLOOR : null);
    if (heightM == null) return hit;
    const roofDeg = (Math.atan2(heightM - EYE_HEIGHT_M, hit.t) * 180) / Math.PI;
    const baseDeg = (Math.atan2(-EYE_HEIGHT_M, hit.t) * 180) / Math.PI;
    if (pitchDeg >= baseDeg && pitchDeg <= roofDeg) return hit;
  }
  return null;
}
