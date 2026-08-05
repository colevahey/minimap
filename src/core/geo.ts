import type { LngLat } from './types';

const M_PER_DEG_LAT = 110540;
const D2R = Math.PI / 180;

export const mPerDegLng = (lat: number): number => 111320 * Math.cos(lat * D2R);

export interface LocalPoint {
  x: number; // metres east of origin
  y: number; // metres north of origin
}

/** [lng,lat] -> local metres {x east, y north} around origin o */
export function toLocal(lng: number, lat: number, o: LngLat): LocalPoint {
  return { x: (lng - o.lng) * mPerDegLng(o.lat), y: (lat - o.lat) * M_PER_DEG_LAT };
}

/** local metres -> [lat,lng] */
export function toGeo(x: number, y: number, o: LngLat): [number, number] {
  return [o.lat + y / M_PER_DEG_LAT, o.lng + x / mPerDegLng(o.lat)];
}
