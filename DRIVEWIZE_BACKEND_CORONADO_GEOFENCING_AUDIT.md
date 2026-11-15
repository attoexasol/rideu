# DRIVEWIZE BACKEND — CORONADO GEOFENCING AUDIT

**Repository:** `backend_rydu`  
**Scope:** read-only audit of booking, dispatch, driver location, and configuration. No schema, routes, migrations, or configuration were changed.  
**Status: CORONADO GEOFENCING BACKEND AUDITED — CLIENT POLICY AND IMPLEMENTATION PLAN REQUIRED**

The backend can quote and book a ride anywhere Google can route, as long as the pickup country resolves to an active ride market. There is no Coronado polygon, no service-area table, and no point-in-polygon check. Airport matching is a separate radius used only for fees.

No policy is selected in this audit. Pickup-and-dropoff, pickup-only, and Coronado-plus-approved-airport remain open until the client confirms one.

---

## 1. Existing geographic and booking architecture

Passenger HTTP routes mount at `/api/v1/passenger` (`src/routes/v1/index.ts`, `src/index.ts`). Driver GPS over HTTP mounts at `/api/locations`. Socket.IO location and duty events are separate from those routes.

| Flow | Entry | Authority |
| --- | --- | --- |
| Ride quote | `POST /api/v1/passenger/bookings/quote` → `quoteHandler` | `createBookingQuote` or `quoteAllServiceCategories` |
| Immediate booking | `POST /api/v1/passenger/bookings` → `confirmBooking` | Same quote path, then insert |
| Scheduled booking | Same `POST /bookings` with `schedulingType: "scheduled"` | Inserted as `scheduled`. No dispatcher promotes it |
| Route preview | `POST /api/v1/passenger/routes/preview` | Google Routes only |
| Nearby drivers | `GET /api/v1/passenger/drivers/nearby` | Haversine radius around the query pin |
| Dispatch | `startDispatch` | Online drivers inside `DISPATCH_RADIUS_KM` of pickup |
| Driver GPS | `POST /api/locations` and socket `location:update` | Redis `location:driver:{id}` plus `locations` rows |
| Duty / online | `POST` duty start and socket `driver:status` | Fleet, vehicle, and duty session. No coordinates |

### Quote and create

`quoteHandler` and `createBookingHandler` live in `src/controllers/passengerBooking.controller.ts`.

`confirmBooking` (`src/services/booking.service.ts`) always calls `createBookingQuote`, which calls `quoteSingleCategory`. Both quote functions share `resolveQuoteContext` in `src/services/fare.service.ts`:

1. `resolveRideMarket` — pickup country from Google Place Details, then reverse geocode, then a client country code only if Google returned nothing (`src/services/rideMarket.service.ts`).
2. `assertMarketPricingConfigured` — the market must have fares for a bookable category.
3. `previewRoute` — Google Routes API v2 (`src/services/route.service.ts`, `src/services/googleMaps/googleMaps.client.ts`).
4. `detectAirportTrip` — radius match for an airport fee (`src/services/airportDetection.service.ts`).

`ride_markets` is one row per country (`src/db/schema/ride_markets.ts`). Currency is `BDT` or `USD`. A pickup whose country is `US` is the entire United States market. It is not a city boundary.

Unsupported country returns `400 UNSUPPORTED_MARKET`. Missing US (or BD) fares return `409 MARKET_PRICING_NOT_CONFIGURED`. Both are `PaymentError` subclasses in `src/services/payment.errors.ts`. Quote and create already map that class through `sendError`.

### What gets stored

`bookings` (`src/db/schema/bookings.ts`) stores pickup and drop-off as separate `numeric(10,8)` / `numeric(11,8)` latitude and longitude columns, plus address, optional Place ID, country code, `market_code`, airport fee snapshot, and `route_encoded_polyline`. Up to three intermediate stops go to `booking_stops` with the same lat/lng columns (`src/db/schema/booking_stops.ts`).

There is no service-area id on the booking.

Cash instant bookings insert as `searching` and call `startDispatch`. Card instant bookings insert as `quoted` and dispatch only after payment authorization (`src/services/cardBookingActivation.service.ts`). Scheduled bookings, cash or card, insert as `scheduled` and `shouldStartDispatchOnBookingCreate` returns false. Card authorization leaves a `scheduled` row scheduled. Nothing in `src/` later selects due `scheduled_pickup_at` rows and starts dispatch.

