# MINIMAP — Building Identifier PWA · Implementation Plan

A point-and-identify app: aim your phone at a building in a supported metro and it
highlights the building and shows height, floors, year built, and owner. Launch city
is **Seattle / King County**; **NYC** is the second city and exists in this plan to prove
the multi-city architecture is real, not bolted on.

This document is written for an autonomous coding agent (Claude Code) to execute in a
fresh git repo. Work milestone by milestone, commit at each **Definition of Done**, and
do not skip acceptance criteria. Where a step says *verify the current URL*, actually
fetch and confirm before downloading — government data portals move.

---

## 0. Decisions already made (do not relitigate)

These are settled. Build on them.

1. **Geo-first, vision-later.** Identification is done by ray-casting the device's
   position + heading against building footprints. Camera vision is a *refinement* layer
   added much later, never the primary mechanism.
2. **No reliance on WebXR.** iPhone Safari does not expose handheld WebXR AR, and a large
   share of the audience is on iPhone. The "AR" view is a **2D-overlay**: a `getUserMedia`
   camera feed with building outlines projected onto a `<canvas>` layer. This works
   identically on iOS and Android.
3. **Static tiles by default.** Building data is baked into **PMTiles** and served as
   static files; the client queries the tiles near the user and ray-casts client-side.
   No backend required for v1. A tiles/API server is a documented upgrade path, not part
   of the initial build.
4. **One normalized schema, per-city adapters.** All city-specific messiness lives in the
   **data pipeline**. The client is city-agnostic and only ever reads the normalized
   schema in §4.
5. **Compass needs a permission tap + HTTPS.** iOS gates `DeviceOrientationEvent` behind
   `requestPermission()` triggered by a user gesture, and sensors require a secure
   context. The UI must have an explicit "Use compass" toggle.
6. **Owner data is imperfect.** For large buildings the registered owner is usually an LLC,
   not the occupant. Surface it as "registered owner," never "who's inside."

---

## 1. Tech stack

**Client** (`/` root):
- Vite + TypeScript, no heavy UI framework (vanilla TS modules + small view controllers).
- **MapLibre GL JS** for map mode, with the **PMTiles** protocol plugin (`pmtiles` npm) so
  it reads static `.pmtiles` directly over HTTP range requests.
- Custom `<canvas>` / WebGL overlay for AR mode (no MapLibre there).
- `vite-plugin-pwa` (Workbox) for manifest + service worker + offline caching.

**Pipeline** (`/pipeline`):
- Python 3.11+, **GeoPandas** / **shapely** / **pyproj** for ingest + spatial joins.
- **tippecanoe** to tile normalized GeoJSON → MBTiles, then **`pmtiles convert`** to PMTiles.
  (Both are CLI tools; document install via `brew`/`apt`.)

**CI/deploy**: GitHub Actions builds tiles + client and deploys to GitHub Pages (or any
static host). All data sources are open — **no API keys anywhere**.

---

## 2. Repo structure

```
minimap/
├── README.md
├── PLAN.md                      # this file
├── package.json
├── vite.config.ts
├── index.html
├── public/
│   ├── tiles/                   # built PMTiles land here (gitignored; built in CI)
│   │   ├── sea.pmtiles
│   │   └── nyc.pmtiles
│   ├── manifest.webmanifest
│   └── icons/
├── src/
│   ├── main.ts                  # entry; mode switch (map | ar)
│   ├── core/
│   │   ├── types.ts             # normalized Building + Pose (see §4, §6)
│   │   ├── geo.ts               # projection helpers (spec in §5)
│   │   ├── raycast.ts           # ray vs footprint set (spec in §5)
│   │   ├── pose.ts              # position + heading + pitch, smoothing, permissions (§6)
│   │   └── buildings.ts         # query PMTiles near observer, cache
│   ├── map/mapMode.ts           # MapLibre view: pin + heading + ray + highlight
│   ├── ar/arMode.ts             # camera + orientation overlay (§7)
│   └── ui/                      # panel, controls, status
├── pipeline/
│   ├── README.md
│   ├── requirements.txt
│   ├── schema.py                # normalized record + validation
│   ├── common.py                # shared spatial-join / height helpers
│   ├── cities/
│   │   ├── seattle.py           # King County adapter
│   │   └── nyc.py               # NYC adapter
│   ├── build_tiles.sh           # normalized GeoJSON -> tippecanoe -> pmtiles
│   └── data/                    # raw + intermediate (gitignored)
├── tests/                       # unit tests (geo + raycast test vectors in §5)
└── .github/workflows/deploy.yml
```

`.gitignore`: `pipeline/data/`, `public/tiles/*.pmtiles`, `node_modules`, `dist`.
Never commit raw datasets or built tiles — build them in CI. A tiny committed fixture
(a handful of buildings as GeoJSON) under `tests/fixtures/` is fine for tests.

