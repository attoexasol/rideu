# RYDU Backend — iOS Terminated FCM Audit Report

**Date:** 2026-09-16  
**Scope:** Driver `booking_offer` push only. Live source inspected; older reports were not treated as source of truth.  
**Secrets:** Full FCM tokens, service-account keys, JWTs, and APNs keys are not included.

---

## 1. Root cause

Terminated iOS Driver received no visible notification because the backend sent a **data-only** FCM message with **Android options only**. There was no top-level `notification` and no `apns` payload.

That is valid for Android: high-priority data messages are delivered to `FirebaseMessagingService` even when the app is backgrounded or killed.

It is **not** valid for terminated iOS. APNs does not display a banner for data-only FCM. A terminated iOS app needs a user-visible APNs alert (`apns-push-type: alert` + `aps.alert`).

Foreground/socket offers still worked because Socket.IO is independent of FCM. The iOS log `Backend token registration skipped (same token already registered)` only means the client already stored the token locally. It does not prove APNs can show a terminated-app banner.

**Root cause confirmed in current source, then fixed.**

---

## 2. Current FCM payload

### Implementation map (live source)

| Concern | File | Function / route |
|---|---|---|
| `PUT /api/v1/driver/push-token` | `src/routes/v1/index.ts` → `src/routes/v1/driver/push.ts` | `router.put('/', … registerPushTokenHandler)` |
| `DELETE /api/v1/driver/push-token` | same | `router.delete('/', … unregisterPushTokenHandler)` |
| Controller | `src/controllers/driverPush.controller.ts` | `registerPushTokenHandler`, `unregisterPushTokenHandler` |
| Token upsert / delete | `src/services/driverPushToken.service.ts` | `registerDriverPushToken`, `unregisterDriverPushToken` |
| Storage | `src/db/schema/driver_push_tokens.ts`, `src/repositories/driverPushToken.repository.ts` | table `driver_push_tokens`; `upsertDriverPushToken` |
| Dispatch trigger | `src/services/dispatch.service.ts` | after `createPendingBookingOffer` → `notifyDriverOfPersistedOffer` |
| Socket + isolated FCM | `src/services/driverOfferNotify.service.ts` | `emitToDriver('booking:offer')` then `scheduleDriverOfferPush` |
| FCM sender | `src/services/driverOfferPush.service.ts` | `sendDriverOfferPush` / `scheduleDriverOfferPush` |
| Payload builder | `src/services/driverOfferPush.payload.ts` | `buildDriverOfferFcmMessage` |
| Firebase Admin init / send | `src/services/fcmAdmin.service.ts` | `initializeFirebaseAdmin`, `sendFcmMessage` |
| Feature flag | `src/config/fcm.ts` | `isFcmEnabled()`, `FCM_ENABLED` |

Tokens are stored in `driver_push_tokens` (`driver_id`, `device_id`, `session_id`, `fcm_token`, `enabled`). There is **no platform column**. Send is **single-token** (`messaging.send`), not multicast.

### Payload before this change (the bug)

```ts
{
  token: '<omitted>',
  data: {
    type: 'booking_offer',
    offerId: '<uuid>',
    bookingId: '<uuid>'
  },
  android: {
    priority: 'high',
    ttl: remainingSeconds * 1000,
    collapseKey: 'booking_offer:<offerId>'
  }
}
```

No `notification`. No `apns`. iOS therefore had no APNs alert.

### Payload after this change

Same data + Android block, plus APNs alert. **No top-level `notification`**, so Android stays data-only.

```ts
{
  token: '<omitted>',
  data: {
    type: 'booking_offer',
    offerId: '<uuid>',
    bookingId: '<uuid>'   // omitted only if absent
  },
  android: {
    priority: 'high',
    ttl: remainingSeconds * 1000,
    collapseKey: 'booking_offer:<offerId>'
  },
  apns: {
    headers: {
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': '<unix seconds>',
      'apns-collapse-id': 'booking_offer:<offerId>'
    },
    payload: {
      aps: {
        alert: {
          title: 'New ride request',
          body: 'Open the app to review this ride request.'
        },
        sound: 'default'
      }
    }
  }
}
```

