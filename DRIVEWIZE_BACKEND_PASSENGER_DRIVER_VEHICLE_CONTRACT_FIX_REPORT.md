# DRIVEWIZE BACKEND — PASSENGER DRIVER & VEHICLE IDENTIFICATION CONTRACT FIX

**Status: PASSENGER DRIVER & VEHICLE BACKEND CONTRACT FIXED — END-TO-END QA REQUIRED**

No database migration. Booking creation, dispatch selection, the accept transaction, vehicle exchange, location events, authentication, payments, and recording were left in place.

## Confirmed issues corrected

1. **`booking:accepted` used the wrong vehicle.** After commit it loaded `drivers.vehicle_id` and `drivers.vehicle_color`. It now loads `bookings.assigned_vehicle_id` and that `vehicles` row only. `driver.plateNumber` comes from that plate. If the booking has no assigned vehicle, `vehicle` is `null` and `driver.plateNumber` is `null`.

2. **Driver photo was stored and not sent.** `drivers.profile_image_url` is now `driver.profileImageUrl` on the passenger booking snapshot and on `booking:accepted`. Managed avatar paths are rewritten with the current public API base. Other absolute URLs are returned as stored. Document paths and storage keys are not returned. Missing photo is `null`.

3. **Vehicle year was stored and not sent.** `vehicles.year` of the ride-assigned vehicle is `vehicle.year` on the passenger snapshot and on `booking:accepted`. It is `null` when the column is null. Driver legacy `vehicle_year` is not used.

4. **Accept-time ETA was stored and omitted from REST.** `bookings.driver_eta_minutes` is now `etaMinutes` on the passenger snapshot. `booking:accepted.etaMinutes` is still that same stored value (`booking.driverEtaMinutes`, with the accept-transaction estimate only if the reloaded column is null). No GPS ETA was added.

5. **Vehicle exchange during an active ride stays blocked.** `ACTIVE_RIDE_BLOCKS_EXCHANGE` is unchanged. Exchange still does not write `bookings.assigned_vehicle_id`.

`booking:status` is still `{ bookingId, status, timestamp, ...extra }`. `driver:location` fields are unchanged. Driver rating and messaging were not added.

Passenger ride history uses the same snapshot formatter, so completed and cancelled history items include the same driver photo, vehicle year, and stored ETA when those values exist.

## Files changed

| File | Change |
| --- | --- |
| `src/services/dispatch.service.ts` | Post-commit `booking:accepted` identity uses `booking.assignedVehicleId` |
| `src/services/rideHistory.service.ts` | Shared assigned-vehicle snapshot, photo, year, `etaMinutes`, accept-event builder |
| `src/repositories/booking.repository.ts` | History/detail select adds `drivers.profile_image_url` and `vehicles.year` |
| `src/services/avatar-storage.service.ts` | `resolvePublicProfileImageUrl` |
| `tests/passenger-driver-vehicle-contract.test.ts` | Contract tests |
| `tests/ride-history.test.ts` | Snapshot expectations for the new fields |
| `tests/avatar-storage.test.ts` | Avatar URL resolution |

## REST response examples

`GET /api/v1/passenger/bookings/active` and `GET /api/v1/passenger/bookings/:bookingId` stay passenger-authenticated. Success envelope is `{ "success": true, "data": ... }`.

After acceptance:

```json
{
  "success": true,
  "data": {
    "id": "booking-uuid",
    "status": "driver_en_route",
    "pickup": { "latitude": 23.81, "longitude": 90.41, "address": "Gulshan", "spotLabel": null },
    "dropoff": { "latitude": 23.75, "longitude": 90.38, "address": "Dhanmondi", "placeId": null },
    "driver": {
      "id": "driver-uuid",
      "name": "Karim",
      "phone": "+8801711111111",
      "profileImageUrl": "https://api.example.com/uploads/avatars/drivers/11111111-1111-1111-1111-111111111111.jpg",
      "plateNumber": "DHK-RIDE"
    },
    "vehicle": {
      "id": "vehicle-uuid",
      "make": "Toyota",
      "model": "Axio",
      "color": "Silver",
      "year": 2019,
      "plateNumber": "DHK-RIDE"
    },
    "etaMinutes": 7
  }
}
```