---

## 3. Data sources

Name the dataset, resolve the current download URL at ingest time, cite/attribute it.

### Seattle / King County (launch city)
- **Footprints (geometry):** King County GIS Open Data — building outlines for King County.
  Fallback if coverage gaps: **Microsoft US Building Footprints** (Washington),
  GitHub `microsoft/USBuildingFootprints` — geometry only, no attributes.
- **Attributes (floors, year, owner):** **King County Assessor** downloadable extracts
  (Parcel, ResBldg, CommBldg real-property files). `ResBldg`/`CommBldg` give number of
  stories and year built; `Parcel`/taxpayer gives registered owner. Key = PIN (Major+Minor).
- **Height:** MVP = estimate `height_m ≈ floors × 3.5`. Stretch = derive from LiDAR nDSM
  (Puget Sound LiDAR Consortium / WA DNR Lidar Portal).
- **Join:** footprint → parcel by centroid point-in-polygon (or PIN if present on footprint)
  → ResBldg/CommBldg by PIN. Parcels can hold multiple buildings; keep the largest-area
  building's attributes per footprint and store parcel PIN in `attrs`.

### NYC (second city — proves the adapter)
- **Footprints (geometry + height):** **NYC Open Data — Building Footprints** (has
  `heightroof`, ground elevation, construction year, `BIN`, `BBL`). Height is LiDAR-derived
  and baked in — no estimation needed.
- **Attributes (floors, year, owner):** **MapPLUTO** (NYC Dept of City Planning) — number
  of floors (`numfloors`), year built (`yearbuilt`), owner (`ownername`), keyed by `BBL`.
- **Join:** footprint → PLUTO on `BBL`. Some footprints map to multiple BBLs; take the
  primary. Store `BIN` and `BBL` in `attrs`.

**Attribution/licensing:** OSM fallback data is ODbL (must attribute OpenStreetMap
contributors). NYC and King County data are open government data — attribute the agency.
Put a data-attribution line in the app footer and `README.md`.

---

## 4. Normalized schema (the contract)

Every city adapter must emit records that validate against this. The client reads *only* this.

```ts
// src/core/types.ts
export type CityCode = 'sea' | 'nyc';

export interface Building {
  id: string;              // stable per city (NYC: BIN; Seattle: footprint id / PIN)
  city: CityCode;
  name?: string;           // present for named/landmark buildings, often absent
  height_m?: number;       // from LiDAR (NYC) or floors×3.5 estimate (Seattle MVP)
  floors?: number;
  year_built?: number;
  owner?: string;          // registered owner (often an LLC) — label as such in UI
  source: string;          // e.g. "NYC DCP Building Footprints + MapPLUTO"
  attrs?: Record<string, string | number>;  // city-specific extras (BBL, PIN, etc.)
  // geometry travels as the PMTiles feature polygon, not on this object
}
```

GeoJSON emitted by the pipeline: one `Feature` per building, `geometry` = footprint
`Polygon` (WGS84 / EPSG:4326), `properties` = the fields above (minus geometry).
`id` must be globally unique across cities (prefix with city code, e.g. `nyc:1234567`).

Tiling: `tippecanoe` with a layer named `buildings`, min/max zoom tuned so ~z14–17 carry
full footprints (buildings shouldn't be dropped/simplified away at the zoom the client
queries). Then `pmtiles convert` to `public/tiles/{city}.pmtiles`.

---

## 5. Core geometry (already validated — implement exactly)

Work in a **local ENU planar approximation** centred on the observer (good to well under
a metre over the ~650 m ray range). Headings are **degrees clockwise from true north**.

```ts
// src/core/geo.ts
const M_PER_DEG_LAT = 110540;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
export const mPerDegLng = (lat: number) => 111320 * Math.cos(lat * D2R);

export interface LngLat { lng: number; lat: number; }

// [lng,lat] -> local metres {x east, y north} around origin o
export function toLocal(lng: number, lat: number, o: LngLat) {
  return { x: (lng - o.lng) * mPerDegLng(o.lat), y: (lat - o.lat) * M_PER_DEG_LAT };
}
// local metres -> [lat,lng]
export function toGeo(x: number, y: number, o: LngLat): [number, number] {
  return [o.lat + y / M_PER_DEG_LAT, o.lng + x / mPerDegLng(o.lat)];
}
```

