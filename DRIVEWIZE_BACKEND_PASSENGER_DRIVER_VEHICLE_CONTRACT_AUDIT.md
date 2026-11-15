# DRIVEWIZE BACKEND — PASSENGER DRIVER & VEHICLE IDENTIFICATION CONTRACT AUDIT

**Repository:** `backend_rydu`  
**Scope:** read-only audit of the current passenger contract after driver acceptance.  
**Status: PASSENGER DRIVER & VEHICLE BACKEND CONTRACT AUDITED — IMPLEMENTATION DECISIONS REQUIRED**

No schema, routes, dispatch, authentication, or booking behavior was changed.

## Verdict

REST booking reads already return the **vehicle stored on the booking** (`bookings.assigned_vehicle_id`). They do not substitute the driver's current fleet vehicle.

The passenger `booking:accepted` socket payload does **not** use that column. It loads `drivers.vehicle_id`. Those two ids can differ. Color sources also differ.

An active booking cannot change vehicles. Vehicle exchange is rejected while either driver has an active ride, and exchange never updates `bookings.assigned_vehicle_id`.

Driver photo and vehicle year are stored and are not sent to the passenger. Driver rating and in-app messaging do not exist.

---

## 1. Actual REST routes and response fields

Passenger routes are mounted at `/api/v1/passenger` (`src/routes/v1/index.ts`, `src/index.ts`).

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| `GET` | `/api/v1/passenger/bookings/active` | passenger JWT + `passengerRecoveryRateLimit` | `activeBookingHandler` |
| `GET` | `/api/v1/passenger/bookings/:bookingId` | passenger JWT | `getBookingHandler` |

Both success bodies use `sendSuccess`: `{ "success": true, "data": <PassengerRideSnapshot> }`.

`GET /bookings/active` returns `"data": null` when the customer has no ongoing booking. Ongoing statuses are `quoted`, `searching`, `offered`, `scheduled`, `accepted`, `driver_en_route`, `arrived`, and `in_progress` (`PASSENGER_ONGOING_BOOKING_STATUSES`).

`GET /bookings/:bookingId` returns `404 NOT_FOUND` or `403 FORBIDDEN` when the booking is missing or belongs to another customer. It uses the same snapshot formatter as active and history: `formatPassengerRideSnapshot` in `src/services/rideHistory.service.ts`, loaded by `getBookingDetail` in `src/repositories/booking.repository.ts`.

The vehicle join is `vehicles` on `bookings.assigned_vehicle_id`. The driver join is `drivers` on `bookings.assigned_driver_id`.

### Snapshot fields the passenger actually receives

```text
data.id                         booking UUID
data.status
data.bookingNumber
data.pickup.latitude
data.pickup.longitude
data.pickup.address
data.pickup.spotLabel
data.dropoff.latitude
data.dropoff.longitude
data.dropoff.address
data.dropoff.placeId
data.driver                     null until a driver is assigned
data.driver.id
data.driver.name                drivers.name (single full-name column)
data.driver.phone               drivers.phone, nullable
data.driver.plateNumber         plate of the assigned vehicle, duplicated here
data.vehicle                    null when no assigned vehicle row and no color fallback
data.vehicle.id                 assigned vehicle id, or "" if only a color fallback exists
data.vehicle.make
data.vehicle.model
data.vehicle.color              vehicles.color, else drivers.vehicle_color
data.vehicle.plateNumber
data.route.encodedPolyline
data.route.distanceKm
data.route.durationMin          estimated trip duration, not driver ETA
data.createdAt / acceptedAt / arrivedAt / startedAt / completedAt / cancelledAt
```

Also present, and not part of this identification contract: `service`, `fare`, `payment`, `recording`, `schedulingType`, `searchStartedAt`, `cancelledBy`, `cancellationReason`.

### Fields absent from both REST responses

- `driver.profileImageUrl` / photo URL
- `driver.rating`
- `vehicle.year`
- `driverEtaMinutes` / `etaMinutes` (the column `bookings.driver_eta_minutes` is written at accept and is not mapped)
- driver latitude, longitude, heading, or speed

`POST /api/v1/passenger/bookings/quote` returns `driverEtaMinutes` per service category. That value is a pre-accept nearest-driver estimate from fare quoting. It is not the ETA of the driver who later accepts.

Driver profile `GET /api/v1/driver/profile` is driver-authenticated. Its `vehicleSummary` is the driver's **current active assignment**, not the booking's assigned vehicle. The passenger app must not use that route for the accepted ride.

---

## 2. Actual Socket.IO event names and payloads

Customer events are emitted to room `customer-{customerId}` (`src/services/bookingNotify.service.ts`).

