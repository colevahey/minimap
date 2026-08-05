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