```ts
// src/core/raycast.ts
// A building here is { ring: [lng,lat][], ...Building }. Returns nearest hit or null.
export function raycast(o, headingDeg, buildings, maxRange = 650) {
  const th = headingDeg * Math.PI / 180;
  const dx = Math.sin(th), dy = Math.cos(th);          // unit dir (east, north)
  let best = null;
  for (const b of buildings) {
    const ring = b.ring;
    for (let i = 0; i < ring.length; i++) {
      const A = toLocal(ring[i][0], ring[i][1], o);
      const j = (i + 1) % ring.length;
      const B = toLocal(ring[j][0], ring[j][1], o);
      const ex = B.x - A.x, ey = B.y - A.y;
      const det = -dx * ey + ex * dy;                  // parallel if ~0
      if (Math.abs(det) < 1e-9) continue;
      const t = (-A.x * ey + ex * A.y) / det;          // metres along ray
      const u = ( dx * A.y - dy * A.x) / det;          // position along edge [0,1]
      if (t > 0.5 && t < maxRange && u >= 0 && u <= 1) {
        if (!best || t < best.t) best = { t, b, x: t * dx, y: t * dy };
      }
    }
  }
  return best;   // { t: distance-to-façade-m, b: building, x, y: hit point local }
}
```

**Unit-test vectors (must pass — these are verified):** observer at
`{lat:47.606, lng:-122.333}`, two 40 m square buildings, one centred 120 m due north, one
120 m due east.

| heading | expected |
|---|---|
| 0° (N)   | hits the **north** building, `t ≈ 100 m` |
| 90° (E)  | hits the **east** building, `t ≈ 100 m` |
| 180° (S) | **null** (nothing there) |
| 45°      | **null** (both off-axis) |

Add these as `tests/raycast.test.ts`. Also unit-test `toLocal`/`toGeo` round-trip.

---

## 6. Pose (position + heading + pitch)

```ts
// src/core/pose.ts — responsibilities
// - position: navigator.geolocation (high accuracy) OR manual map tap (map mode).
// - heading:  live compass via DeviceOrientationEvent, with manual slider fallback.
// - pitch:    device beta/gamma (needed for AR height-occlusion in §8); ignored in map mode.
```

Compass rules (verified approach — implement exactly):
- **Gesture-gated permission:** a "Use compass" button calls
  `DeviceOrientationEvent.requestPermission()` when that function exists (iOS); handle
  `granted` / `denied` / throw. On non-iOS it's absent — just add listeners.
- **Read heading cross-platform:**
  - iOS: `event.webkitCompassHeading` — already true-north and screen-corrected; use directly.
  - Android: use `deviceorientationabsolute`; require `event.absolute === true`, then
    `heading = 360 - event.alpha - screenAngle`, where `screenAngle =
    (screen.orientation?.angle) || window.orientation || 0`.
  - Ignore relative-only events (they drift).
- **Smooth** with a circular low-pass filter (average sin/cos, α≈0.25) to kill jitter.
- **Throttle** recompute to `requestAnimationFrame` (orientation fires far faster than needed).
- Surface `webkitCompassAccuracy` when poor (<0 or >25) as a "figure-8 to calibrate" hint.
- Provide a **manual heading-offset nudge** (±°) so a user can trim residual compass bias
  while testing. Expect raw downtown compass error of 10–30°; this and the §9 vision layer
  are the mitigations.

---

## 7. Client modes

**Map mode** (validation + desktop): MapLibre + PMTiles source; tap to place observer;
live compass or slider heading; draw the ray polyline; highlight the ray's hit building;
identify panel shows name / floors / height / year / owner / range-to-façade / source.
This is the productized version of the validated prototype. Auto-load nothing extra — the
PMTiles source already streams every building in view.

**AR mode** (the product): full-screen `getUserMedia` back-camera feed; `pose` supplies
heading + pitch; project the footprints of nearby buildings into screen space and stroke
their outlines on a `<canvas>` overlay; the building nearest the screen centre (via
`raycast`) is highlighted and drives the identify panel; tap a building to lock its detail
card. Graceful fallbacks: camera denied → message + offer map mode; no sensor → slider.

---

## 8. Height-occlusion (AR correctness)

Flat first-intersection is wrong when a short building sits in front of a taller one you're
looking *over*. Fix in AR using pitch + heights:

- Observer eye height ≈ 1.6 m. For each footprint the ray crosses at distance `d` with
  height `H`, the angle to its roofline is `atan2(H - 1.6, d)` and to its base is
  `atan2(-1.6, d)`.
- The building you see at a given screen row corresponds to your **pitch**: walk candidates
  front-to-back; the first whose vertical span (base→roof angle) contains the ray's pitch is
  the visible one. A nearer short building only occludes a farther tall one below the near
  building's roofline angle.
- Where `height_m` is missing, fall back to `floors × 3.5`; if both missing, treat as the
  flat first-intersection.

---

## 9. Later milestones (spec lightly, don't build yet)

- **Vision-refine:** detect strong vertical edges / vanishing point in the camera frame to
  estimate and correct heading offset, and snap projected outlines to real building edges.
  This is what ultimately removes manual compass nudging. Frame-by-frame CV (edge detection,
  optionally a small model via ONNX Runtime Web / TF.js) — *not* SLAM, no WebXR.
