import maplibregl from 'maplibre-gl';
import type { ExpressionSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import { toGeo } from '../core/geo';
import { PoseManager, type Pose } from '../core/pose';
import { raycast, type RaycastHit } from '../core/raycast';
import { queryNearbyBuildings } from '../core/buildings';
import type { CityCode, LngLat } from '../core/types';

interface CityConfig {
  center: [number, number];
  pmtilesPath: string;
}

// §10 M3: switching cities is map-mode/config-only — core/geo, core/raycast,
// core/buildings, core/pose stay untouched, they never knew "Seattle" or "NYC"
// in the first place.
// Paths are relative (no leading slash) so they resolve under Vite's `base`
// (e.g. "/minimap/" on GitHub Pages) instead of escaping back to the origin root.
const CITY_CONFIG: Record<CityCode, CityConfig> = {
  sea: { center: [-122.3321, 47.6062], pmtilesPath: 'tiles/sea.pmtiles' }, // downtown Seattle
  nyc: { center: [-73.9857, 40.7484], pmtilesPath: 'tiles/nyc.pmtiles' }, // Empire State Building, Manhattan
};

// No API keys anywhere (§1): OpenFreeMap serves this style + its basemap tiles for free.
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

const RAY_MAX_RANGE_M = 650;
const BUILDINGS_SOURCE = 'buildings';
const BUILDINGS_SOURCE_LAYER = 'buildings';

// Distinct from every year-bucket hue below (none of which are red) so the
// highlighted building always stands out regardless of which bucket it's in.
const HIGHLIGHT_COLOR = '#ff3b3b';
const DEFAULT_BUILDING_COLOR = '#5db8ff';

// Year-built choropleth (map mode only — a top-down color-by-magnitude read
// doesn't translate to a camera overlay). Year is a magnitude, so a single-hue
// sequential ramp is the "by the book" dataviz-skill encoding for it — but
// distinguishing 8 similar-looking blues by eye on a map is genuinely harder
// than distinguishing 8 different hues, so this uses the skill's validated
// *categorical* palette instead (all 8 slots), in fixed order (never
// cycled/reordered) so adjacent buckets clear the CVD/contrast gates the
// skill's validator checks:
// `node scripts/validate_palette.js "#2a78d6,#eb6834,#1baf7a,#eda100,#e87ba4,#008300,#4a3aa7,#e34948" --mode light`
// (WARNs on 3-of-8 contrast-vs-surface, mitigated by the always-visible text
// labels in the legend below). The skill notes a choropleth is an "all-pairs"
// context — non-adjacent buckets can still end up next to each other
// spatially, and only the first 3 slots are validated for every possible
// pairing, not just neighbors in the legend order — worth knowing if two
// non-adjacent bucket colors ever read as too similar in practice; the
// mitigation already in place is the always-visible legend labels.
// Buckets sized to the real year_built distribution (skews toward
// 1900–1959 in both Seattle and NYC) rather than even calendar spacing, so
// each bucket actually carries a meaningful share of buildings. Buildings
// with no year_built get a neutral gray, kept visually distinct from all 8
// so "no data" never reads as a 9th bucket.
export const YEAR_COLOR_BUCKETS: { label: string; color: string; minYear: number }[] = [
  { label: '< 1900', color: '#2a78d6', minYear: -Infinity }, // blue
  { label: '1900–19', color: '#eb6834', minYear: 1900 }, // orange
  { label: '1920–39', color: '#1baf7a', minYear: 1920 }, // aqua
  { label: '1940–59', color: '#eda100', minYear: 1940 }, // yellow
  { label: '1960–79', color: '#e87ba4', minYear: 1960 }, // magenta
  { label: '1980–99', color: '#008300', minYear: 1980 }, // green
  { label: '2000–14', color: '#4a3aa7', minYear: 2000 }, // violet
  { label: '2015+', color: '#e34948', minYear: 2015 }, // red
];
export const YEAR_COLOR_NO_DATA = '#8a8f98';

function buildingsFillColorExpression(colorByYear: boolean): ExpressionSpecification {
  const baseColor: ExpressionSpecification | string = colorByYear
    ? [
        'case',
        ['!', ['has', 'year_built']],
        YEAR_COLOR_NO_DATA,
        [
          'step',
          ['get', 'year_built'],
          YEAR_COLOR_BUCKETS[0].color,
          ...YEAR_COLOR_BUCKETS.slice(1).flatMap((bucket) => [bucket.minYear, bucket.color]),
        ],
      ]
    : DEFAULT_BUILDING_COLOR;
  return ['case', ['boolean', ['feature-state', 'highlight'], false], HIGHLIGHT_COLOR, baseColor];
}

let protocolRegistered = false;

function ensurePmtilesProtocol(): void {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  protocolRegistered = true;
}

function pmtilesUrl(relativePath: string): string {
  // import.meta.env.BASE_URL is Vite's configured `base` ("/" locally, "/minimap/"
  // on GitHub Pages) — resolving through it keeps this correct under either.
  const base = new URL(import.meta.env.BASE_URL, window.location.href);
  return `pmtiles://${new URL(relativePath, base).href}`;
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function pointFeature(p: LngLat): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }],
  };
}