On notification tap, FCM still delivers `type`, `offerId`, and `bookingId` in the data / `userInfo` map. The app hydrates with `GET /api/v1/driver/bookings/offers/{offerId}`. Ride details are not in the push.

---

## 3. Firebase project alignment

| Source | Project ID |
|---|---|
| `FIREBASE_PROJECT_ID` env | `drivewize-e108b` |
| `GOOGLE_APPLICATION_CREDENTIALS` service-account `project_id` | `drivewize-e108b` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | not set locally |
| `FCM_ENABLED` | `true` |
| Sibling Android `google-services.json` (`Documents/driver-app-android`) | `drivewize-e108b` |
| iOS `GoogleService-Info.plist` | **not in this backend workspace** |

Backend credentials and the Android Driver app are the **same Firebase project**.

The iOS plist is not present here, so it could not be read. Practical implication:

- If iOS `PROJECT_ID` is also `drivewize-e108b`, alignment is correct.
- A token minted by a different Firebase project typically fails FCM send (`mismatched-credential` / sender mismatch), rather than succeeding silently with no banner.
- The current bug was payload shape (no APNs alert), not a proven project mismatch.

Confirm on the iOS project that `GoogleService-Info.plist` `PROJECT_ID` is `drivewize-e108b` before treating remaining misses as APNs transport issues.

---

## 4. Stored-token verification

Development database `driver_push_tokens` (full tokens not printed):

| Driver ID | Token exists | Length | Last 4 | Last registered (row timestamp) | Rows for this driver | Active device/session match |
|---|---|---|---|---|---|---|
| `4d8d26f0-cee9-4575-8331-ae64b072f42c` | yes | 142 | `0mvI` | `2026-09-15T12:22:16.325Z` | 1 | yes |
| `281b0d60-71c9-45e3-abcd-0d7c6a590c37` | yes | 142 | `hHTw` | `2026-09-12T03:41:13.394Z` | 1 | yes |

The first row is the current online driver and is the likely iOS QA target. Compare suffix `0mvI` with the iOS DEBUG token suffix.

`PUT /api/v1/driver/push-token` upserts on `(driver_id, device_id)`, overwrites `fcm_token`, sets `enabled=true`, and detaches the same token from other devices. Observed one row per driver, which matches that upsert. The iOS skip log is consistent with this token already being stored.

---

## 5. Firebase send result / error handling

### Before

- `sendFcmMessage` returned a message ID, but the sender discarded it.
- Summary log: `event: 'driver.push.offer'` with `pushSent` / `pushFailureCode`.
- Permanent token errors (`UNREGISTERED`, invalid registration token) deleted the row.
- Transient errors retried once.
- FCM failure is isolated: dispatch and Socket.IO still succeed (`scheduleDriverOfferPush` + `driver.push.isolated_failure`).
- No token suffix, no message ID, no APNs-auth / sender-mismatch diagnostics.

### After (safe diagnostics)

Structured logs, never the full token:

- `DriverPush.booking_offer_send_start` — `platform=android+apns`, `tokenSuffix`, `offerId`, `bookingId`, `driverId`
- `DriverPush.booking_offer_send_success` — `messageId`, `tokenSuffix`, `offerId`
- `DriverPush.booking_offer_send_failed` — `code`, `tokenSuffix`, `offerId`

Classified codes now include:

| Firebase / mapped code | Handling |
|---|---|
| `messaging/registration-token-not-registered`, `UNREGISTERED`, invalid registration token | permanent; delete token row |
| `messaging/unavailable`, timeout, internal | transient retry |
| `messaging/mismatched-credential` (sender mismatch) | log; do **not** delete token |
| `messaging/third-party-auth-error` (APNs auth) | log; do **not** delete token |
| `messaging/invalid-argument` (non-token) | log; do **not** delete token |
| `FCM_DISABLED` / `FCM_UNAVAILABLE` / `NO_TOKEN` / `NO_ACTIVE_DEVICE` | skip send; dispatch continues |

`fcm.initialized` now also logs `projectId` (ID only).

---

## 6. Changes made

Because the payload was data-only, terminated iOS could not show a banner. The sender was updated:

