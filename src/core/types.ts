export type CityCode = 'sea' | 'nyc';

export interface Building {
  id: string; // stable per city (NYC: BIN; Seattle: footprint id / PIN)
  city: CityCode;
  name?: string; // present for named/landmark buildings, often absent
  height_m?: number; // from LiDAR (NYC) or floors×3.5 estimate (Seattle MVP)
  floors?: number;
  year_built?: number;
  owner?: string; // registered owner (often an LLC) — label as such in UI
  source: string; // e.g. "NYC DCP Building Footprints + MapPLUTO"
  attrs?: Record<string, string | number>; // city-specific extras (BBL, PIN, etc.)
  // geometry travels as the PMTiles feature polygon, not on this object
}

export interface LngLat {
  lng: number;
  lat: number;
}

/** A building carrying its footprint ring, as read from a PMTiles feature. */
export interface BuildingWithRing extends Building {
  ring: [number, number][]; // [lng, lat] pairs
}
