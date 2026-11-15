# DRIVEWIZE — CORONADO OFFICIAL BOUNDARY SETUP

**Repository:** `backend_rydu`  
**Database checked:** `localhost:5432` from this environment's `DATABASE_URL`  
**Production enforcement was not turned on.**

| Step | Result |
| --- | --- |
| BOUNDARY DOWNLOADED | Yes |
| BOUNDARY VALIDATED | Yes |
| DRAFT LOADED | Yes, on `localhost:5432` only |
| PRODUCTION ACTIVATED | No |

## Official source

Layer: U.S. Census Bureau TIGERweb, Incorporated Places, MapServer layer 4.

https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4

The query in the request used `NAME='Coronado'`. That query returns **0 features**. On this layer the legal name is `Coronado city`. The download used the same layer and the same service, with:

`STATE='06' AND NAME='Coronado city'`

Encoded request that returned the feature:

https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4/query?where=STATE%3D%2706%27%20AND%20NAME%3D%27Coronado%20city%27&outFields=*&returnGeometry=true&outSR=4326&f=geojson

Source label stored with the draft: `U.S. Census Bureau TIGERweb — Incorporated Places`.

No other boundary source was used.

## Download result

HTTP 200, content type `application/geo+json;charset=UTF-8`.

Retrieved at `2026-10-18T09:05:17.279Z`.

The body is a FeatureCollection. Exactly one feature matched.

| Field | Value |
| --- | --- |
| NAME | Coronado city |
| BASENAME | Coronado |
| STATE | 06 |
| PLACE | 16378 |
| GEOID | 0616378 |
| LSADC | 25 (city) |
| FUNCSTAT | A (active) |
| AREALAND | 20,999,378 square meters |
| AREAWATER | 15,500,854 square meters |

## Boundary file

- `data/service-areas/coronado.geojson` — the Census feature, geometry unchanged
- `data/service-areas/coronado.source.json` — source URL, attributes, and validation summary

Download script: `src/scripts/fetch-coronado-boundary.ts`.

## Geometry validation

`validateServiceAreaGeometry` accepted the feature.

| Check | Result |
| --- | --- |
| Type | Polygon |
| Axis order | GeoJSON longitude, latitude |
| Rings | 1 exterior ring, closed (first vertex equals last) |
| Holes | 0 |
| Vertices | 687 |
| Self-intersections | None reported |
| Coordinate ranges | Inside longitude/latitude limits |
| Empty geometry | No |

Bounding box from the file: west `-117.227227`, south `32.585592`, east `-117.114876`, north `32.714628`.

The Census interior point on the feature (`INTPTLAT` / `INTPTLON`) falls inside the polygon. A point two degrees west of that interior point falls outside. The polygon was not simplified or edited.

## Boundary exclusions and uncertainties

The official geometry was not modified.

- Water is included. Census reports 15,500,854 square meters of water against 20,999,378 square meters of land, about 42 percent of the place area. There is no hole cut out of the ring for that water.
- There are no detached polygons. The type is a single Polygon, not a MultiPolygon.
- Naval and other federal land is not a separate attribute and is not a hole. This file is the incorporated-place limit. It does not say whether a naval installation should be excluded from taxi coverage. That is still a coverage decision, not something this setup changed.

## Migration status

`0035_service_areas` is applied on `localhost:5432`. The Drizzle migration hash of `src/db/migrations/0035_service_areas.sql` is present in `drizzle.__drizzle_migrations`, and `service_areas` exists.

No second table was created.

## Draft database load

Loaded with the existing script, without `--activate`:

```text
npx tsx src/scripts/activate-service-area.ts --file data/service-areas/coronado.geojson --market US --code coronado --name Coronado --source-label "U.S. Census Bureau TIGERweb — Incorporated Places" --source-url "<encoded Census query above>"
```

Row read back from `localhost:5432`:

| Column | Value |
| --- | --- |
| id | `fd346367-9550-4d15-8a9b-adc169968848` |
| market_code | US |
| code | coronado |
| name | Coronado |
| version | 1 |
| status | draft |
| policy | pickup_and_dropoff |
| enforcement_enabled | false |
| approved_at | null |
| geometry type | Polygon |
| source_label | U.S. Census Bureau TIGERweb — Incorporated Places |

Bangladesh behavior was not changed. The passenger config still hides drafts, so this row is not returned as active coverage.

## Activation readiness

Not activated. Client approval of this exact municipal polygon, including its water area, is still required. This row is on the local database, not a confirmed production host.

When that approval is explicit for this database, promote the existing draft without inserting a second copy:

```text
npx tsx src/scripts/activate-service-area.ts --activate --id fd346367-9550-4d15-8a9b-adc169968848
```

That calls the existing `activateServiceArea` function. It sets this version active, records `approved_at`, and turns enforcement on. Do not run it until the target database and this coverage are both approved.

## Tests and build

Isolated tests used the downloaded file in memory. They did not activate the database row.

`npx jest` for `tests/coronado-official-boundary.test.ts`, `tests/service-area.geofencing.test.ts`, `tests/service-area.market-resolution.test.ts`, and `tests/service-area.dispatch.test.ts`: **32 passed**.

Covered with the official polygon in memory: Census interior point permitted; pickup, drop-off, and stop outside rejected; Bangladesh unrestricted; a US driver point outside the polygon is `OUTSIDE_SERVICE_AREA`; an in-progress status is unchanged; the passenger config returns the polygon only when that in-memory row is enforced.

`npx tsc --noEmit` completed with exit code 0.

## Remaining blocker

Enforcement stays off until someone explicitly runs the activate command above against the intended database after approving this Census municipal boundary, including the water it contains.

**BOUNDARY DOWNLOADED. BOUNDARY VALIDATED. DRAFT LOADED. PRODUCTION NOT ACTIVATED.**
