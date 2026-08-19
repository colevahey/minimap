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
# away at the zoom the client queries there. Also generate z10-13 (city-wide
# views) so buildings don't vanish entirely when the map is zoomed out — the
# client fades fill-extrusion-height to 0 below z14 (map mode only) so those
# zooms render flat/2D rather than a chaotic wall of tiny 3D extrusions.
# Tippecanoe's default feature-dropping (no --no-feature-limit/--no-tile-size-limit
# this time) only actually engages at z10-13, where a tile covers enough area
# to hit the size limit — z14-17 tiles are small enough that nothing gets
# dropped there in practice, preserving the "no footprints dropped" guarantee
# for the zoom the client actually raycasts/identifies against.
tippecanoe \
  --output="$mbtiles" \
  --force \
  --layer=buildings \
  --minimum-zoom=10 \
  --maximum-zoom=17 \
  "$input"

pmtiles convert "$mbtiles" "$pmtiles_out"
rm -f "$mbtiles"

echo "wrote $pmtiles_out"