- **King County Assessor deep join:** replace the floors×3.5 height estimate with LiDAR nDSM
  heights; enrich owner/permit data.
- **More cities:** each new city = one new `pipeline/cities/<x>.py` adapter emitting the §4
  schema + a new `<x>.pmtiles`. The client needs zero changes.

---

## 10. Milestones & Definition of Done

Commit at each DoD. Run typecheck + lint + tests before every commit. Prefix commits with
the milestone (`M1: ...`).

### M0 — Scaffold
- Vite + TS client boots; MapLibre renders a Seattle basemap; `vite-plugin-pwa` wired.
- Pipeline skeleton (`pipeline/` with `requirements.txt`, empty adapters, `build_tiles.sh`).
- CI workflow present (may no-op initially).
- **DoD:** `npm run dev` shows a map of downtown Seattle; `npm run build` succeeds; `pytest`
  runs (even if trivial).

### M1 — Seattle data → PMTiles
- `cities/seattle.py`: download footprints + Assessor extracts (verify URLs), spatial-join,
  emit normalized GeoJSON validating against `schema.py`; height = floors×3.5 estimate.
- `build_tiles.sh` produces `public/tiles/sea.pmtiles` (layer `buildings`, no footprints
  dropped at z14–17).
- **DoD:** `sea.pmtiles` exists; spot-check 5 known downtown buildings have plausible
  floors/year/owner; feature count is in the expected order of magnitude for the area built.

### M2 — Map mode (ships the validated core)
- Load `sea.pmtiles` in MapLibre; implement `core/geo`, `core/raycast` (pass §5 test vectors),
  `core/buildings` (query features near observer), `core/pose` (position + slider + live
  compass per §6).
- Ray + highlight + identify panel working; manual heading-offset nudge present.
- **DoD:** on a phone over HTTPS, "Use my location" + "Use compass" points the ray live and
  identifies the correct building on a known block; §5 unit tests green.

### M3 — NYC (prove the adapter)
- `cities/nyc.py`: footprints + MapPLUTO join on BBL; real LiDAR heights; emit §4 schema;
  build `nyc.pmtiles`.
- Add a city switcher to the client (loads the other PMTiles source). **No other client
  changes should be required** — if they are, the schema boundary leaked; fix the pipeline.
- **DoD:** switching to NYC identifies Manhattan buildings with real heights; client diff for
  this milestone touches only city-selection/config, not core logic.

### M4 — AR mode
- Camera passthrough + orientation overlay (§7); height-occlusion (§8); tap-to-lock detail.
- **DoD:** on a phone, pointing at a building outlines and identifies it; aiming up at a tall
  tower behind a low building selects the tower.

### M5 — PWA
- Manifest + icons + installability; service worker caches app shell, basemap tiles, and
  PMTiles ranges for offline; iOS install + compass-permission flow verified.
- **DoD:** installs to home screen on iOS and Android; core identify works offline for a
  previously-visited area; Lighthouse PWA checks pass.

### M6 — Stretch
- Vision-refine, LiDAR heights, additional cities (§9), share cards.

---

## 11. Conventions for the agent

- **Verify before download.** Resolve each dataset's current URL by fetching the portal page;
  don't hardcode a stale deep link. Log the resolved URL + retrieval date in a
  `pipeline/data/SOURCES.md`.
- **Never commit** raw data or built `.pmtiles`; build them in CI. Keep only a tiny GeoJSON
  fixture for tests.
- **Secure context only** for sensor/camera features; document the local HTTPS tunnel in the
  README (`python3 -m http.server` + `cloudflared`/`localtunnel`).
- **Attribution** in footer + README for OSM (if used), NYC DCP, and King County.
- **Owner = "registered owner"** in all UI copy; never imply occupant.
- Keep the **client city-agnostic**. Any city-specific `if (city === ...)` in `src/core` is a
  bug — push it into the pipeline.

---

## 12. UI

The identify panel and controls (buttons, toggles, city switcher, detail sheet) are built
with **React + Coinbase Design System Web (`@coinbase/cds-web`)**, scoped to `src/ui/`.
MapLibre (map mode) and the camera/canvas overlay (AR mode, §7) stay vanilla TS — they are
perf-sensitive render loops that don't benefit from a component tree, and this keeps
`@coinbase/cds-web`'s React/framer-motion/zustand dependency chain out of the hot path.
`main.tsx` mounts the vanilla map/AR layer into one container and the React UI tree into a
separate absolutely-positioned overlay container on top of it, wrapped in CDS's
`ThemeProvider` using `defaultTheme` (not the Coinbase-branded theme, since this isn't a
Coinbase-branded app) with `activeColorScheme` set from `prefers-color-scheme`.
