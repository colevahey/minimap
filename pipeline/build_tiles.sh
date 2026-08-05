#!/usr/bin/env bash
# Normalized GeoJSON -> tippecanoe -> pmtiles (§4).
# Usage: build_tiles.sh <city-code> <input.geojson> <output-dir>
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <city-code> <input.geojson> <output-dir>" >&2
  exit 1
fi

city="$1"
input="$2"
outdir="$3"

command -v tippecanoe >/dev/null || { echo "tippecanoe not found (brew install tippecanoe)" >&2; exit 1; }
command -v pmtiles >/dev/null || { echo "pmtiles CLI not found (see https://github.com/protomaps/go-pmtiles)" >&2; exit 1; }

mkdir -p "$outdir"
mbtiles="$outdir/${city}.mbtiles"
pmtiles_out="$outdir/${city}.pmtiles"

# z14-17 carry full footprints (§4): buildings must not be dropped/simplified
# away at the zoom the client queries.
tippecanoe \
  --output="$mbtiles" \
  --force \
  --layer=buildings \
  --minimum-zoom=14 \
  --maximum-zoom=17 \
  --no-feature-limit \
  --no-tile-size-limit \
  "$input"

pmtiles convert "$mbtiles" "$pmtiles_out"
rm -f "$mbtiles"

echo "wrote $pmtiles_out"