`createBookingSchema` (`src/validators/index.ts`) requires a future `scheduledPickupAt` and coordinates in `-90..90` / `-180..180`. There is no passenger update or reschedule route. `updateBooking` is an internal repository write used by status changes, not by the passenger editing pickup or drop-off.

Idempotency: a repeated `Idempotency-Key` returns the existing booking and does not re-quote.

### Dispatch

`startDispatch` (`src/services/dispatch.service.ts`) loads pickup lat/lng from the booking and calls `findNearbyDriversForCategory`. Each active Redis driver is passed through `checkDriverEligibility` (`src/services/driverAvailability.service.ts`). Eligible drivers are sorted by haversine distance. Batches retry from an in-process `setTimeout` (`scheduleDispatchRetry` → `startDispatch`). Those timers do not survive a process restart.

Eligibility today, in order:

- account not deactivated
- no active booking (`DRIVER_BUSY`)
- no pending vehicle exchange and no acceptance lock
- Redis status, else `drivers.status`, must be `online`
- when `QR_DUTY_REQUIRED` is on: active duty session and active vehicle assignment
- approved vehicle from the active assignment, else legacy `drivers.vehicle_id`
- driver serves the booking’s service category (`src/services/vehicleEligibility.service.ts`)
- Redis location present, numeric, inside lat/lng range
- heartbeat or location timestamp newer than `DRIVER_LOCATION_STALE_SECONDS` (default 120)
- haversine distance to pickup ≤ `DISPATCH_RADIUS_KM` (default 15)

`src/config/dispatch.ts` holds those two numbers. Fleet assignment (`src/services/duty.service.ts`, `src/routes/v1/admin/fleet.ts`) has no geographic rule.

### Driver location

`POST /api/locations` (`src/routes/locations.ts`):

- rejects a timestamp older than stale-seconds plus 30
- writes `locations` only after a 10 m move; accuracy is stored on that row when sent
- always refreshes Redis location and heartbeat
- Redis payload is raw latitude/longitude plus optional Mapbox snapped coordinates for the admin map
- accuracy is not copied into Redis
- may set the driver `online` when duty rules allow and the driver is not `busy`

Socket `location:update` (`src/websocket/handlers/location.ts`):

- rejects missing or out-of-range coordinates
- drops the event when `accuracy > 20` and does not refresh Redis
- drops the event when the driver has moved under 50 m since the last **database** point, and does not refresh Redis
- otherwise writes `locations` and Redis the same way, still without accuracy
- if the driver has an active booking, emits `driver:location` to that passenger with raw GPS

Dispatch reads Redis latitude/longitude, not the snapped point and not the `locations.accuracy` column. `isLocationFresh` treats heartbeat **or** location timestamp as fresh, so a heartbeat can keep a driver eligible after the coordinate itself is old.

Socket `driver:status` online (`src/websocket/handlers/driver-status.ts`) and `startDuty` (`src/services/duty.service.ts`) set status to `online` with no GPS argument.

### Maps

Passenger places, details, reverse geocode, pickup spots, and routes use Google (`src/services/googleMaps/`). Autocomplete can filter with `components=country:{code}` and bias around a point with a 50 km radius. That bias is not a fence. Default region and country in `src/config/googleMaps.ts` are `BD` unless `GOOGLE_MAPS_REGION` and `GOOGLE_MAPS_DEFAULT_COUNTRY` are set.

Admin road snapping uses Mapbox Matching (`src/services/mapboxMatching.ts`). Matched geometry is `[longitude, latitude]`. Passenger tracking stays on raw GPS.

### Admin configuration that exists

| Surface | What it configures | Geographic? |
| --- | --- | --- |
| `GET/PATCH /api/v1/admin/settings/settlement` | One active commission split, versioned | No |
| `GET/POST/PATCH /api/v1/admin/airports` | Airport code, center, radius meters, fees | Radius only |
| `GET/PUT /api/v1/admin/markets/:code/fares` | Per-country category fares | Country only |
| `GET /api/v1/config/payments` | Passenger payment flags | No |

