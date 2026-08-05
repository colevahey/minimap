"""King County / Seattle adapter (§3, launch city).

Sources (resolved 2026-08-05, see pipeline/data/SOURCES.md):
  - Footprints: King County GIS Open Data has no county-wide building-outline
    layer (only borough-specific ones) — this uses the §3-documented
    fallback, Microsoft US Building Footprints (Washington), pre-filtered to
    a Seattle bounding box.
  - Parcel polygons (for the point-in-polygon join, since the Assessor's
    Parcel.csv is attributes-only with no geometry): King County GIS's
    "Parcel" ArcGIS Feature Service (PARCEL_AREA_439), also bbox-filtered.
  - Attributes: King County Assessor extracts — EXTR_ResBldg.csv /
    EXTR_CommBldg.csv for floors + year built, keyed by PIN (Major+Minor).

Owner: the Assessor's public bulk extract redacts the taxpayer/owner name
(the file is literally EXTR_RPAcct_NoName.csv — see SOURCES.md). `owner` is
left absent for Seattle; the schema treats it as optional.

Join: footprint centroid -> parcel (point-in-polygon) -> ResBldg/CommBldg by
PIN. A parcel can hold multiple building records (e.g. several outbuildings);
keep the largest-area one and store the PIN in `attrs`.
"""

from __future__ import annotations

import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from schema import Building  # noqa: E402

CITY_CODE = "sea"
M_PER_FLOOR = 3.5


def _pin(major: pd.Series, minor: pd.Series) -> pd.Series:
    return major.astype(str).str.strip().str.zfill(6) + minor.astype(str).str.strip().str.zfill(4)


def _load_res_commercial_bldg(assessor_dir: Path) -> pd.DataFrame:
    """Returns one row per PIN: floors, year_built, and a `use` marker, preferring
    the largest-area building record when a parcel has more than one (§3)."""
    res = pd.read_csv(assessor_dir / "EXTR_ResBldg.csv", dtype=str, encoding="cp1252")
    res["PIN"] = _pin(res["Major"], res["Minor"])
    res["floors"] = pd.to_numeric(res["Stories"], errors="coerce")
    res["year_built"] = pd.to_numeric(res["YrBuilt"], errors="coerce")
    res["area"] = pd.to_numeric(res["SqFtTotLiving"], errors="coerce").fillna(0)
    res = res.sort_values("area", ascending=False).drop_duplicates("PIN", keep="first")
    res = res[["PIN", "floors", "year_built"]]

    comm = pd.read_csv(assessor_dir / "EXTR_CommBldg.csv", dtype=str, encoding="cp1252")
    comm["PIN"] = _pin(comm["Major"], comm["Minor"])
    comm["floors"] = pd.to_numeric(comm["NbrStories"], errors="coerce")
    comm["year_built"] = pd.to_numeric(comm["YrBuilt"], errors="coerce")
    comm["area"] = pd.to_numeric(comm["BldgGrossSqFt"], errors="coerce").fillna(0)
    comm = comm.sort_values("area", ascending=False).drop_duplicates("PIN", keep="first")
    comm = comm[["PIN", "floors", "year_built"]]

    # Commercial takes precedence when a PIN has both (rare) — a parcel that
    # has a real commercial structure is more likely to be what a footprint
    # there actually represents.
    merged = pd.concat([res, comm]).drop_duplicates("PIN", keep="last")
    return merged.set_index("PIN")