### `booking:accepted`

Emitted once, after the accept transaction commits (`acceptBookingOffer` in `src/services/dispatch.service.ts`).

```json
{
  "bookingId": "<uuid>",
  "status": "driver_en_route",
  "driver": {
    "id": "<driver uuid>",
    "name": "<drivers.name>",
    "phone": "<drivers.phone or null>",
    "plateNumber": "<plate from drivers.vehicle_id, or null>"
  },
  "vehicle": {
    "id": "<drivers.vehicle_id>",
    "make": "<vehicles.make or drivers.vehicle_make>",
    "model": "<vehicles.model or drivers.vehicle_model>",
    "color": "<drivers.vehicle_color>",
    "plateNumber": "<vehicles.plate_number>"
  },
  "etaMinutes": 1
}
```

`vehicle` is `null` when `drivers.vehicle_id` is null, even if the booking row already has `assigned_vehicle_id`.

`color` is always `drivers.vehicle_color`. It is not `vehicles.color`.

`year` is not included. Photo and rating are not included. Pickup and drop-off are not included.

Admin `booking:accepted` is a different payload: `{ bookingId, driverId, status }` only.

### `booking:status`

Built by `emitBookingStatus`. Sent to the customer, the assigned driver when present, and admins.

```json
{
  "bookingId": "<uuid>",
  "status": "<new status>",
  "timestamp": "<ISO-8601>"
}
```

Driver status transitions (`arrived`, `in_progress`, `completed`) add no extra fields. They do not repeat driver, vehicle, ETA, or locations.

Cancel extras that do exist:

| Actor | Extra fields |
| --- | --- |
| Passenger cancel | `reason`, `reasonCode` |
| Driver cancel | `reason`, `cancelledBy: "driver"` |

### `driver:location`

Passenger live location. Two producers, same event name and the same field set:

1. Driver socket `location:update` in `src/websocket/handlers/location.ts` emits directly on the local Socket.IO server when `findActiveBookingByDriver` finds a ride.
2. Driver HTTP location ingest in `src/routes/locations.ts` calls `emitDriverLocationToCustomer`, which goes through the booking pub/sub path.

```json
{
  "driverId": "<uuid>",
  "bookingId": "<active booking uuid>",
  "latitude": 0,
  "longitude": 0,
  "heading": null,
  "speedKph": null,
  "accuracyMeters": null,
  "timestamp": "<ISO-8601>"
}
```

Passenger coordinates are the driver's raw GPS. Admin `location:broadcast` is a different event and may include Mapbox-snapped coordinates. There is no passenger REST location poll.

`speed` on the driver update is treated as m/s and multiplied by 3.6 for `speedKph`.

### Other passenger booking events (not identification payloads)

| Event | Payload |
| --- | --- |
| `booking:searching` | `{ bookingId, batch, status: "searching" }` |
| `booking:expired` | `{ bookingId, status: "no_drivers", reason: "no_drivers" }` |
| `recording:consent_updated` | consent fields |
| `recording:session_*` | ride-video session fields |
| `video:live-segment` | `{ bookingId, sessionId, segmentIndex, videoUrl, timestamp }` |

FCM ride pushes (`driver_en_route`, `arrived`, `in_progress`, `completed`, `cancelled`, `no_drivers`) carry `type`, `bookingId`, `event`, and sometimes `cancelledBy`. The notification body is the fixed string `Open the app to view ride details.` They are not a driver or vehicle payload.

---

## 3. Driver profile photo availability

**Stored. Not delivered on the passenger booking contract.**

- Column: `drivers.profile_image_url` (`varchar(500)`, nullable).
- Upload: `POST /api/v1/driver/profile/avatar` (driver JWT). Files are JPEG/PNG/WebP, stored under `uploads/avatars/drivers/`, and served by `app.use('/uploads', express.static(...))`.
- Public value: absolute URL when `API_PUBLIC_BASE_URL` or `VIDEO_API_PUBLIC_BASE_URL` is set; otherwise a relative `/uploads/avatars/drivers/{file}.jpg`.
- Driver profile DTO field name: `profileImageUrl`.
- `booking:accepted`, `booking:status`, `GET /bookings/active`, and `GET /bookings/:id` omit it.

---

## 4. Driver rating availability

**Not supported.**

There is no rating column on `drivers`, no ratings table, and no passenger rating endpoint. The only `rating` fields in booking code are hardcoded `null` on the **driver** view of the passenger (`src/services/driverBooking.service.ts`). That is not a driver score and is not sent to the passenger app.

---

## 5. Vehicle identification completeness

