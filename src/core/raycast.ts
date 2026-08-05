import { toLocal } from './geo';
import type { BuildingWithRing, LngLat } from './types';

export interface RaycastHit {
  t: number; // distance to façade, metres
  b: BuildingWithRing;
  x: number; // hit point, local metres east
  y: number; // hit point, local metres north
}

/** Casts a ray from observer `o` along `headingDeg` (clockwise from true north)
 * against building footprint rings and returns the nearest hit, or null. */
export function raycast(
  o: LngLat,
  headingDeg: number,
  buildings: BuildingWithRing[],
  maxRange = 650,
): RaycastHit | null {
  const th = (headingDeg * Math.PI) / 180;
  const dx = Math.sin(th);
  const dy = Math.cos(th); // unit dir (east, north)
  let best: RaycastHit | null = null;

  for (const b of buildings) {
    const ring = b.ring;
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
        if (!best || t < best.t) best = { t, b, x: t * dx, y: t * dy };
      }
    }
  }
  return best;
}