No photo, no assigned vehicle:

```json
{
  "driver": {
    "id": "driver-uuid",
    "name": "Karim",
    "phone": "+8801711111111",
    "profileImageUrl": null,
    "plateNumber": null
  },
  "vehicle": null,
  "etaMinutes": null
}
```

`etaMinutes` is the accept-time estimate. `route.durationMin` is still the trip duration, not the pickup ETA.

## Socket.IO payload example

Room: `customer-{customerId}`. Event: `booking:accepted`.

```json
{
  "bookingId": "booking-uuid",
  "status": "driver_en_route",
  "driver": {
    "id": "driver-uuid",
    "name": "Karim",
    "phone": "+8801711111111",
    "profileImageUrl": "https://api.example.com/uploads/avatars/drivers/11111111-1111-1111-1111-111111111111.jpg",
    "plateNumber": "DHK-RIDE"
  },
  "vehicle": {
    "id": "vehicle-uuid",
    "make": "Toyota",
    "model": "Axio",
    "color": "Silver",
    "year": 2019,
    "plateNumber": "DHK-RIDE"
  },
  "etaMinutes": 7
}
```

`vehicle.id` is `bookings.assigned_vehicle_id`. It is not `drivers.vehicle_id`.

## Targeted test results

```text
npx jest tests/passenger-driver-vehicle-contract.test.ts tests/ride-history.test.ts tests/avatar-storage.test.ts tests/passenger-push-dispatch.contract.test.ts tests/ride-history-routes.test.ts tests/market-fare-admin.test.ts --no-coverage
```

**6 suites passed, 66 tests passed, exit code 0.**

Covered:

- REST and `booking:accepted` describe the same assigned vehicle, including year and plate.
- A different driver color or current fleet vehicle is not substituted.
- Photo is the public avatar URL when stored, and `null` when absent.
- Year comes from `vehicles.year` and is `null` when missing.
- REST `etaMinutes` is the stored accept-time value.
- A missing assigned vehicle yields `vehicle: null` and a null plate.
- Post-commit accept code reads `booking.assignedVehicleId` and does not read `driver.vehicleId`.
- `booking:status` and `driver:location` source payloads are unchanged.
- Vehicle exchange still uses `ACTIVE_RIDE_BLOCKS_EXCHANGE` and does not reference `assignedVehicleId`.
- Active and booking-detail routes still require the passenger JWT, and the detail handler still checks `customerId`.

## Deployment steps

1. Deploy this backend revision. No new migration.
2. Restart the API process so Socket.IO and REST pick up the payload change.
3. Confirm `API_PUBLIC_BASE_URL` (or `VIDEO_API_PUBLIC_BASE_URL`) is the passenger-reachable origin. Managed photos are absolute when that base is set, and relative `/uploads/avatars/drivers/...` when it is not.
4. Confirm `/uploads` remains publicly served. Driver document routes are unchanged and are not used for the profile photo.

## Passenger physical-device QA checklist

- Accept a ride and confirm the on-screen make, model, color, year, and plate match the vehicle on the booking, including when the driver's current fleet vehicle is a different car.
- Confirm the driver photo loads, and that a driver with no photo shows an empty photo state.
- Confirm the phone action uses `driver.phone` and does nothing harmful when phone is null.
- Force-close the passenger app and reopen. `GET /bookings/active` must restore the same car, photo, and `etaMinutes`.
- Confirm `etaMinutes` matches the value from `booking:accepted` and does not change as the car moves. The map should still move from `driver:location`.
- Advance the ride through arrived, in progress, and completed. Status events must still arrive. The displayed car must stay the accepted vehicle.
- Start a vehicle exchange while that driver has the active ride. The exchange must still be rejected, and the passenger car must not change.

**Final status: PASSENGER DRIVER & VEHICLE BACKEND CONTRACT FIXED — END-TO-END QA REQUIRED**
