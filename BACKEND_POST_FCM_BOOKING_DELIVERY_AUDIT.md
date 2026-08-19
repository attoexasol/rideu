# Backend post-FCM booking delivery audit

**Date:** 2026-08-18  
**Scope:** Audit only. No application code was changed.  
**Method:** One live Passenger booking on the running `npm run dev` API, Postgres, Redis, Socket/dispatch logs, FCM config (no tokens or secrets printed), and the same query used by `GET /api/v1/driver/bookings/offers/pending`.

**Classification:** **B. DRIVER_NOT_ELIGIBLE**

The Driver Android “DriveWize — Location tracking active” banner is the LocationService foreground notification. It is **not** a ride-request notification and is **not** proof that this backend received GPS.

---

## Verdict

Dispatch **did start**. The expected Driver was **on duty** with an approved vehicle and a matching service category. No `booking_offers` row was created because Redis had **zero** `location:driver:*` keys (`activeDriverCount: 0`). The Driver is **not online** for dispatch (`DRIVER_NOT_ONLINE`) and has **no fresh Redis location**.

FCM is configured and would not have blocked Socket.IO. FCM was **never invoked** for this booking because no offer was persisted.

This is **not** an FCM regression of `createPendingBookingOffer` / `notifyDriverOfPersistedOffer`. Booking requests fail before those functions run.

---

## 1. Fresh passenger booking

Live HTTP from Passenger Dart (`103.208.183.242`) against this API process:

| Field | Value |
|-------|--------|
| `bookingId` | `a50665f0-c285-40dc-b6f2-88f133381290` |
| `bookingNumber` | `RYD-MSYYC6Q3-A9GV` |
| `serviceCategoryId` | `59ab7ef9-0bb3-47c8-8afa-3313b295151e` |
| Booking status at create | `searching` |
| Booking status at audit | `no_drivers` |
| `dispatch_batch` | `3` (max batches exhausted) |
| `assigned_driver_id` | `null` |
| Created at | `2026-08-18T17:44:01.036Z` |
| Pickup | House-31 Road No. 1, Dhaka 1219 (`23.76397520`, `90.42885730`) |
| Dropoff | Paribagh Rd, Dhaka 1205 |

Confirm:

| Check | Result |
|-------|--------|
| Booking creation HTTP status | **201** (`POST /api/v1/passenger/bookings`, duration 65ms) |
| Dispatch started | **true** — `startDispatch()` ran immediately after create (`booking.service.ts`). Logs show batch 1, 2, and 3. |

Log evidence:

```
[Dispatch] no eligible drivers in batch {
  bookingId: 'a50665f0-c285-40dc-b6f2-88f133381290',
  batch: 1,
  serviceCategoryId: '59ab7ef9-0bb3-47c8-8afa-3313b295151e',
  activeDriverCount: 0
}
[BookingCreate] success { bookingId: 'a50665f0-c285-40dc-b6f2-88f133381290', status: 'searching' }
```

Same warning repeated for **batch 2** and **batch 3**. Booking events: `created` only (no `accepted`; `no_drivers` is written via booking status, not a second event row).

Recent bookings `2006f6ca-…`, `0d98c39a-…`, `5a66f2b9-…` (same category, same afternoon) also have **offer_count = 0**. This is a pattern, not a one-off FCM send failure.

---

## 2. Driver eligibility

Expected Driver (on-duty QR session that started 35 seconds before this booking):

| Field | Value |
|-------|--------|
| `driverId` | `4d8d26f0-cee9-4575-8331-ae64b072f42c` |
| Name | Shamim Khan |
| Duty session active | **yes** — `cb6b8a8f-5f28-4860-a7d8-b49e21e5e56c`, status `active`, `started_at` `2026-08-18T17:43:26.460Z`, `ended_at` null |
| Online status (DB) | **offline** |
| Online status (Redis `status:driver:{id}`) | **offline** |
| Location freshness | **not fresh** |
| Redis location | **missing** (`locationPresent: false`) |
| Redis heartbeat | **null** |
| In Redis `getActiveDrivers()` set | **false** (`activeDriverCount: 0`) |
| DB `last_seen` | `2026-08-18T11:43:36.926Z` (~6 hours before this booking) |
| Last `locations` row | `2026-08-18T02:45:10.352Z` |
| Vehicle assignment | **active** — `3519ccd4-bd76-49a3-8604-aecf4252365e`, vehicle `f46dfcd2-1ce2-4984-bd8c-020021bc7343`, assigned at duty start |
| Vehicle status | `active` (approved for dispatch: `active` / `approved`) |
| Vehicle approval | **approved** (`status = active`, plate `5843`) |
| Service category match | **yes** — vehicle_service_categories includes `59ab7ef9-…` (`vehicleServesBookingCategory: true`; `category_source:active_assignment`) |
| `driver_service_categories` rows | none (not required; assignment/vehicle categories are used) |
| Active booking conflict | **none** |
| Exchange suspension | **none** (no pending exchange; not dispatch-suspended; not accepting) |
| `QR_DUTY_REQUIRED` | **unset / false** (duty is not a dispatch gate in this env) |

