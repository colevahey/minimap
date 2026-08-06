"""NYC adapter (§3, second city — proves the multi-city adapter architecture).

Sources (resolved 2026-08-06, see pipeline/data/SOURCES.md): both queried
live from NYC Open Data's SODA API rather than downloaded as bulk files.
  - Footprints + height: NYC Building Footprints (Socrata id 5zhs-2jue) —
    real LiDAR-derived `height_roof`, `construction_year`, `bin`, `bbl`
    (as `mappluto_bbl`). No estimation needed, unlike Seattle.
  - Attributes: PLUTO (Socrata id 64uk-42ks) — `numfloors`, `yearbuilt`,
    `ownername` (not redacted, unlike Seattle), `address`, `landuse`, keyed
    by `bbl`.

Scope: Manhattan only, per the M3 DoD.

Join: footprint's `mappluto_bbl` -> PLUTO's `bbl` directly — Building
Footprints already carries the BBL, so unlike Seattle there's no separate
parcel-polygon point-in-polygon step. Only `Constructed` footprints are kept
(drops ~1,000 demolished/under-construction/placeholder records).

Name: like Seattle, ~1% of footprints have a `name` (mostly good — landmarks,
named buildings — with a little junk: bare numbers, short internal codes)
filtered via `_is_bad_name`. Otherwise falls back to a cleaned PLUTO address
plus a coarse type label derived from PLUTO's `landuse` code (there's no
free-text building-description field in PLUTO the way Seattle's Assessor
extract has BldgDescr, so this is coarser than Seattle's fallback).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import shape

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from schema import Building  # noqa: E402

CITY_CODE = "nyc"

_LANDUSE_LABELS = {
    "1": "House",
    "2": "Apartment building",
    "3": "Apartment building",
    "4": "Mixed-use building",
    "5": "Commercial building",
    "6": "Industrial building",
    "7": "Transportation/utility facility",
    "8": "Public facility",
    "9": "Recreation facility",
    "10": "Parking facility",
    "11": "Vacant lot",
}


def _is_bad_name(name: str) -> bool:
    normalized = name.strip()
    if len(normalized) <= 2:
        return True
    if re.fullmatch(r"\d+", normalized):
        return True
    return False


def _title_case(text: str) -> str:
    return " ".join(w.capitalize() for w in text.strip().split())


def _bbl_key(bbl) -> str | None:
    if bbl is None:
        return None
    try:
        return str(int(float(bbl)))
    except (TypeError, ValueError):
        return None


def _load_pluto(pluto_path: str) -> pd.DataFrame:
    pluto = pd.read_json(pluto_path)
    pluto["bbl_key"] = pluto["bbl"].apply(_bbl_key)
    pluto["floors"] = pd.to_numeric(pluto["numfloors"], errors="coerce")
    pluto["year_built"] = pd.to_numeric(pluto["yearbuilt"], errors="coerce")
    pluto["owner"] = pluto["ownername"].where(pluto["ownername"].notna() & (pluto["ownername"].str.len() > 0))
    pluto["address"] = pluto["address"].apply(lambda a: _title_case(a) if isinstance(a, str) and a else None)
    pluto["type_label"] = pluto["landuse"].map(_LANDUSE_LABELS)
    pluto = pluto.dropna(subset=["bbl_key"]).drop_duplicates("bbl_key", keep="first")
    return pluto.set_index("bbl_key")[["floors", "year_built", "owner", "address", "type_label"]]


def _building_name(raw_name: str | None, address: str | None, type_label: str | None) -> str | None:
    if raw_name and not _is_bad_name(raw_name):
        return raw_name.strip()
    parts = [p for p in [address, type_label] if p]
    return " · ".join(parts) if parts else None


def build(footprints_path: str, pluto_path: str) -> gpd.GeoDataFrame:
    """Emits a GeoDataFrame of §4-normalized records for Manhattan / NYC."""
    footprints = pd.read_json(footprints_path)
    footprints = footprints[footprints["last_status_type"] == "Constructed"]
    # The source query only bbox-filtered to a rectangle around Manhattan, which
    # (being a narrow island) also sweeps in parts of Brooklyn/Queens/Bronx across
    # the rivers — BBL's leading borough digit (1 = Manhattan) is the precise filter.
    footprints = footprints[footprints["mappluto_bbl"].astype(str).str.startswith("1")]
    pluto = _load_pluto(pluto_path)

    records = []
    geometries = []
    bin_counts: dict[str, int] = {}
    for _, row in footprints.iterrows():
        bin_id = str(row.get("bin") or "")
        bbl_key = _bbl_key(row.get("mappluto_bbl"))

        floors = year_built = owner = address = type_label = None
        attrs: dict[str, str | float] = {}
        if bbl_key:
            attrs["bbl"] = bbl_key
        if bbl_key and bbl_key in pluto.index:
            info = pluto.loc[bbl_key]
            floors = None if pd.isna(info["floors"]) else int(info["floors"])
            year_built = None if pd.isna(info["year_built"]) else int(info["year_built"])
            owner = info["owner"] if isinstance(info["owner"], str) else None
            address = info["address"] if isinstance(info["address"], str) else None
            type_label = info["type_label"] if isinstance(info["type_label"], str) else None

        height_m = None
        height_roof = row.get("height_roof")
        if height_roof not in (None, ""):
            try:
                height_m = round(float(height_roof) * 0.3048, 1)  # NYC height_roof is in feet
            except ValueError:
                height_m = None

        n = bin_counts.get(bin_id, 0)
        bin_counts[bin_id] = n + 1
        building_id = f"{CITY_CODE}:{bin_id}" if n == 0 else f"{CITY_CODE}:{bin_id}-{n + 1}"

        raw_name = row.get("name")
        raw_name = raw_name if isinstance(raw_name, str) else None
        b = Building(
            id=building_id,
            city=CITY_CODE,
            name=_building_name(raw_name, address, type_label),
            source="NYC DCP Building Footprints + PLUTO",
            height_m=height_m,
            floors=floors,
            year_built=year_built,
            owner=owner,
            attrs=attrs | {"bin": bin_id},
        )
        b.validate()
        records.append(b.to_geojson_properties())

        geom = row["the_geom"]
        geometries.append(shape({"type": "Polygon", "coordinates": geom["coordinates"][0]}))

    return gpd.GeoDataFrame(records, geometry=geometries, crs="EPSG:4326")


if __name__ == "__main__":
    import argparse

    from common import write_geojson

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("footprints", help="NYC Building Footprints JSON (Manhattan-filtered SODA response)")
    parser.add_argument("pluto", help="PLUTO JSON (Manhattan-filtered SODA response)")
    parser.add_argument("out", help="Output normalized GeoJSON path")
    args = parser.parse_args()

    gdf = build(args.footprints, args.pluto)
    write_geojson(gdf, args.out)
    print(f"wrote {len(gdf)} buildings -> {args.out}")
