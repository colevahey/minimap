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

## Deploying

Live at https://colevahey.github.io/minimap/.

Pushes to `main` auto-deploy the *client* (`.github/workflows/deploy.yml`) —
tile data isn't rebuilt in CI (that means re-downloading from King County/NYC
Open Data and redoing the pipeline joins, not a "ship a UI change" cost), it's
carried forward from whatever's already live. When the pipeline itself
changes and tiles need to be regenerated, rebuild them locally
(`pipeline/build_tiles.sh`, see above) and run:

```
npm run deploy:pages
```

## Attribution

Basemap © [OpenFreeMap](https://openfreemap.org) / OpenStreetMap contributors
(ODbL). Building data attribution: King County GIS/Assessor; NYC Department
of City Planning / NYC Open Data.
