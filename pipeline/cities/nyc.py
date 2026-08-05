"""NYC adapter (§3, second city — proves the multi-city adapter architecture).

Sources (verify current URLs before downloading, see §11):
  - Footprints + height: NYC Open Data Building Footprints (heightroof, ground
    elevation, construction year, BIN, BBL). Height is LiDAR-derived and baked
    in — no estimation needed, unlike Seattle.
  - Attributes: MapPLUTO (NYC Dept of City Planning) — numfloors, yearbuilt,
    ownername, keyed by BBL.

Join: footprint -> PLUTO on BBL. Some footprints map to multiple BBLs; take
the primary. Store BIN and BBL in `attrs`.

M3 fills in the download + join. This module is currently a stub so the
pipeline package imports cleanly and `pytest` has something to collect.
"""

from __future__ import annotations

import geopandas as gpd

CITY_CODE = "nyc"


def build(footprints_path: str, pluto_path: str) -> gpd.GeoDataFrame:
    """Emits a GeoDataFrame of §4-normalized records for NYC. TODO: M3."""
    raise NotImplementedError("NYC adapter is implemented in M3")