**Exact eligibility result** (`checkDriverEligibility`):

```
eligible: false
code: DRIVER_NOT_ONLINE
message: Driver is not online
```

Diagnostic extras (not a second independent fail-code; `checkDriverEligibility` returns at online check first):

- `LOCATION_UNAVAILABLE` — Redis has no lat/lng for this driver
- `vehicle_source:active_assignment`
- `category_source:active_assignment`

### Why dispatch never considered this Driver

`findNearbyDriversForCategory` only iterates `realtimeCache.getActiveDrivers()`, which **SCAN**s Redis keys `location:driver:*`. Duty start writes Redis **status** `online`. It does **not** write a location key.

This API process logged **no** `POST /api/locations` and **no** driver Socket.IO connection during the booking window. The Android FGS notification can show “Location tracking active” while this backend has no location ingest.

Even if DB status had still been `online` at `17:44:01`, this Driver would still be skipped: `activeDriverCount` was **0**.

Duty start (`duty.service.ts`) does set DB + Redis status to `online`. Inactivity checker then marks DB-online drivers **offline** when heartbeat, Redis location, `last_seen`, and DB location are all older than `DRIVER_INACTIVITY_THRESHOLD_MINUTES` (default 10). `last_seen` was already ~6 hours stale, so an online-from-duty Driver with no GPS ingest cannot stay in the online set.

---

## 3. Offer creation

| Field | Value |
|-------|--------|
| Offer row created? | **no** |
| `offerId` | n/a |
| `driverId` | n/a |
| `offeredAt` | n/a |
| `expiresAt` | n/a |
| status | n/a |
| `expiresAt > CURRENT_TIMESTAMP` | n/a — no row |

`createPendingBookingOffer()` is only called after a non-empty candidate batch. Batch size was 0, so the function was **not called**.

Do not treat “duty started” as proof an offer exists.

---

## 4. Socket delivery

Offer insert is **not** proof of emit. Here there was **no insert and no emit**.

| Check | Result |
|-------|--------|
| Driver socket authenticated | **not observed** in this process during the booking window |
| Resolved DB driver UUID | **not observed** (`[Socket] driver authenticated` absent) |
| Joined room `driver-{uuid}` | **not observed** (`[Socket] driver room joined` absent) |
| `booking:offer` emitted? | **no** |
| Room name | would have been `driver-4d8d26f0-cee9-4575-8331-ae64b072f42c` if emit ran |
| Room size | **not logged** — `[BookingNotify] emit to driver room` never ran |

Captured connections in the same window are **Passenger** sockets only (`customer-5b09ba54-e76b-4632-8a28-baf4b7f46cfa`).

`[Dispatch] booking:offer emitted` was **not** logged (that line is only after a persisted offer + `notifyDriverOfPersistedOffer`).

---

## 5. FCM (independent of dispatch)

| Check | Result |
|-------|--------|
| `FCM_ENABLED` | **true** (present and truthy in `.env`) |
| Firebase Admin initialized | **yes** — `fcm.initialized`, `projectConfigured: true`, `credentialMode: GOOGLE_APPLICATION_CREDENTIALS` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | unset (file-path credentials used instead) |
| `driver_push_tokens` row exists | **yes** (1 enabled row for this Driver; table total = 1) |
| Token matches active device/session | **yes** (`device_matches: true`, `session_matches: true`; prefixes `d725a380…` / `sess_1787074…`) |
| `pushAttempted` | **false** — `sendDriverOfferPush` / `scheduleDriverOfferPush` never called (no offer) |
| `pushSent` | **false** |
| `pushFailureCode` | **n/a** (push path not entered; no `driver.push.offer` log for this booking) |

FCM failure **must not** prevent Socket.IO delivery. For this booking it also **did not get a chance to run**.

