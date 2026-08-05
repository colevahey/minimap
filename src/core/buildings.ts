import type { Map as MapLibreMap } from 'maplibre-gl';
import type { BuildingWithRing } from './types';

const BUILDINGS_SOURCE_LAYER = 'buildings';

/**
 * Reads nearby building footprints out of the loaded PMTiles vector layer (§4 schema).
 * Wired to a real `sea.pmtiles`/`nyc.pmtiles` source in M2 — for now this just adapts
 * whatever MapLibre has rendered for the `buildings` source-layer into `BuildingWithRing[]`.
 */
export function queryNearbyBuildings(map: MapLibreMap): BuildingWithRing[] {
  const features = map.querySourceFeatures('buildings', { sourceLayer: BUILDINGS_SOURCE_LAYER });
  const out: BuildingWithRing[] = [];

  for (const feature of features) {
    if (feature.geometry.type !== 'Polygon') continue;
    const ring = feature.geometry.coordinates[0] as [number, number][];
    const props = feature.properties as Record<string, unknown>;
    out.push({
      id: String(props.id),
      city: props.city as BuildingWithRing['city'],
      name: props.name as string | undefined,
      height_m: props.height_m as number | undefined,
      floors: props.floors as number | undefined,
      year_built: props.year_built as number | undefined,
      owner: props.owner as string | undefined,
      source: String(props.source),
      attrs: props.attrs as Record<string, string | number> | undefined,
      ring,
    });
  }
  return out;
}