def _join_by_max_overlap(footprints: gpd.GeoDataFrame, parcels: gpd.GeoDataFrame) -> pd.Series:
    """Maps each footprint index to the PIN of the parcel it overlaps most.

    Centroid-in-polygon looks simpler but is wrong for tall buildings: Microsoft's
    footprints are traced from satellite imagery, so a tower's rooftop outline is
    parallax-shifted from its true ground footprint and can land outside its own
    parcel's centroid test entirely (verified on Smith Tower and Rainier Square
    Tower — both silently dropped under centroid-within). Overlap area is robust
    to that shift as long as the footprint and parcel still intersect at all.
    """
    # Real-world parcel/footprint polygons are occasionally self-intersecting
    # (slivers, figure-eight rings); buffer(0) repairs them without changing
    # valid geometry, and intersection() raises GEOSException otherwise.
    footprints = footprints.assign(geometry=footprints.geometry.buffer(0))
    parcels = parcels.assign(geometry=parcels.geometry.buffer(0))

    candidates = gpd.sjoin(footprints[["geometry"]], parcels, how="inner", predicate="intersects")
    if candidates.empty:
        return pd.Series(dtype=object)

    fp_geom = footprints.geometry.loc[candidates.index]
    parcel_geom = parcels.geometry.loc[candidates["index_right"]].reset_index(drop=True)
    candidates = candidates.reset_index()
    candidates["overlap_area"] = fp_geom.reset_index(drop=True).intersection(parcel_geom).area
    best = candidates.sort_values("overlap_area", ascending=False).drop_duplicates("index", keep="first")
    return best.set_index("index")["PIN"]


def build(footprints_path: str, parcels_path: str, assessor_dir: str) -> gpd.GeoDataFrame:
    """Emits a GeoDataFrame of §4-normalized records for Seattle / King County."""
    footprints = gpd.read_file(footprints_path)
    parcels = gpd.read_file(parcels_path)[["PIN", "geometry"]]

    # King County official state plane (feet) — polygon overlap on a geographic
    # CRS is inaccurate; project before the join, keep WGS84 for output.
    kc_crs = "EPSG:2926"
    pin_by_footprint = _join_by_max_overlap(footprints.to_crs(kc_crs), parcels.to_crs(kc_crs))

    bldg = _load_res_commercial_bldg(Path(assessor_dir))

    pin_counts: dict[str, int] = {}
    records = []
    geometries = []
    for idx, row in footprints.iterrows():
        pin = pin_by_footprint.get(idx)
        floors = year_built = None
        attrs: dict[str, str | float] = {}
        if pin is not None and not pd.isna(pin):
            attrs["pin"] = pin
            if pin in bldg.index:
                info = bldg.loc[pin]
                floors = None if pd.isna(info["floors"]) else int(info["floors"])
                year_built = None if pd.isna(info["year_built"]) else int(info["year_built"])
            n = pin_counts.get(pin, 0)
            pin_counts[pin] = n + 1
            building_id = f"{CITY_CODE}:{pin}" if n == 0 else f"{CITY_CODE}:{pin}-{n + 1}"
        else:
            building_id = f"{CITY_CODE}:footprint-{idx}"

        b = Building(
            id=building_id,
            city=CITY_CODE,
            source="Microsoft Building Footprints; King County Parcel boundaries; King County Assessor (ResBldg/CommBldg)",
            height_m=None if floors is None else round(floors * M_PER_FLOOR, 1),
            floors=floors,
            year_built=year_built,
            attrs=attrs,
        )
        b.validate()
        records.append(b.to_geojson_properties())
        geometries.append(row.geometry)

    return gpd.GeoDataFrame(records, geometry=geometries, crs=footprints.crs)


if __name__ == "__main__":
    import argparse

    from common import write_geojson

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("footprints", help="Seattle-filtered building footprints GeoJSON")
    parser.add_argument("parcels", help="Seattle-filtered King County parcel polygons GeoJSON")
    parser.add_argument("assessor_dir", help="Directory with EXTR_ResBldg.csv / EXTR_CommBldg.csv")
    parser.add_argument("out", help="Output normalized GeoJSON path")
    args = parser.parse_args()

    gdf = build(args.footprints, args.parcels, args.assessor_dir)
    write_geojson(gdf, args.out)
    print(f"wrote {len(gdf)} buildings -> {args.out}")