function lineFeature(a: LngLat, b: LngLat): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [a.lng, a.lat],
            [b.lng, b.lat],
          ],
        },
      },
    ],
  };
}

/** Point at `distanceM` along `headingDeg` from `observer` (used when the ray hits nothing). */
function rayCastPoint(observer: LngLat, headingDeg: number, distanceM: number): LngLat {
  const th = (headingDeg * Math.PI) / 180;
  const [lat, lng] = toGeo(Math.sin(th) * distanceM, Math.cos(th) * distanceM, observer);
  return { lng, lat };
}

export interface MapModeState {
  pose: Pose;
  hit: RaycastHit | null;
  city: CityCode;
  colorByYear: boolean;
}

export type MapModeListener = (state: MapModeState) => void;

/**
 * Owns the MapLibre instance, the pose pipeline, and the ray/highlight/identify
 * loop for map mode (§7). Both `map` and `pose` are also read directly by
 * ArModeController (src/ar/arMode.ts, constructed with a reference to this
 * controller) — position/heading/city stay unified across a mode switch.
 * React (src/ui/App.tsx) only ever reads state via `onUpdate` and issues pose
 * commands through `controller.pose`/`switchCity` — it never touches MapLibre
 * or the pose internals directly.
 */
export class MapModeController {
  readonly map: maplibregl.Map;
  readonly pose = new PoseManager();

  private readonly listeners = new Set<MapModeListener>();
  private currentHit: RaycastHit | null = null;
  private layersReady = false;
  private city: CityCode = 'sea';
  private colorByYear = false;
  private panToNextPosition = false;