Admin routes use `requireAdmin`: Auth0 `admin` or `super_admin` (`src/middleware/rbac.ts`). There is no service-area permission and no polygon editor.

### Error shape

`sendError` (`src/utils/response.ts`) returns:

```json
{ "success": false, "error": { "code": "STRING_CODE", "message": "Human text", "details": {} } }
```

Validation failures use `sendValidationError`. Quote maps `PaymentError` to that shape and otherwise maps Google failures. Create maps `PaymentError`, then any other exception to `400` with `ACTIVE_BOOKING_EXISTS` or `BOOKING_CREATION_FAILED`.

---

## 2. Current geofencing support

**City or service-area geofencing does not exist.**

What does exist:

- **Airport radius.** `airports.geofence_type` allows `'radius'` or `'polygon'`. `geofence_polygon` is `jsonb` and unused. Admin create always writes `geofence_type: 'radius'` (`src/services/airportAdmin.service.ts`). `pointMatchesAirport` ignores polygon rows: a point matches only when haversine distance to the center is `<= radiusMeters`, with Place ID as an extra positive signal. The boundary of that circle is inside. This classifies an airport fee. It does not accept or reject the ride.
- **Country market.** Pickup must resolve to an active `ride_markets` country. Drop-off country is not checked.
- **Dispatch radius.** A circle around the pickup, default 15 km, not around Coronado.
- **Coordinate range checks** on passenger schemas and the location socket.
- **Haversine** in `src/utils/geo.ts`. No point-in-polygon helper.

`package.json` has no Turf, no other GIS package, and no PostGIS client. Migrations through `0034_driver_documents` never run `CREATE EXTENSION postgis`. Drizzle columns are `numeric` and `jsonb`, not geometry.

The word `geofence` in fare tests refers to this airport radius match (`matchedBy: 'geofence'`), not a service area.

---

## 3. Exact files that would need changes

No file was modified for this audit. A later implementation would touch these, and only these, unless the client adds a scheduler or an admin editor.

| File | Why |
| --- | --- |
| `src/services/fare.service.ts` `resolveQuoteContext` | Single choke point for quote and create, before `previewRoute` |
| `src/controllers/passengerBooking.controller.ts` | `quoteHandler`, `createBookingHandler`, `routePreviewHandler`, `nearbyDriversHandler` |
| `src/services/driverAvailability.service.ts` | `checkDriverEligibility` and `diagnoseDriverEligibility` |
| `src/services/dispatch.service.ts` | No new offer path if eligibility already fails; logging only if a distinct reason is added |
| `src/services/payment.errors.ts` or a sibling error module | `OUT_OF_SERVICE_AREA` / `SERVICE_AREA_UNAVAILABLE` using the existing `sendError` shape |
| `src/db/schema/` plus the next migration after `0034` | Service-area rows. Optional booking snapshot columns |
| `src/routes/v1/config/index.ts` | Read-only boundary for Flutter. This route does not exist yet; do not add it until implementation |
| `src/config/redis.ts` | Only if accuracy must be available at dispatch time. It is not stored today |

Leave unchanged:

- `src/routes/locations.ts` and `src/websocket/handlers/location.ts` — live tracking, including `driver:location` on an active ride
- `src/services/duty.service.ts` and socket online/offline — no GPS at go-online today
- `src/services/airportDetection.service.ts` — fee classification, not the city fence
- `src/services/booking.service.ts` cancel, accept, arrive, start, complete
- Fleet assignment and vehicle exchange

`confirmBooking` does not need its own geometry check if `createBookingQuote` already fails. Card activation and dispatch retry call `startDispatch`, which re-reads eligibility, so a driver check in `checkDriverEligibility` covers the first batch and later batches.

There is no second booking-create route. Admin booking routes serve video and service-category assignment, not ride creation.

---

## 4. Proposed service-area configuration

Add a versioned `service_areas` table. Do not store the city fence on `airports`. That table is a fee radius, and its unused polygon column is the wrong place for an operating zone.

Follow the `settlement_settings` pattern: explicit `version`, rows that stay after replacement, one operational generation at a time. Allow more than one **active** row later so a second zone can exist without a rewrite. For launch, enforcement loads every active row and treats the ride as inside if the required points fall in any of them.