Stored vehicle columns (`vehicles`): `id`, `make`, `model`, `year` (integer), `color`, `plate_number`.

Denormalized driver columns, separate from the fleet vehicle row: `vehicle_make`, `vehicle_model`, `vehicle_year` (varchar 4), `vehicle_color`, `cab_number`, `cab_licence`.

| Field | REST assigned-vehicle snapshot | `booking:accepted` |
| --- | --- | --- |
| Vehicle ID | Yes, from `assigned_vehicle_id` | Only if `drivers.vehicle_id` is set; that id may not be the booking vehicle |
| Make | `vehicles.make` | `vehicles.make` of `drivers.vehicle_id`, else `drivers.vehicle_make` |
| Model | `vehicles.model` | `vehicles.model` of `drivers.vehicle_id`, else `drivers.vehicle_model` |
| Color | `vehicles.color`, else assigned driver's `vehicle_color` | Assigned driver's `vehicle_color` only |
| Year | Missing. `vehicles.year` is not selected | Missing |
| License plate | `vehicles.plate_number`, also copied to `driver.plateNumber` | Plate of `drivers.vehicle_id`, also copied to `driver.plateNumber` |

`booking:status` carries none of these fields. After acceptance, a client that misses `booking:accepted` must call `GET /bookings/active` or `GET /bookings/:id` to recover identity. Those REST calls are the consistent source.

---

## 6. Ride vehicle assignment consistency

On accept, inside the booking transaction (`src/services/dispatch.service.ts`):

1. `resolveDispatchVehicle` (`src/services/driverAvailability.service.ts`) prefers the driver's **active fleet assignment** (`driver_vehicle_assignments`). If none exists, it falls back to `drivers.vehicle_id`.
2. That resolved id is written to `bookings.assigned_vehicle_id`.
3. `bookings.assigned_driver_id` is set to the accepting driver.
4. Status becomes `driver_en_route`.

`assigned_vehicle_id` is assigned in that one update only. No later code path writes it.

Passenger REST follows step 2. It joins the vehicle recorded on the ride.

`booking:accepted` does not. After commit it selects `vehicles` where `id = drivers.vehicle_id`.

Duty start normally sets `drivers.vehicle_id` to the same vehicle as the active assignment, so the two often match. They diverge when an active assignment exists and `drivers.vehicle_id` is null or points at a different vehicle. In that case:

- REST shows the ride vehicle.
- The socket shows the driver's current/legacy vehicle, or `vehicle: null`.

The driver booking payload has a similar fallback (`assigned` vehicle, else `drivers.vehicle_id`). The passenger snapshot does not use that fallback for id, make, model, or plate. Color is the exception: if `vehicles.color` is null, REST fills color from the assigned driver's `vehicle_color`.

---

## 7. Active-booking vehicle exchange behavior

Vehicle exchange swaps two on-duty drivers' **fleet assignments** and updates each `drivers.vehicle_id`. It does not update any booking.

Exchange is blocked for the initiator and the partner:

- at initiate (`initiateVehicleExchange`)
- again at confirm

`assertNoActiveRide` calls `driverHasActiveRide`, which is true when the driver has a booking in `accepted`, `driver_en_route`, `arrived`, or `in_progress`. The error is `ACTIVE_RIDE_BLOCKS_EXCHANGE` / `Active ride blocks exchange`.

Pending exchange also removes the driver from new dispatch (`EXCHANGE_PENDING`).

**Limitation, current behavior:** an active booking cannot change vehicles. There is no passenger event for a vehicle change because the booking row never changes vehicle. Do not add mid-ride vehicle switching as part of showing the accepted car. The passenger should keep showing `bookings.assigned_vehicle_id` for the life of the ride.

---

## 8. ETA availability

At accept, ETA is computed once from the offer's pickup distance:

`estimateMinutesFromKm` = `max(1, ceil(distanceKm / 25 * 60))` assuming 25 km/h (`src/utils/geo.ts`).

That integer is stored on `bookings.driver_eta_minutes` and emitted once as `booking:accepted.etaMinutes`.

It is not:

- recalculated from later `driver:location` updates
- included in `booking:status`
- included in `GET /bookings/active` or `GET /bookings/:id`
- an arrival timestamp

`data.route.durationMin` is the estimated trip duration from pickup to drop-off, not the driver's time to pickup.

Live position is available. Live ETA is not.

---

## 9. Passenger-to-driver messaging support

**No in-app messaging, SMS, or masked calling exists.**

What exists:

- The driver's phone is returned on REST (`driver.phone`) and on `booking:accepted` (`driver.phone`) when `drivers.phone` is set. The app can place a normal device call. The number can be null.
- One-way FCM tells the passenger that ride status changed and to open the app. It is not a chat channel.
- `GET /api/v1/passenger/bookings/:bookingId/share` returns a trip share token. It is not driver communication.