  constructor(container: HTMLElement) {
    ensurePmtilesProtocol();

    this.map = new maplibregl.Map({
      container,
      style: BASEMAP_STYLE,
      center: CITY_CONFIG[this.city].center,
      zoom: 15.5,
      pitch: 0,
      attributionControl: { compact: true },
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    this.map.on('load', () => this.setupLayers());
    this.map.on('click', (e) => this.pose.setManualPosition({ lng: e.lngLat.lng, lat: e.lngLat.lat }));

    this.pose.onChange((pose) => this.onPoseChange(pose));
  }

  private setupLayers(): void {
    // The basemap draws its own OSM-derived buildings as a fill-extrusion
    // (layer "building-3d", always active at z>=14 regardless of pitch). Our
    // buildings-fill used to be a flat `fill` layer painted on top of that in
    // the style's layer order, so at any pitch it visually floated near the
    // rooftops instead of hugging the ground — not a geometry problem, a
    // rendering one. Fix: extrude our own layer with our own height_m data
    // (properly depth-composited against other 3D layers) and hide the
    // basemap's competing building geometry so there's only one 3D city, not two.
    for (const basemapLayer of ['building', 'building-3d']) {
      if (this.map.getLayer(basemapLayer)) {
        this.map.setLayoutProperty(basemapLayer, 'visibility', 'none');
      }
    }

    this.map.addSource(BUILDINGS_SOURCE, {
      type: 'vector',
      url: pmtilesUrl(CITY_CONFIG[this.city].pmtilesPath),
      promoteId: 'id',
    });
    this.map.addLayer({
      id: 'buildings-fill',
      type: 'fill-extrusion',
      source: BUILDINGS_SOURCE,
      'source-layer': BUILDINGS_SOURCE_LAYER,
      paint: {
        'fill-extrusion-color': buildingsFillColorExpression(this.colorByYear),
        // fill-extrusion-opacity is constant-only in the style spec (unlike
        // -color) — no data/feature-state expressions — so highlight has to
        // be color-only here; color contrast alone reads fine at this opacity.
        'fill-extrusion-opacity': 0.75,
        // Most footprints get a real height_m from floors × 3.5m (§3); the rest
        // (no Assessor match) fall back to a flat ~1-story placeholder. Fades
        // to 0 (flat/2D) below z12 and ramps up to full height by z15 — tiles
        // now cover z10-17 (see build_tiles.sh) instead of just z14-17, so
        // buildings stay visible zoomed out instead of vanishing entirely,
        // but a wall of full-height 3D extrusions across a whole city at low
        // zoom is both slow and visually chaotic, hence the fade to flat.
        // AR mode is untouched by this — it does its own canvas projection
        // in arMode.ts using height_m/floors directly, not this paint property.
        'fill-extrusion-height': [
          'interpolate',
          ['linear'],
          ['zoom'],
          12,
          0,
          15,
          ['coalesce', ['get', 'height_m'], 3.5],
        ],
        'fill-extrusion-base': 0,
      },
    });
    this.map.addLayer({
      id: 'buildings-outline',
      type: 'line',
      source: BUILDINGS_SOURCE,
      'source-layer': BUILDINGS_SOURCE_LAYER,
      paint: { 'line-color': '#ffffff', 'line-width': 0.5, 'line-opacity': 0.3 },
    });

    this.map.addSource('ray', { type: 'geojson', data: emptyFeatureCollection() });
    this.map.addLayer({
      id: 'ray-line',
      type: 'line',
      source: 'ray',
      paint: { 'line-color': '#ff3b3b', 'line-width': 2, 'line-dasharray': [2, 2] },
    });

    this.map.addSource('observer', { type: 'geojson', data: emptyFeatureCollection() });
    this.map.addLayer({
      id: 'observer-point',
      type: 'circle',
      source: 'observer',
      paint: {
        'circle-radius': 6,
        'circle-color': '#ff3b3b',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    });

    this.layersReady = true;
    this.onPoseChange(this.pose.getPose());
  }

  private onPoseChange(pose: Pose): void {
    this.updateObserverMarker(pose);

    if (!this.layersReady || !pose.position) {
      this.setHit(null);
      this.updateRay(null);
      this.emit(pose);
      return;
    }

    if (this.panToNextPosition) {
      this.panToNextPosition = false;
      this.map.easeTo({ center: [pose.position.lng, pose.position.lat], duration: 800 });
    }

    // Default to due north when heading is unset, rather than showing no
    // ray/hit at all — map mode's ray is just a preview drawn on the map
    // itself (the user can see which way it's pointing), so a placeholder
    // heading is harmless here. The UI still displays "heading unset" (see
    // App.tsx) since pose.headingDeg itself is untouched — only this
    // controller's own raycast uses the 0 fallback. AR mode does NOT do
    // this (see arMode.ts): pointing a live camera and identifying whatever
    // happens to be due north regardless of where the phone is actually
    // aimed would be actively misleading, not a harmless preview.
    const headingDeg = pose.headingDeg ?? 0;
    const buildings = queryNearbyBuildings(this.map);
    const hit = raycast(pose.position, headingDeg, buildings, RAY_MAX_RANGE_M);
    const endpoint = hit ? toGeo(hit.x, hit.y, pose.position) : null;
    this.updateRay(
      endpoint ? { lng: endpoint[1], lat: endpoint[0] } : rayCastPoint(pose.position, headingDeg, RAY_MAX_RANGE_M),
      pose.position,
    );
    this.setHit(hit);
    this.emit(pose);
  }

  private updateObserverMarker(pose: Pose): void {
    const source = this.map.getSource('observer') as maplibregl.GeoJSONSource | undefined;
    source?.setData(pose.position ? pointFeature(pose.position) : emptyFeatureCollection());
  }

  private updateRay(endpoint: LngLat | null, observer?: LngLat): void {
    const source = this.map.getSource('ray') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    if (!endpoint || !observer) {
      source.setData(emptyFeatureCollection());
      return;
    }
    source.setData(lineFeature(observer, endpoint));
  }

  private setHit(hit: RaycastHit | null): void {
    if (this.currentHit && this.currentHit.b.id !== hit?.b.id) {
      this.map.setFeatureState({ source: BUILDINGS_SOURCE, sourceLayer: BUILDINGS_SOURCE_LAYER, id: this.currentHit.b.id }, { highlight: false });
    }
    if (hit && hit.b.id !== this.currentHit?.b.id) {
      this.map.setFeatureState({ source: BUILDINGS_SOURCE, sourceLayer: BUILDINGS_SOURCE_LAYER, id: hit.b.id }, { highlight: true });
    }
    this.currentHit = hit;
  }

  private emit(pose: Pose): void {
    const state: MapModeState = { pose, hit: this.currentHit, city: this.city, colorByYear: this.colorByYear };
    for (const listener of this.listeners) listener(state);
  }

  /** Subscribes to pose/hit/city/colorByYear updates; immediately replays the current state. */
  onUpdate(listener: MapModeListener): () => void {
    this.listeners.add(listener);
    listener({ pose: this.pose.getPose(), hit: this.currentHit, city: this.city, colorByYear: this.colorByYear });
    return () => this.listeners.delete(listener);
  }

  /** Swaps the buildings vector source to the other city's tiles and re-centers. */
  switchCity(city: CityCode): void {
    if (city === this.city) return;
    this.city = city;
    const config = CITY_CONFIG[city];

    if (this.layersReady) {
      const source = this.map.getSource(BUILDINGS_SOURCE) as maplibregl.VectorTileSource;
      source.setUrl(pmtilesUrl(config.pmtilesPath));
    }

    this.pose.reset();
    // jumpTo, not flyTo — an animated flight across a ~3900km Seattle<->NYC
    // gap is a multi-second detour, not a nice touch, for what's really just
    // a city switch.
    this.map.jumpTo({ center: config.center, zoom: 15.5 });
  }

  /** Toggles the year-built choropleth (map mode only, see YEAR_COLOR_BUCKETS). */
  setColorByYear(enabled: boolean): void {
    if (enabled === this.colorByYear) return;
    this.colorByYear = enabled;
    if (this.layersReady) {
      this.map.setPaintProperty('buildings-fill', 'fill-extrusion-color', buildingsFillColorExpression(enabled));
    }
    this.emit(this.pose.getPose());
  }

  /** Starts the geolocation watch and smooth-pans the map to the first fix
   * that comes back — a one-shot pan, not on every subsequent update, so a
   * live GPS watch doesn't keep yanking the view out from under someone
   * who's since panned/zoomed elsewhere on their own. */
  startGeolocation(): void {
    this.panToNextPosition = true;
    this.pose.startGeolocation();
  }
}

export function initMapMode(container: HTMLElement): MapModeController {
  return new MapModeController(container);
}
