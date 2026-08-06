# Resolved data source URLs

Populated by each city adapter run: dataset name, resolved download URL, and
retrieval date (§11 — portals move, don't hardcode stale deep links).

## Seattle / King County (M1, retrieved 2026-08-05)

King County GIS Open Data (checked via its DCAT feed and the legacy SDC
catalog) does not carry a county-wide building-footprint polygon layer —
only borough-specific ones (e.g. Vashon-Maury Island). Using the §3-documented
fallback for geometry.

| Dataset | URL | Size |
|---|---|---|
| Building footprints (geometry), WA statewide, filtered to King County | https://minedbuildings.z5.web.core.windows.net/legacy/usbuildings-v2/Washington.geojson.zip | 118 MB |
| Assessor Parcel extract (owner/taxpayer join key, PIN) | https://aqua.kingcounty.gov/extranet/assessor/Parcel.zip | 31 MB |
| Assessor Residential Building extract (floors, year built) | https://aqua.kingcounty.gov/extranet/assessor/Residential%20Building.zip | 21 MB |
| Assessor Commercial Building extract (floors, year built) | https://aqua.kingcounty.gov/extranet/assessor/Commercial%20Building.zip | 3.7 MB |
| Assessor Real Property Account extract (registered owner name) | https://aqua.kingcounty.gov/extranet/assessor/Real%20Property%20Account.zip | 18.6 MB |

The Assessor extract URLs were found by decoding the ASP.NET `__VIEWSTATE` of
https://info.kingcounty.gov/assessor/DataDownload/default.aspx (the page's
rendered HTML doesn't expose them as plain `<a href>` links — they're bound
into a GridView control). `_tab.zip` variants exist alongside each of the
above (tab- vs comma-delimited); we use the plain (comma-delimited) ones.

**Owner data gap:** the Real Property Account extract is literally named
`EXTR_RPAcct_NoName.csv` — King County redacts the taxpayer/owner name from
the public bulk download (the page's disclaimer cites RCW 42.56.070(9),
prohibiting commercial use of individual-owner lists). Owner name is visible
per-parcel on the interactive eRealProperty lookup site, but that's a
one-parcel-at-a-time page, not a bulk source. Seattle buildings ship with
`owner` absent (the schema already treats it as optional); NYC (M3) will
carry a real `owner` via MapPLUTO's `ownername` field.

## NYC (M3, retrieved 2026-08-06)

Both datasets are on NYC Open Data (Socrata/SODA API), queried directly rather
than downloaded as bulk files — no separate parcel-polygon fetch needed like
Seattle's, since Building Footprints already carries its own BBL.

| Dataset | Socrata ID | Endpoint |
|---|---|---|
| Building Footprints (geometry, BIN, BBL, height_roof, construction_year, name) | `5zhs-2jue` | `https://data.cityofnewyork.us/resource/5zhs-2jue.json` |
| PLUTO (numfloors, yearbuilt, ownername, address, bbl) | `64uk-42ks` | `https://data.cityofnewyork.us/resource/64uk-42ks.json` |

Scoped to Manhattan per the M3 DoD ("switching to NYC identifies Manhattan
buildings"): Building Footprints filtered with `within_box(the_geom, ...)`
on a Manhattan bounding box (140,250 rows); PLUTO filtered with `borough=MN`
(42,544 rows). Found via the Socrata catalog API
(`api.us.socrata.com/api/catalog/v1?domains=data.cityofnewyork.us&q=...`)
rather than guessing dataset ids from search results, since NYC Open Data
has several similarly-named building/PLUTO datasets (PLUTO Change File,
MapPLUTO, BUILDING_HISTORIC, ...) and the wrong one silently gives an
incomplete or stale join.

Join key: Building Footprints' `mappluto_bbl` (10-digit string) equals
`str(int(float(pluto.bbl)))` — PLUTO's `bbl` comes back from the API as a
numeric string with trailing decimals (`"1015590019.00000000"`).

Unlike Seattle, height is real (LiDAR-derived `height_roof`, not a
floors×3.5 estimate) and owner is real (PLUTO's `ownername` isn't redacted).
`name` is populated for ~0.8% of footprints and is generally high quality
(landmarks, named buildings) with a small amount of junk (bare numbers,
short codes) filtered out — see `_is_bad_name` in `cities/nyc.py`.

