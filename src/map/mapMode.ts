import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import { toGeo } from '../core/geo';
import { PoseManager, type Pose } from '../core/pose';
import { raycast, type RaycastHit } from '../core/raycast';
import { queryNearbyBuildings } from '../core/buildings';
import type { LngLat } from '../core/types';

// Downtown Seattle — launch city center (§0, §10 M0 DoD).
const SEATTLE_CENTER: [number, number] = [-122.3321, 47.6062];

// No API keys anywhere (§1): OpenFreeMap serves this style + its basemap tiles for free.
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

const RAY_MAX_RANGE_M = 650;
const BUILDINGS_SOURCE = 'buildings';
const BUILDINGS_SOURCE_LAYER = 'buildings';

let protocolRegistered = false;

function ensurePmtilesProtocol(): void {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  protocolRegistered = true;
}

function pmtilesUrl(publicPath: string): string {
  return `pmtiles://${new URL(publicPath, window.location.href).href}`;
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
}

export type MapModeListener = (state: MapModeState) => void;

/**
 * Owns the MapLibre instance, the pose pipeline, and the ray/highlight/identify
 * loop for map mode (§7). React (src/ui/App.tsx) only ever reads state via
 * `onUpdate` and issues commands (`useMyLocation`, `useCompass`, ...) — it never
 * touches the map or pose internals directly.
 */
export class MapModeController {
  readonly map: maplibregl.Map;
  readonly pose = new PoseManager();

  private readonly listeners = new Set<MapModeListener>();
  private currentHit: RaycastHit | null = null;
  private layersReady = false;

  constructor(container: HTMLElement) {
    ensurePmtilesProtocol();

    this.map = new maplibregl.Map({
      container,
      style: BASEMAP_STYLE,
      center: SEATTLE_CENTER,
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
      url: pmtilesUrl('/tiles/sea.pmtiles'),
      promoteId: 'id',
    });
    this.map.addLayer({
      id: 'buildings-fill',
      type: 'fill-extrusion',
      source: BUILDINGS_SOURCE,
      'source-layer': BUILDINGS_SOURCE_LAYER,
      paint: {
        'fill-extrusion-color': ['case', ['boolean', ['feature-state', 'highlight'], false], '#ff9d3f', '#5db8ff'],
        // fill-extrusion-opacity is constant-only in the style spec (unlike
        // -color) — no data/feature-state expressions — so highlight has to
        // be color-only here; color contrast alone reads fine at this opacity.
        'fill-extrusion-opacity': 0.75,
        // Most footprints get a real height_m from floors × 3.5m (§3); the rest
        // (no Assessor match) fall back to a flat ~1-story placeholder.
        'fill-extrusion-height': ['coalesce', ['get', 'height_m'], 3.5],
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

    if (pose.headingDeg === null) {
      this.setHit(null);
      this.updateRay(null);
      this.emit(pose);
      return;
    }

    const buildings = queryNearbyBuildings(this.map);
    const hit = raycast(pose.position, pose.headingDeg, buildings, RAY_MAX_RANGE_M);
    const endpoint = hit ? toGeo(hit.x, hit.y, pose.position) : null;
    this.updateRay(
      endpoint
        ? { lng: endpoint[1], lat: endpoint[0] }
        : rayCastPoint(pose.position, pose.headingDeg, RAY_MAX_RANGE_M),
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
    const state: MapModeState = { pose, hit: this.currentHit };
    for (const listener of this.listeners) listener(state);
  }

  /** Subscribes to pose/hit updates; immediately replays the current state. */
  onUpdate(listener: MapModeListener): () => void {
    this.listeners.add(listener);
    listener({ pose: this.pose.getPose(), hit: this.currentHit });
    return () => this.listeners.delete(listener);
  }

  useMyLocation(): void {
    this.pose.startGeolocation();
  }

  useCompass(): Promise<'granted' | 'denied' | 'unsupported'> {
    return this.pose.startCompass();
  }

  setManualHeading(headingDeg: number): void {
    this.pose.setManualHeading(headingDeg);
  }

  setManualHeadingOffset(offsetDeg: number): void {
    this.pose.setManualHeadingOffset(offsetDeg);
  }
}

export function initMapMode(container: HTMLElement): MapModeController {
  return new MapModeController(container);
}