Suggested columns:

| Column | Role |
| --- | --- |
| `id` | UUID |
| `code` | Stable slug such as `coronado`. Not unique by itself |
| `name` | Display name |
| `version` | Integer, unique together with `code` |
| `status` | `draft`, `active`, or `retired` |
| `geometry` | `jsonb` GeoJSON `Polygon` or `MultiPolygon` only |
| `policy` | One of the three policies below. Null until the client confirms |
| `enforcement_enabled` | Separate from “a draft polygon exists” |
| `source_label`, `source_url` | Where the rings came from |
| `approved_at` | Null until written approval |
| `created_at`, `updated_at` | Audit |

GeoJSON rules:

- Coordinates are `[longitude, latitude]` (RFC 7946). Passenger request bodies stay `{ latitude, longitude }`. Do not mix the two orders in one helper.
- `Polygon`: ring 0 is the exterior; later rings are holes.
- `MultiPolygon`: disjoint land areas, each allowed to have holes.
- A point on the boundary is **inside**.
- Inclusion uses the even-odd rule so a census ring that is clockwise still works.
- Reject on write: any type other than Polygon/MultiPolygon, unclosed rings, fewer than 4 positions, non-finite numbers, empty coordinates, and self-intersections.

Runtime check is application code, not PostGIS. The database in this repo has no geometry type, and enabling PostGIS is a hosting change this launch does not need. A small maintained point-in-polygon library that already implements Polygon, MultiPolygon, and holes (Turf `boolean-point-in-polygon` or an equivalent) is enough. Keep it behind one function, for example `pointInServiceArea(lat, lng, geometry)`, so booking code never parses rings itself.

Cache the active rows in memory with the version as the cache key. A restart then reloads the database row. Do not read the polygon from an environment variable.

Optional booking columns, `service_area_id` and `service_area_version`, snapshot which generation accepted the ride. They are for audit and for “do not re-judge this ride.” They are not a second copy of the rings.

**Do not insert a Coronado rectangle, circle, or guessed shoreline in the migration.** The first migration creates the table only. A later controlled script inserts a `draft` row after the GeoJSON file is approved. `enforcement_enabled` stays false until that row is promoted to `active`.

Policy values, stored on the active generation so booking code does not branch on city names:

| Code | Meaning | Not chosen |
| --- | --- | --- |
| `pickup_and_dropoff` | Pickup, drop-off, and every stop must be inside | Option A |
| `pickup_only` | Pickup must be inside. Drop-off and stops may be outside | Option B |
| `pickup_with_approved_exceptions` | Pickup inside, or a defined exception such as an approved airport at one end and Coronado at the other | Option C |

Option C should call the existing `detectAirportTrip` for the exception end. It should not inflate the city polygon across the bay to cover an airport radius. Airport fee and service permission stay separate decisions.

---

## 5. Recommended GeoJSON source and approval

This audit does not contain a Coronado boundary and does not choose one.

Use an official polygon, exported as RFC 7946 GeoJSON, then reviewed by the client before it can become `active`.

Practical source order:

1. The City of Coronado or San Diego County / SANDAG open-data municipal boundary, if the client’s operating zone is the city limit.
2. US Census Bureau TIGER/Line **Place** boundary for the City of Coronado, California, if a county extract is not available. Same rule: it is a candidate, not an automatic go-live file.
3. A client-supplied GeoJSON only when they intentionally want a subset or a superset of that legal boundary (for example a drawn coverage zone).

Before activation, a person compares the rings to the approved coverage and records `source_label`, `source_url`, and `approved_at`. Invalid or unapproved geometry cannot be the active row.

Questions the source file cannot answer by itself, so they stay in section 13:

- Is coverage the municipal limit, or a smaller operating zone?
- Are naval, port, or other restricted land areas holes?
- Are water polygons excluded?
- Are detached areas (strand, cays, or similar) included?
- Is San Diego International, or any other airport outside the city polygon, an explicit exception rather than part of the city ring?

San Diego International is across the bay from Coronado. Putting it inside the city polygon would also cover unrelated nearby points. If airport trips are allowed, model them as policy option C plus an existing or new **airport** record, after the client names the airport.

---

## 6. Quote and booking enforcement points