There is no chat table, message route, or socket event for passenger-to-driver text.

---

## 10. Exact missing backend capabilities

| Requirement | Current support |
| --- | --- |
| Driver ID | REST and `booking:accepted` |
| Driver full name | REST `driver.name` and `booking:accepted` `driver.name`. One stored name, not first/last |
| Profile photo URL | Stored as `profileImageUrl`. Omitted from passenger REST and sockets |
| Phone | REST and `booking:accepted`, nullable |
| Driver rating | No data model |
| Vehicle ID, make, model, color, plate of the **ride** vehicle | REST yes. `booking:accepted` uses `drivers.vehicle_id` and driver color, so it can disagree |
| Vehicle year | Stored on `vehicles.year`. Omitted everywhere the passenger reads |
| Booking ID | REST `id`, sockets `bookingId` |
| Pickup and drop-off | REST only. Not on `booking:accepted` or `booking:status` |
| Current status | REST `status`. Sockets: `booking:accepted` then `booking:status` |
| Driver ETA | One-shot `etaMinutes` on `booking:accepted` only. Column exists. REST omits it. Not live |
| Driver live location | `driver:location` only. No REST coordinate field |
| Ride vehicle stays the accepted vehicle | REST yes. Socket accept payload no. Reassignment unsupported |
| Passenger-to-driver messages | Unsupported. Phone call only, if phone is present |

`booking:status` never repeats driver or vehicle identity. Reconnect and missed `booking:accepted` depend on the GET snapshot.

---

## 11. Recommended minimal implementation changes

Ordered by priority. These are decisions, not changes made in this audit.

1. **Make `booking:accepted.vehicle` the booking vehicle.** After commit, load `bookings.assigned_vehicle_id` and that `vehicles` row. Set `driver.plateNumber` from that plate. Set `color` from `vehicles.color`. Do not read `drivers.vehicle_id` for this event. This is the only change required to stop the socket from showing a different car than REST.

2. **Add the stored photo and year to the passenger snapshot and to `booking:accepted`.** `driver.profileImageUrl` from `drivers.profile_image_url`. `vehicle.year` from `vehicles.year` of the assigned vehicle. Same objects on `GET /bookings/active` and `GET /bookings/:id`, because those are the recovery path. Do not add a new endpoint.

3. **Return the stored ETA on the REST snapshot.** Map `bookings.driver_eta_minutes` as `etaMinutes` (same name as the socket). Leave it as the accept-time estimate. A moving ETA needs a new calculation from `driver:location` plus routing and should be a separate decision.

4. **Leave vehicle exchange unchanged.** Keep `ACTIVE_RIDE_BLOCKS_EXCHANGE`. Do not update `assigned_vehicle_id` during a ride. Document for the app that the vehicle shown at acceptance is the vehicle for the whole booking.

5. **Do not add rating or in-app chat in the identification fix.** Rating needs a new store and a write path. Chat needs a new product surface. Phone remains the only passenger-to-driver channel.

Optional, only if the app cannot refetch after a dropped socket: repeat the same `driver` and `vehicle` objects on later `booking:status` events. Prefer the GET snapshot over inventing a second event name.

---

## Field checklist after acceptance

| Field | REST `GET /bookings/active` and `GET /bookings/:id` | `booking:accepted` | `booking:status` | `driver:location` |
| --- | --- | --- | --- | --- |
| Driver ID | Yes | Yes | No | `driverId` only |
| Full name | Yes | Yes | No | No |
| Profile photo URL | No | No | No | No |
| Phone | Yes, nullable | Yes, nullable | No | No |
| Rating | No | No | No | No |
| Vehicle ID | Assigned vehicle | `drivers.vehicle_id` | No | No |
| Make | Assigned vehicle | Current/legacy vehicle | No | No |
| Model | Assigned vehicle | Current/legacy vehicle | No | No |
| Color | Assigned vehicle, else driver color | Driver color only | No | No |
| Year | No | No | No | No |
| License plate | Assigned vehicle | Current/legacy vehicle | No | No |
| Booking ID | `id` | `bookingId` | `bookingId` | `bookingId` |
| Pickup and drop-off | Yes | No | No | No |
| Status | Yes | `driver_en_route` | Yes | No |
| Driver ETA | No | Yes, once | No | No |
| Live location | No | No | No | Yes |

**Final status: PASSENGER DRIVER & VEHICLE BACKEND CONTRACT AUDITED — IMPLEMENTATION DECISIONS REQUIRED**
