"""Normalized building record (§4) that every city adapter must emit.

The client only ever reads this schema. City-specific messiness (assessor
extracts, BBL/PIN joins, etc.) must be resolved before a record reaches here.
"""

from __future__ import annotations

from dataclasses import dataclass, field

VALID_CITIES = {"sea", "nyc"}


@dataclass
class Building:
    id: str  # globally unique, prefixed with city code e.g. "nyc:1234567"
    city: str
    source: str
    name: str | None = None
    height_m: float | None = None
    floors: int | None = None
    year_built: int | None = None
    owner: str | None = None
    attrs: dict[str, str | float] = field(default_factory=dict)

    def validate(self) -> None:
        if self.city not in VALID_CITIES:
            raise ValueError(f"unknown city code: {self.city!r}")
        if not self.id.startswith(f"{self.city}:"):
            raise ValueError(f"id {self.id!r} must be prefixed with '{self.city}:'")
        if not self.source:
            raise ValueError(f"building {self.id!r} is missing a source citation")

    def to_geojson_properties(self) -> dict:
        props = {
            "id": self.id,
            "city": self.city,
            "source": self.source,
            "name": self.name,
            "height_m": self.height_m,
            "floors": self.floors,
            "year_built": self.year_built,
            "owner": self.owner,
        }
        return {k: v for k, v in props.items() if v is not None} | (
            {"attrs": self.attrs} if self.attrs else {}
        )
