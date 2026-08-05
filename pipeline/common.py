"""Shared spatial-join / height helpers used by city adapters (§3)."""

from __future__ import annotations

import geopandas as gpd


def estimate_height_m(floors: float | None, m_per_floor: float = 3.5) -> float | None:
    """MVP height estimate for cities without LiDAR-derived heights (§3, Seattle)."""
    if floors is None:
        return None
    return floors * m_per_floor


def join_footprints_to_attributes(
    footprints: gpd.GeoDataFrame,
    attributes,
    footprint_key: str,
    attribute_key: str,
) -> gpd.GeoDataFrame:
    """Joins building footprints to a tabular attribute source on a shared key.

    Used for both the Seattle (PIN) and NYC (BBL) joins in §3 — the join
    strategy is the same, only the key and source columns differ per city.
    """
    return footprints.merge(
        attributes,
        left_on=footprint_key,
        right_on=attribute_key,
        how="left",
    )


def write_geojson(gdf: gpd.GeoDataFrame, out_path: str) -> None:
    gdf.to_crs(epsg=4326).to_file(out_path, driver="GeoJSON")