The backend stays authoritative. Flutter checks are hints. A client can post any coordinates that pass the lat/lng range schema.

Run one function, `assertRidePermitted(pickup, dropoff, stops)`, from `resolveQuoteContext` **before** `previewRoute`, so an outside trip does not spend a Google Routes call. `quoteSingleCategory` and `quoteAllServiceCategories` then both enforce it, and `confirmBooking` inherits it.

| Point | Enforce? | Notes |
| --- | --- | --- |
| `POST /bookings/quote` | Yes | First passenger-visible decision. Include which point failed |
| `POST /bookings` instant | Yes | Same function. Cash then dispatches only if the insert succeeds |
| `POST /bookings` scheduled | Yes, at create | The row is stored and not dispatched today. Re-check at the future dispatch start |
| `POST /routes/preview` | Yes, same function | Otherwise the map draws a route the quote will reject |
| `GET /drivers/nearby` | Yes, on the query pin | An outside pin should not return drivers as if the zone is open |
| Intermediate `stops` (max 3) | Follow the policy | Under option A they are inside. Under option B they are not required to be |
| Passenger update / reschedule | No route exists | When one is added, it must call the same function |
| Idempotent replay | No second check | Return the booking already stored |
| After accept, arrive, start, complete | No | Do not re-test the trip because the driver moved or the polygon changed |
| Admin | No create-booking API | N/A |

Suggested error, `400`, matching `UNSUPPORTED_MARKET`:

```json
{
  "success": false,
  "error": {
    "code": "OUT_OF_SERVICE_AREA",
    "message": "This ride is outside the current service area.",
    "details": {
      "serviceAreaVersion": 1,
      "policy": "pickup_and_dropoff",
      "failedPoints": ["dropoff"]
    }
  }
}
```

`failedPoints` contains only the roles that failed: `pickup`, `dropoff`, `stop`. Do not echo a guessed city name as the reason.

If enforcement is on and there is no active approved geometry, fail closed for **new** quotes and creates:

`503 SERVICE_AREA_UNAVAILABLE` — do not treat a missing file as “anywhere is allowed,” and do not cancel rides already in progress.

While `enforcement_enabled` is false, quote and create behave exactly as they do now. That is the launch switch.

Scheduled rides that are already stored, then fail a later dispatch-time check, need a client rule (section 13). Do not silently delete them and do not start dispatch.

---

## 7. Driver dispatch enforcement points

Add the zone test inside `checkDriverEligibility`, after the location is present, numeric, and fresh, and beside the existing radius test. `diagnoseDriverEligibility` gets a distinct reason such as `OUTSIDE_SERVICE_AREA` so logs are not confused with `OUTSIDE_DISPATCH_RADIUS`.

A driver receives a **new** offer only when all of the following are true:

- existing duty, online, vehicle, and category rules
- Redis latitude/longitude (raw GPS, not the Mapbox snapped point)
- location freshness using the current `isLocationFresh` rule (default 120 seconds)
- if accuracy is present on that Redis payload and worse than a configured meter limit, treat the fix as unusable for a **new** offer
- missing accuracy stays eligible, because HTTP and many socket updates do not provide a reliable accuracy value today
- the coordinate is inside the active service-area geometry
- still inside the existing pickup radius

Accuracy is stored on `locations.accuracy` and is not in Redis. Using it at dispatch means copying it into `setDriverLocation` in both the HTTP and socket writers. That is a small change to the cache payload, not a change to passenger tracking.

Do **not** run this test in the location handlers. An active ride keeps emitting `driver:location` after the driver leaves the zone. Do not cancel, complete, or reassign that ride because of the fence.

Go-online and duty start do not receive coordinates. Blocking them would require a new contract and would reject a driver who is about to enter the zone. **Dispatch time is the enforcement point.** Going online outside Coronado can stay allowed; that driver simply gets no new offers until a fresh fix is inside the polygon and inside the pickup radius. A later, optional warning on the driver app can use the last Redis fix. It is not a second security boundary.

Each dispatch batch already re-reads eligibility, including retries after offer expiry. The zone check rides along. In-process retry timers are lost on restart; that is existing behavior. The polygon itself must come from the database on startup, not from a timer.

