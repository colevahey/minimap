"""King County / Seattle adapter (§3, launch city).

Sources (verify current URLs before downloading — government portals move,
see §11 — and log the resolved URL + retrieval date to pipeline/data/SOURCES.md):
  - Footprints: King County GIS Open Data building outlines.
    Fallback: Microsoft US Building Footprints (Washington) if coverage gaps.
  - Attributes: King County Assessor extracts (ResBldg/CommBldg for floors +
    year built, Parcel/taxpayer for registered owner), keyed by PIN.

Join: footprint -> parcel by centroid point-in-polygon (or PIN if present on
footprint) -> ResBldg/CommBldg by PIN. Parcels can hold multiple buildings;
keep the largest-area building's attributes per footprint, store the parcel
PIN in `attrs`.

M1 fills in the download + join. This module is currently a stub so the
pipeline package imports cleanly and `pytest` has something to collect.
"""

from __future__ import annotations

import geopandas as gpd

CITY_CODE = "sea"


def build(footprints_path: str, assessor_dir: str) -> gpd.GeoDataFrame:
    """Emits a GeoDataFrame of §4-normalized records for King County. TODO: M1."""
    raise NotImplementedError("Seattle adapter is implemented in M1")
