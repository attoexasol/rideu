# DRIVEWIZE BACKEND — US / BD GEOFENCING IMPLEMENTATION REPORT

**Repository:** `backend_rydu`  
**Status: US CORONADO GEOFENCING IMPLEMENTED — BD UNRESTRICTED — BOUNDARY ACTIVATION AND DEVICE QA PENDING**

United States rides can be restricted to an approved polygon. Enforcement is off until that polygon is loaded and activated. Bangladesh rides are never polygon-restricted. No Coronado coordinates were added.

## Files changed

| Area | Files |
| --- | --- |
| Schema and migration | `src/db/schema/service_areas.ts`, `src/db/schema/index.ts`, `src/db/migrations/0035_service_areas.sql`, `src/db/migrations/meta/_journal.json` |
| Persistence and rules | `src/repositories/serviceArea.repository.ts`, `src/services/serviceArea.service.ts`, `src/services/payment.errors.ts` |
| Quote and booking | `src/services/fare.service.ts` (`resolveQuoteContext`, before Google Routes) |
| Passenger HTTP | `src/controllers/passengerBooking.controller.ts`, `src/routes/v1/config/index.ts`, `src/validators/index.ts` |
| Dispatch | `src/services/driverAvailability.service.ts`, `src/services/dispatch.service.ts` |
| Activation | `src/scripts/activate-service-area.ts` |
| Dependencies | `@turf/boolean-point-in-polygon`, `@turf/kinks`, `@turf/helpers` |
| Tests | `tests/service-area.geofencing.test.ts`, `tests/service-area.market-resolution.test.ts`, `tests/service-area.dispatch.test.ts` |

Existing fare tests mock `assertRidePermitted` so they keep testing fares without a service-area row: `tests/fare.service.test.ts`, `tests/usd-end-to-end-financial.test.ts`.

`airports` was not changed. PostGIS was not added. Location HTTP, Socket.IO tracking, and duty start were not changed.

## Migration

`0035_service_areas` creates `service_areas` and does not insert a boundary.

| Column | Role |
| --- | --- |
| `market_code` | `US`, `BD`, or a later market |
| `code` | Stable slug, such as `coronado` |
| `name` | Display name |
| `version` | Unique with market and code. Starts at 1 |
| `status` | `draft`, `active`, or `retired` |
| `geometry` | GeoJSON `Polygon` or `MultiPolygon`, `[longitude, latitude]` |
| `policy` | `pickup_and_dropoff` only |
| `enforcement_enabled` | Default `false` |
| `source_label`, `source_url`, `approved_at` | Approval metadata. Not returned to passengers |
| `created_at`, `updated_at` | Timestamps |

One active version is allowed per market and code. Activating a new version retires the previous active version of that same code and turns its enforcement off.

## US and BD policy

Market comes from the existing pickup resolution: Google Place Details, then reverse geocode, then a client country only if Google returned no country. A client hint never overrides a resolved Google country.

| Market | Behavior |
| --- | --- |
| `BD` | Polygon check is skipped even if a row exists. Bangladesh cannot be activated. Existing fare, duty, vehicle, category, and radius rules stay as they are |
| `US`, enforcement off or no row | Existing quote, booking, and dispatch behavior |
| `US`, enforcement on with an approved active polygon | Pickup, drop-off, and every stop must be inside. A new offer requires the driver's fresh raw GPS inside the same polygon, plus the existing eligibility and radius checks |
| Any other market | No polygon unless that market has its own active enforced row |

The passenger device location is not the market selector. Driver offers use `bookings.market_code`, not the phone country, locale, or the driver's current country.

## Geometry validation

`validateServiceAreaGeometry` accepts a Polygon, MultiPolygon, one Feature, or a one-feature FeatureCollection. It stores a bare Polygon or MultiPolygon.

Rejected input: any other type, open rings, rings shorter than 4 positions, non-finite numbers, latitude or longitude out of range, and self-intersections (`@turf/kinks`).

Point tests use `@turf/boolean-point-in-polygon` with the boundary included. Holes are outside. A point in any polygon of a MultiPolygon is inside.

## Booking and dispatch enforcement

`assertRidePermitted(marketCode, pickup, dropoff, stops)` runs inside `resolveQuoteContext` before `previewRoute`. Quote, immediate create, and scheduled create all go through that function. Idempotent replay still returns the stored booking before a new quote.

`POST /api/v1/passenger/routes/preview` resolves the market from the pickup, then applies the same rule, before Google Routes.

`GET /api/v1/passenger/drivers/nearby` resolves the market by reverse-geocoding the query pin. No client country is accepted. An outside US pin returns `OUT_OF_SERVICE_AREA`. Drivers returned for a US pin must themselves be inside the polygon.

