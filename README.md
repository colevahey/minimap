# Minimap

Point your phone at a building to identify it — height, floors, year built, and
registered owner. Launch city is Seattle / King County; NYC is the second city.
See `PLAN.md` for the full design and milestone plan.

## Client

```
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm test
npm run build
```

Sensor features (compass, camera) require a secure context. To test on a phone
during development, tunnel the dev server over HTTPS, e.g.:

```
npm run dev -- --host
npx localtunnel --port 5173     # or: cloudflared tunnel --url http://localhost:5173
```

## Pipeline

```
cd pipeline
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest
```

Building tiles additionally requires the `tippecanoe` and `pmtiles` CLIs
(`brew install tippecanoe`, https://github.com/protomaps/go-pmtiles) — see
`pipeline/build_tiles.sh`.

## Attribution

Basemap © [OpenFreeMap](https://openfreemap.org) / OpenStreetMap contributors
(ODbL). Building data attribution: King County GIS/Assessor; NYC Department
of City Planning / NYC Open Data.