GPS spoofing is not solvable here. The server ignores any client “I am inside” flag and evaluates only the coordinates it stored.

---

## 8. Passenger API requirements

Flutter needs the current rings without an app release, and it needs the quote/create errors above. Existing booking reads (`GET /bookings/active`, `GET /bookings/:id`) should not change.

There is no public geometry endpoint. `GET /api/v1/config/payments` is the only config read, and it is passenger-authenticated. The smallest later addition is a sibling read, for example `GET /api/v1/config/service-area`, same auth as payments:

```json
{
  "success": true,
  "data": {
    "enforcementEnabled": true,
    "version": 1,
    "code": "coronado",
    "name": "Coronado",
    "policy": "pickup_and_dropoff",
    "geometry": { "type": "Polygon", "coordinates": [] }
  }
}
```

`geometry` is GeoJSON, longitude then latitude. `version` lets the app drop a cached copy when the boundary changes. When enforcement is off, return `enforcementEnabled: false` and omit rings rather than inventing a shape.

Quote success should add a small echo, not a second copy of the rings:

```json
"serviceArea": { "code": "coronado", "version": 1, "policy": "pickup_and_dropoff" }
```

`OUT_OF_SERVICE_AREA` on quote and create is the permission decision. The GET is only for drawing. Places autocomplete stays country-biased; it will still suggest addresses outside the polygon, and quote will reject them.

Do not add this route in the audit phase.

---

## 9. Admin requirements

First release: **controlled server-side GeoJSON**, not an admin map editor.

Reasons:

- Admin settings today edit two settlement percentages. Airport admin edits a center and a radius. Neither path validates polygon topology.
- A bad ring would start rejecting every Coronado trip, or accepting the wrong ones, as soon as it is saved.
- The legal boundary is a one-time approval, not a daily edit.
- `requireAdmin` would expose a drawing tool to every admin and super-admin with no geometry review step.

Operational path:

1. Migration creates the empty table.
2. Approved GeoJSON is inserted as `draft` by a reviewed script or migration. No coordinates in application source.
3. Promotion to `active` with `enforcement_enabled` is a deliberate second step after a staging quote inside and outside the ring.
4. Replacing the boundary inserts version N+1 and retires N. In-progress bookings keep their snapshot and are not rechecked.

An admin editor can wait until the validator, the version rules, and the “do not touch active rides” behavior have already shipped.

---

## 10. Database migration needs

One new migration after `0034_driver_documents`. It creates `service_areas` only.

It does **not**:

- enable PostGIS
- seed Coronado coordinates
- alter `airports`
- change dispatch radius defaults
- rewrite existing bookings

Optional nullable columns on `bookings`: `service_area_id`, `service_area_version`. Safe to add as nullable. Existing rows stay null and keep their current behavior.

No index on coordinates is required for launch. The active polygon set is one or a few documents, evaluated in process. A partial index on `status` / active rows is enough.

---

## 11. Risks and edge cases

| Case | Safe behavior |
| --- | --- |
| GPS spoofing | Backend uses stored coordinates only. Freshness and, when present, accuracy limit new offers. No claim of anti-spoof proof |
| Stale driver location | Existing `LOCATION_STALE` already blocks new offers. Geofence runs only on a fresh fix |
| Socket skips accuracy > 20 m or movement < 50 m without refreshing Redis | A stationary socket-only driver can look stale even while the app is sending points. Dispatch already depends on this cache. Do not add a second location source for the fence |
| HTTP accepts poor accuracy | Accuracy is not in Redis today. Once it is copied, a fix worse than the configured limit does not receive a new offer. The last good fix remains until it is stale |
| Swapped lat/lng | Passenger bodies are named fields. GeoJSON for the boundary is `[lng, lat]`. A swap that puts longitude into latitude fails the existing `-90..90` check in this region. Still validate GeoJSON axis order on import |
| Missing coordinates | Schema already rejects passenger quote/create. Dispatch already returns `LOCATION_STALE` |
| Point on the ring | Inside |
| Holes | Inside a hole is outside the service area |
| MultiPolygon | Inside any polygon, and not in that polygon’s holes, is inside |
| Ocean or restricted land | Only excluded if the approved GeoJSON has those rings as holes or omits them. Do not approximate with a rectangle |
| Scheduled create | Reject at create if the points fail the current policy |
| Scheduled later dispatch | There is no scheduler now. When one is added, re-check before `startDispatch`. If it fails, do not dispatch and do not cancel other rides |
| Process restart | Reload active geometry from the database. Existing in-memory dispatch timers already reset; that is unrelated to the polygon |
| Missing geometry while enforcement is on | `503` for new quotes and creates. Active rides continue |
| Enforcement flag off | No geographic change to current behavior |
| Boundary edited during a live ride | Do not cancel, re-quote, or reassign. New quotes use the new version |
| Boundary edited under a stored scheduled ride | Re-check only when dispatch is eventually started |
| Concurrent quote and dispatch | Quote checks the passenger points. Dispatch checks the driver point. They do not share a lock. Idempotent create returns the first booking |
| Airport radius overlap | Fee detection can still match an airport outside the city. That must not by itself authorize the trip unless policy C says so |
| Google default country `BD` | Autocomplete bias is not the fence. Coronado launch still needs `GOOGLE_MAPS_DEFAULT_COUNTRY` / region set to `US` or requests will be a poor passenger experience. That env change is separate from this polygon |
| Active ride leaves the zone | Keep tracking and the existing status machine |