`checkDriverEligibility` and `diagnoseDriverEligibility` take the booking market. Outside a US polygon the code is `OUTSIDE_SERVICE_AREA`. Missing usable geometry while enforcement is on returns `SERVICE_AREA_UNAVAILABLE` and creates no offer. The same check runs when a driver accepts an offer, so a driver who has already left cannot accept. A ride that is already accepted is not cancelled, and `driver:location` is unchanged. Duty start does not look at the polygon.

Active rows are cached in process for 10 seconds. The process that activates a row clears its own cache immediately.

## Passenger API contract

`GET /api/v1/config/service-area?lat={latitude}&lng={longitude}&placeId={optional}`

Passenger auth, same envelope as the other v1 routes. The market is resolved from those coordinates (and Place ID when present).

Bangladesh, or the US before activation:

```json
{
  "success": true,
  "data": {
    "marketCode": "BD",
    "enforcementEnabled": false,
    "areas": []
  }
}
```

United States after an approved row is active:

```json
{
  "success": true,
  "data": {
    "marketCode": "US",
    "enforcementEnabled": true,
    "areas": [
      {
        "code": "coronado",
        "name": "Coronado",
        "version": 1,
        "policy": "pickup_and_dropoff",
        "geometry": { "type": "Polygon", "coordinates": [] }
      }
    ]
  }
}
```

`geometry` is GeoJSON, longitude then latitude. Drafts and unapproved rows are not included. A new version appears on the next read, so the app does not need a release to pick up a boundary change. Source labels, source URLs, and approval timestamps are not included.

## Error responses

`400 OUT_OF_SERVICE_AREA`

`This ride is outside the current service area.`

`details.failedPoints` is a subset of `pickup`, `dropoff`, and `stop`.

`503 SERVICE_AREA_UNAVAILABLE`

`The service area is temporarily unavailable. Please try again later.`

Used when US enforcement is on but the active geometry is missing or invalid. No geometry or internal ids are included.

## Tests and build

Targeted Jest run, 32 tests, all passed:

- `tests/service-area.geofencing.test.ts`
- `tests/service-area.market-resolution.test.ts`
- `tests/service-area.dispatch.test.ts`
- `tests/fare.service.test.ts`

Covered: inside US allowed; outside drop-off, pickup, and stop rejected; BD unrestricted; BD dispatch unchanged; US driver outside gets no offer; US driver inside stays eligible; active-ride tracking and duty start do not reference the fence; missing geometry fails closed; enforcement off preserves current behavior; holes, MultiPolygon, boundary points, and invalid geometry; Google country wins over a conflicting client hint; route-preview and nearby-pin policy follow that market.

`npm run build` (`tsc`) completed with exit code 0.

Polygons in tests are synthetic squares. No production boundary was inserted.

## Boundary approval and activation

1. Obtain the approved Coronado GeoJSON (Polygon or MultiPolygon, RFC 7946). Do not substitute a rectangle or a guessed shoreline.
2. Apply migration `0035` if it is not already applied.
3. Load a draft (enforcement stays off):

```text
npx tsx src/scripts/activate-service-area.ts --file ./boundary.geojson --market US --code coronado --name "Coronado" --source-label "Approved city extract" --source-url "https://..."
```

4. After the file is approved, run the same command with `--activate`. That sets `status=active`, `enforcement_enabled=true`, and `approved_at`. Quote and dispatch then require every US point inside the polygon.
5. A replacement file is a new version. Activating it retires the previous active `coronado` version. Rides already accepted are not cancelled.

Bangladesh must not be passed to `--activate`. The script and service reject it.

## Deployment steps

1. Deploy migration `0035_service_areas` before the new process serves traffic. The table is empty, so US enforcement stays off and current US booking behavior continues.
2. Deploy this build.
3. Confirm `GET /api/v1/config/service-area` for a Bangladesh pin returns `enforcementEnabled: false` and an empty `areas` array.
4. Confirm the same for a Coronado pin before activation.
5. Activate only after the boundary file is approved.
6. Re-check a pin inside the polygon and a pin outside it.

## Remaining Flutter and driver app work

Passenger Flutter:

- Read `GET /api/v1/config/service-area` with the pickup latitude, longitude, and Place ID when the pickup changes. Cache by `areas[].version`.
- Draw `areas[].geometry` only when `enforcementEnabled` is true and `areas` is not empty. Do not ship a hardcoded Coronado ring.
- On `OUT_OF_SERVICE_AREA`, show the returned message and mark `details.failedPoints`.
- On `SERVICE_AREA_UNAVAILABLE`, show the returned message and do not treat the ride as quoted.
- Bangladesh responses have no polygon. Do not apply a US ring to those trips.

Driver app:

- No tracking or duty change is required. Going online outside Coronado stays allowed.
- A US offer is withheld until the fresh GPS fix is inside the active polygon. An active ride must keep its current map updates if the driver later leaves the zone.
- Device QA is still required for both apps after a real boundary is activated.

**FINAL STATUS: US CORONADO GEOFENCING IMPLEMENTED — BD UNRESTRICTED — BOUNDARY ACTIVATION AND DEVICE QA PENDING**
