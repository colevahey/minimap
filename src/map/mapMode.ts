import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';

// Downtown Seattle — launch city center (§0, §10 M0 DoD).
const SEATTLE_CENTER: [number, number] = [-122.3321, 47.6062];

// No API keys anywhere (§1): OpenFreeMap serves this style + its basemap tiles for free.
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

let protocolRegistered = false;

function ensurePmtilesProtocol(): void {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  protocolRegistered = true;
}

export function initMapMode(container: HTMLElement): maplibregl.Map {
  ensurePmtilesProtocol();

  const map = new maplibregl.Map({
    container,
    style: BASEMAP_STYLE,
    center: SEATTLE_CENTER,
    zoom: 15.5,
    pitch: 0,
    attributionControl: { compact: true },
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  return map;
}