### Does FCM throw into dispatch?

**No.** Isolation on the call path:

1. `createPendingBookingOffer()` completes first (never reached here).
2. `notifyDriverOfPersistedOffer()` **awaits Socket emit first**, then fires FCM with `void import('./driverOfferPush.service')`.
3. Dynamic import failure is `.catch`’d as `MODULE_LOAD_FAILED` and does not throw to dispatch.
4. `scheduleDriverOfferPush()` is fire-and-forget; `sendDriverOfferPush().catch` logs `ISOLATED_EXCEPTION`.
5. Missing token / `FCM_DISABLED` / `FCM_UNAVAILABLE` return result objects; they do not throw to dispatch.
6. `startDispatch` wraps notify in `try/catch` (`dispatch.offer_notify_failed`).

`sendFcmMessage` can throw `FCM_UNAVAILABLE` only inside the isolated push function, not inside `startDispatch`.

---

## 6. Dispatch regression around FCM

Inspected:

- `createPendingBookingOffer()` — persistence only; no FCM import.
- `notifyDriverOfPersistedOffer()` — Socket `emitToDriver(..., 'booking:offer', ...)` **before** FCM.
- `emitToDriver()` — Redis pub/sub or local `io.to('driver-{uuid}')`; logs `room` + `roomSize`; does not throw if room size is 0.
- `scheduleDriverOfferPush()` — `void sendDriverOfferPush(...).catch(...)`.

Existing Socket emit still happens regardless of:

| Failure mode | Blocks Socket emit? |
|--------------|---------------------|
| Missing token (`NO_TOKEN`) | **no** (after emit) |
| Firebase unavailable (`FCM_UNAVAILABLE`) | **no** |
| Push send error | **no** |
| Dynamic import failure | **no** |

**Conclusion:** the FCM wiring did not remove or gate the Socket emit. This booking never reached that code because eligibility/candidate selection failed first.

---

## 7. Pending REST recovery

`GET /api/v1/driver/bookings/offers/pending` is registered and live:

- Unauthenticated probe: **401** `AUTH_FAILED` / `No token provided` (route exists).
- Handler `listPendingOffersHandler` → `listPendingOffersForDriver(driver.id)`.
- Filter: offer `pending` AND booking `searching`/`offered` AND `expiresAt > CURRENT_TIMESTAMP`.

For Driver `4d8d26f0-cee9-4575-8331-ae64b072f42c` the same query returns:

| Check | Result |
|-------|--------|
| Fresh offer appear? | **NO** |
| `pendingOfferCount` | `0` |

**Why it is excluded:** there is no `booking_offers` row for booking `a50665f0-…`. The endpoint is not hiding a live offer.

Interpretation required by the audit brief:

- If YES → dispatch/backend probably working, Driver ingestion broken.
- If NO → find why pending excludes it.

**NO**, because **no offer was created** (empty candidate batch). Not a pending-query filter bug.

---

## 8. Classification

**B. DRIVER_NOT_ELIGIBLE**

Exact fail: `DRIVER_NOT_ONLINE`, with Redis location missing so the Driver is also absent from the dispatch candidate pool (`activeDriverCount: 0`).

Ruled out:

| Code | Why not |
|------|---------|
| A. DISPATCH_NOT_STARTING | HTTP 201; `startDispatch` ran three batches |
| C. OFFER_NOT_CREATED | True as a **consequence**, not the root. Insert is skipped when the batch is empty |
| D. SOCKET_NOT_EMITTED | True as a **consequence**. Emit is after persist; persist never ran |
| E. DRIVER_ROOM_MISSING | Also true in logs (no driver socket), but not the reason no offer existed |
| F. PENDING_REST_MISSING | Empty because there is no offer row |
| G. FCM_FAILURE_BLOCKING_DISPATCH | FCM is isolated and was not called |
| H. BACKEND_DELIVERY_OK | No offer, no socket emit, Driver not eligible |
| I. OTHER | Eligibility code is explicit |

### What the Driver app showing LocationService does **not** prove

- It does not write Redis `location:driver:{uuid}`.
- It does not emit `booking:offer`.
- It is not FCM `type=booking_offer`.

Until this API receives authenticated `POST /api/locations` for Driver `4d8d26f0-…` (fresh Redis location + online status), dispatch will keep logging `activeDriverCount: 0` and bookings will end as `no_drivers` with zero offers — with or without FCM.