---

## 12. Minimal phased implementation plan

**Phase 0 — this audit.** No code. Client confirms policy, boundary source, holes, and airport exceptions.

**Phase 1 — data and pure check, enforcement off.**

- Table and GeoJSON validator.
- `pointInServiceArea` with tests: inside, outside, boundary, hole, MultiPolygon, invalid rings, axis order.
- No Coronado coordinates in the repo.
- `enforcement_enabled` default false.

**Phase 2 — enforce new passenger trips only, after an approved active row exists.**

- `assertRidePermitted` in `resolveQuoteContext` and route preview.
- Nearby drivers respect the query pin.
- `OUT_OF_SERVICE_AREA` and fail-closed `SERVICE_AREA_UNAVAILABLE`.
- `GET /api/v1/config/service-area`.
- Quote payload includes `serviceArea.version`.
- Booking snapshot columns.

**Phase 3 — new offers only.**

- Zone check in `checkDriverEligibility`.
- Persist accuracy on the Redis location if the client wants an accuracy cutoff.
- Do not modify location broadcast or active-ride status transitions.

**Phase 4 — only if operations need it.** Admin promotion of a new version, still without a freehand map editor. A scheduler for `scheduled` bookings must call the same assert immediately before `startDispatch`.

Out of scope for all phases: cancelling an active ride that leaves the polygon, snapping passenger tracking to Mapbox, and replacing `ride_markets` or airport fees with this table.

---

## 13. Business decisions requiring client confirmation

1. **Policy.** A: pickup and drop-off (and stops) inside. B: pickup inside, drop-off outside allowed. C: Coronado plus named airport exceptions. The implementation stores the choice; it does not pick one.
2. **Stops.** Under A, are all intermediate stops required to be inside? Under B, are they unrestricted?
3. **Boundary file.** Municipal limit, Census place boundary, or a custom coverage drawing. Who signs `approved_at`?
4. **Holes and exclusions.** Naval or other restricted land, open water, and any detached areas.
5. **Airports.** If C, which airport codes, and must one end remain inside Coronado? Fee rules stay on `airports` either way.
6. **Drivers outside the zone.** Confirm they may go online and simply receive no new offers until they are inside. Confirm an active trip is never cancelled for leaving the zone.
7. **Accuracy cutoff** for new offers when the device reports accuracy, and the behavior when accuracy is omitted (recommended: omit stays eligible).
8. **Scheduled rides** already saved if the boundary later moves and excludes them: hold without dispatch, or cancel with a defined reason. There is no scheduled dispatcher in the backend today.
9. **Fail-closed confirmation.** Enforcement on with no active polygon rejects new quotes (`503`) and leaves current rides alone.
10. **First admin surface.** Confirm launch uses a controlled GeoJSON load, not an in-panel editor.

Until those are answered and an approved polygon is loaded, production enforcement should stay off.

---

**FINAL STATUS: CORONADO GEOFENCING BACKEND AUDITED — CLIENT POLICY AND IMPLEMENTATION PLAN REQUIRED**