- `src/services/driverOfferPush.payload.ts` — `buildDriverOfferFcmMessage` adds APNs alert; Android remains data-only; `bookingId` included when present; token suffix helper; broader error mapping.
- `src/services/driverOfferPush.service.ts` — sends the combined message; logs start/success/failure with suffix + message ID / error code.
- `src/config/fcm.ts` — generic copy constants (`New ride request` / `Open the app to review this ride request.`).
- `src/services/fcmAdmin.service.ts` — log resolved Firebase `projectId` on init.
- `src/db/schema/driver_push_tokens.ts` — comment: tokens are for Driver devices, not Android-only; still no platform column.

Not added: payment, booking-status, vehicle-exchange, or payout pushes. No fare/passenger/route fields in the notification.

---

## 7. Android regression protection

Backend does **not** store platform. One FCM HTTP v1 message now carries:

- common `data`
- `android` high-priority data-only options (no `android.notification`)
- `apns` user-visible alert

FCM applies `android` to Android tokens and `apns` to iOS tokens. Top-level `notification` was **not** added, so Android background delivery stays data-message (`onMessageReceived`) rather than a system tray notification-only message.

Existing Android collapse key, TTL, and identifier-only data are unchanged.

---

## 8. Tests

Updated/added coverage:

| ID | Proof |
|---|---|
| A | `data.type === 'booking_offer'` |
| B | `data.offerId` retained |
| C | `data.bookingId` retained when present; omitted when absent |
| D | Android `priority`, `ttl`, `collapseKey`, data keys unchanged; no `android.notification` |
| E | `apns.payload.aps.alert` present; `apns-push-type: alert`; `apns-priority: 10` |
| F | Title is `New ride request` |
| G | Body is generic; no phone/pickup/dropoff/route/fare |
| H | `notifyDriverOfPersistedOffer` still emits socket if FCM scheduling throws; `sendDriverOfferPush` does not throw on FCM errors |
| I | Unregistered token cleaned up; APNs auth error does **not** delete the token |
| J | Logs include suffix `WXYZ` and never the full fake token |

Command:

```
npx jest tests/driver-offer-push.payload.test.ts tests/driver-offer-push.service.test.ts tests/driver-offer-notify.test.ts tests/driver-push-dispatch.contract.test.ts tests/driver-push-routes.test.ts
```

**Result:** 5 suites, 37 tests, all passed.

---

## 9. Build result

```
npx tsc --noEmit
npx tsc
```

Both exited 0.

`tsx watch` (`npm run dev`) should pick up the sender change. If it does not, restart the API process before device QA.

---

## 10. Exact next physical-device test

1. Confirm the API process reloaded this change (`fcm.initialized` with `projectId: drivewize-e108b` is fine).
2. On the iOS Driver device: signed in, notification permission allowed, FCM token obtained.
3. Confirm backend registration: iOS DEBUG suffix should match stored suffix `0mvI` for driver `4d8d26f0-cee9-4575-8331-ae64b072f42c` if that is the QA driver. If the suffix differs, register again with `PUT /api/v1/driver/push-token`.
4. Force-quit the Driver app (swipe up from app switcher). It must be **terminated**, not merely backgrounded.
5. From Passenger, request a ride that dispatches to that driver.
6. **Expect banner while terminated:**  
   Title: `New ride request`  
   Body: `Open the app to review this ride request.`
7. Tap the banner. App should open and load `GET /api/v1/driver/bookings/offers/{offerId}` using `data.offerId` (and `bookingId` if present). Do not expect fare/route in the notification.
8. Foreground check: with the app open, a new offer should still use the in-app sheet; the client may suppress the system banner.
9. Android check: a Driver Android device with a registered token should still receive the data-only offer as before (no new Android notification requirement).
10. Backend logs for that offer: `DriverPush.booking_offer_send_success` with `messageId` and `tokenSuffix`.  
    If instead `booking_offer_send_failed`:
    - `UNREGISTERED` / invalid token → re-register from iOS
    - `mismatched-credential` → iOS plist project ≠ `drivewize-e108b`
    - `third-party-auth-error` → Firebase APNs auth key / team / bundle mismatch
    - success `messageId` but **no banner** → client APNs permission, entitlements, or APNs delivery, not this payload

---

## Final status

ROOT CAUSE FIXED — READY FOR iOS TERMINATED PUSH QA
