# Driver FCM backend configuration

Driver ride-offer push is **optional**. Socket.IO `booking:offer` and REST recovery stay authoritative when FCM is off or credentials are missing.

The API process must still start. Push becomes a no-op and logs `fcm.config.unavailable`.

---

## Firebase project

1. Create or reuse a Firebase project that matches the Driver Android app.
2. Add an Android app with the same `applicationId` / package name as the Kotlin client.
3. Download `google-services.json` for the **Android app** (not committed to this backend).
4. Backend and Android **must use the same Firebase project**.

Do **not** reuse `GOOGLE_MAPS_API_KEY`. That key is for Maps HTTP APIs only.

---

## Service account

Create a Firebase/Google Cloud **service account** with permission to send FCM messages (Firebase Cloud Messaging API).

Store the JSON **outside git**. Never commit service-account files.

Supported credential modes (pick one):

### 1. File path (ADC)

```
FCM_ENABLED=true
FIREBASE_PROJECT_ID=your-firebase-project-id
GOOGLE_APPLICATION_CREDENTIALS=/secure/path/firebase-service-account.json
```

The JSON file must be readable by the API process only.

### 2. Secret JSON in env (hosting secret / vault)

```
FCM_ENABLED=true
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}
```

`FIREBASE_SERVICE_ACCOUNT_JSON` is a secret. Do not print it. Do not put it in `.env.example` with real values.

If both are set, **inline JSON wins**.

---

## Feature flag

```
FCM_ENABLED=false
```

| `FCM_ENABLED` | Credentials | Behavior |
|---------------|-------------|----------|
| `false` / unset | ignored | No-op push. Socket + REST work. Warning at startup. |
| `true` | missing / invalid | No-op push. Server still starts. Warning at startup. |
| `true` | valid | Offer push sent after `booking_offers` insert. |

---

## Android alignment

- Same Firebase project as this backend.
- FCM registration token from `FirebaseMessaging.getInstance().token`.
- Register that token with `PUT /api/v1/driver/push-token` after login and on token refresh.
- Data payload is wake-up only. Hydrate with `GET /api/v1/driver/bookings/offers/:offerId`.

See `DRIVER_FCM_OFFER_API_CONTRACT.md`.
