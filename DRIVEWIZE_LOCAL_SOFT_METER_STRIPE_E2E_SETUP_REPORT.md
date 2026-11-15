# DriveWize — local Soft Meter Stripe TEST end-to-end setup

Prepared: 2026-11-03. Repository: `backend_rydu` only.

This report prepares the existing local backend for Soft Meter Stripe **TEST** Checkout QA. It does not claim a live ride or a live Stripe payment succeeded. Production metered charging stays off (`METERED_CHARGING_RELEASED = false`).

No Stripe secret values are printed here.

## 1. Environment configuration status

Configured database: `localhost:5432/ryd_u`  
`NODE_ENV=development`  
`PORT=3000`  
`BYPASS_AUTH=false` (Auth0 remains required)

### Stripe keys (prefixes only)

| Variable | Status |
| --- | --- |
| `STRIPE_SECRET_KEY` | Set. Prefix `sk_test` |
| `STRIPE_PUBLISHABLE_KEY` | Set. Prefix `pk_test` |
| `STRIPE_WEBHOOK_SECRET` | Set. Prefix `whsec_` |

Live key prefixes (`sk_live` / `pk_live`) were not found in the active `.env`.

### Soft Meter test gates (updated in `.env`)

| Variable | Value after this setup |
| --- | --- |
| `ONDEMAND_STRIPE_TEST_PAYMENTS` | `true` |
| `WALKUP_STRIPE_TEST_PAYMENTS` | `true` |
| `ONDEMAND_STRIPE_TEST_SANDBOX` | unset (correct for development) |
| `WALKUP_STRIPE_TEST_SANDBOX` | unset (correct for development) |
| `METER_CHECKOUT_SUCCESS_URL` | `http://103.208.181.253:3000/meter/payment/return` |
| `METER_CHECKOUT_CANCEL_URL` | `http://103.208.181.253:3000/meter/payment/cancel` |

Gate evaluation against the updated `.env` file (not against a process that still has old env in memory):

- On-demand: `{ "action": "ready" }`
- Walk-up: `{ "action": "ready" }`
- `METERED_CHARGING_RELEASED`: `false`

`.env.example` now documents both `ONDEMAND_*` and `WALKUP_*` flags and the Checkout URL convention.

### Required restart

`dotenv` loads once at process start. After editing `.env`, restart the backend:

```powershell
# In the backend_rydu terminal that runs the API
# Stop the current process (Ctrl+C), then:
npm run dev
```

Until that restart, the running process may still have the old unset flags even though the file is updated.

## 2. Local Stripe test readiness

Ready after backend restart, with test keys and both payment flags true:

- Hosted Checkout amount comes from the finalized Soft Meter fare
- Checkout POST body must be `{}`
- Browser return pages do **not** mark Paid
- Paid requires a verified Stripe webhook with `livemode=false`, matching amount, and USD

Simple browser return pages were added (webhook still confirms payment):

- `GET /meter/payment/return` → HTTP 200 HTML
- `GET /meter/payment/cancel` → HTTP 200 HTML

Verified locally against the running server after the file reload: both returned HTTP 200.

## 3. Webhook forwarding procedure

Webhook route (unchanged):

`POST /api/v1/webhooks/stripe`

Stripe CLI was **not** installed on this machine (`stripe` command missing). `winget` is available.

### Install Stripe CLI (Windows)

```powershell
winget install -e --id Stripe.StripeCli
```

Close and reopen the terminal, then confirm:

```powershell
stripe --version
stripe login
```

### Forward test events

In a **second** terminal, while the backend listens on port 3000:

```powershell
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe
```

Stripe CLI prints a webhook signing secret that starts with `whsec_`.

That CLI secret is **not** the same value as a Dashboard endpoint secret.

1. Copy the `whsec_...` value printed by `stripe listen`.
2. Set `STRIPE_WEBHOOK_SECRET` in `.env` to that exact value.
3. Restart `npm run dev`.
4. Keep `stripe listen` running for the whole QA session.

Do not invent or guess a webhook secret. Do not commit `.env`.

Useful optional filter (Checkout-focused QA):

```powershell
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe --events checkout.session.completed,checkout.session.expired,charge.refunded
```

## 4. Local backend accessibility

| Check | Result |
| --- | --- |
| `GET http://127.0.0.1:3000/health` | Healthy (PostgreSQL + Redis) |
| `GET http://103.208.181.253:3000/health` | HTTP 200 from this host |
| LAN IPv4 on Ethernet | `103.208.181.253` |
| `CORS_ORIGIN` | Already includes `http://103.208.181.253` and `:8081` / `:5173` variants |

### Device API host

Physical Android and iOS devices must **not** use `localhost` or `127.0.0.1` as the API host. Those point at the phone itself.

Use:

`http://103.208.181.253:3000`

Requirements:

- Phone and PC on the same reachable network path to that IP
- Windows firewall allows inbound TCP 3000 if the phone cannot connect
- Passenger and driver apps point their API base URL at that host
- Auth0 callback / audience settings already used by the apps must still match this backend

Checkout success/cancel URLs already use the LAN IP so a phone browser returning from Stripe can reach the PC.

## 5. Driver / passenger prerequisites

| Prerequisite | Local status |
| --- | --- |
| Active Economy category | Present (`economy`, `is_active=true`) |
| Customers in DB | 12 rows (accounts exist; tokens not verified here) |
| Drivers in DB | 76 active-account drivers, all `status=offline` |
| Open duty sessions | 2 `active` rows |
| Online drivers seen by the running server | 0 (dispatch uses Redis active-driver set) |
| Auth bypass | Off. Passenger and driver routes need Auth0 JWTs |

### Passenger

1. Sign in with a real passenger Auth0 account known to this backend.
2. Configure the passenger app API base to `http://103.208.181.253:3000`.
3. Book **instant Economy**.
4. Expect `billingMode=metered_post_trip`, `paymentRequiredBeforeDispatch=false`, `status=searching`, `paymentStatus=pending`, and **no** quoted PaymentSheet / `clientSecret`.

### Driver

1. Sign in with a real driver Auth0 account.
2. Configure the driver app API base to `http://103.208.181.253:3000`.
3. Complete duty start / vehicle QR requirements used by this environment.
4. Go **online** and keep location updates fresh (`DRIVER_LOCATION_STALE_SECONDS=120`).
5. Be inside `DISPATCH_RADIUS_KM=15` of the passenger pickup and eligible for Economy.

Dispatch will not offer a ride while no driver is in the Redis active set. Two open duty sessions with every driver row still `offline` means a live offer is currently blocked until a driver app goes online with fresh GPS.

Authentication was not bypassed. No fake production booking was created for this report.

## 6. Exact end-to-end test instructions

Run only after:

1. Backend restarted with the new `.env`
2. `stripe listen` running and `STRIPE_WEBHOOK_SECRET` matching that session
3. One authenticated online driver with fresh location
4. One authenticated passenger on the LAN API host

### A. Book without upfront authorization

1. Passenger books instant Economy.
2. Confirm response / booking detail:
   - `billingMode = metered_post_trip`
   - `paymentRequiredBeforeDispatch = false`
   - `paymentRequiredAfterCompletion = true`
   - `status = searching`
   - `paymentStatus = pending`
   - no actionable quoted `clientSecret`
3. Confirm Flutter does **not** open PaymentSheet for this booking.

### B. Dispatch and meter

4. Online driver receives the offer.
5. Driver accepts → en route → arrived → start trip (`in_progress`).
6. Confirm Soft Meter session starts automatically for `metered_post_trip`.
7. Drive enough for accepted GPS distance to increase the provisional fare.
8. Come to a full stop long enough for at least one completed stopped minute and confirm the fare increases by the draft stopped-time rule.
9. Pause: fare freezes. Resume: GPS/stop anchor resets; charges resume only after new valid samples.
10. Driver completes the trip once.

### C. Pay the finalized meter (Stripe TEST)

11. Booking stays `completed` while unpaid.
12. Passenger sees Payment Pending. `GET .../meter-payment` returns `paymentRequired=true` and exact `finalFareCents`.
13. `POST .../meter-payment/checkout` with body `{}`.
14. Open the returned hosted URL. Pay with an official Stripe test card, for example:
    - Card: `4242 4242 4242 4242`
    - Any future expiry, any CVC, any postal code
15. Confirm `stripe listen` forwards `checkout.session.completed`.
16. Confirm booking / meter payment becomes Paid only after that verified webhook.
17. `GET .../meter-payment/receipt` becomes available.
18. Leaving Checkout without webhook confirmation must **not** mark Paid.

### D. Unpaid recovery

19. Complete another metered test ride (or leave one unpaid).
20. Force-close the passenger app before paying.
21. Sign in again.
22. Confirm recovery via:
    - `GET /api/v1/passenger/bookings/unpaid-meter-payment`
    - History → Pay Now
    - `GET /api/v1/passenger/bookings/:bookingId/meter-payment`
23. Checkout again with `{}` and complete payment once.

### Safety during QA

- Use only `sk_test` / `pk_test`
- Do not charge or capture older historical bookings that are already quote-captured
- Do not reset the database
- Do not set `METERED_CHARGING_RELEASED=true`
- Do not present synthetic GPS as physical-device proof

## 7. Checks executed and results

| Check | Result |
| --- | --- |
| Migrations 0036–0040 on local `ryd_u` | Present (`created_at` 1790200000000 … 1790600000000) |
| No unnecessary migrate run for this task | Confirmed |
| Historical bookings left null `billing_mode` | Confirmed earlier; not modified |
| Stripe key prefixes | `sk_test` / `pk_test` |
| Gate evaluation after `.env` update | On-demand ready, walk-up ready |
| Production charging latch | Still false |
| Local health | Healthy |
| LAN health on `103.208.181.253:3000` | HTTP 200 |
| Meter return/cancel pages | HTTP 200 |
| Stripe CLI installed | No |
| Live webhook from Stripe CLI | **NOT VERIFIED** |
| Live passenger / driver authenticated ride | **NOT VERIFIED** |
| Live Checkout payment | **NOT VERIFIED** |

Focused Jest (ran this session):

```text
npx jest --maxWorkers=1 --forceExit
  tests/soft-meter-metered-booking.test.ts
  tests/soft-meter-ondemand-payment.test.ts
  tests/soft-meter-walkup-stripe-test.test.ts
  tests/soft-meter.webhook.test.ts
  tests/soft-meter.payment.test.ts
```

Result: 5 suites passed, 25 tests passed, exit 0.

`npm run build` exited 0 during the gate check.

## 8. Unresolved blockers

1. **Backend restart required** so the running process loads `ONDEMAND_STRIPE_TEST_PAYMENTS`, `WALKUP_STRIPE_TEST_PAYMENTS`, and the Checkout URLs.
2. **Stripe CLI missing.** Install with `winget install -e --id Stripe.StripeCli`, then `stripe listen` and replace `STRIPE_WEBHOOK_SECRET` with the printed `whsec_` value.
3. **No online driver.** All 76 drivers are `offline`. Dispatch needs an authenticated driver online with fresh GPS near pickup.
4. **Authenticated app sessions** for passenger and driver on the LAN API host were not exercised in this setup pass.
5. **No live Stripe Checkout or webhook delivery** was performed. Automated webhook tests used mocked events only.
6. **Physical GPS QA** remains. Unit tests use synthetic points; they are not a device drive.

## 9. Files touched

- `.env` — enabled Soft Meter Stripe test flags and LAN Checkout URLs (secrets not listed here)
- `.env.example` — documented on-demand and walk-up test flags
- `src/index.ts` — additive Checkout return/cancel HTML pages (do not mark Paid)
- `DRIVEWIZE_LOCAL_SOFT_METER_STRIPE_E2E_SETUP_REPORT.md` — this report

No booking, meter, fare, or payment architecture redesign. Production metered charging remains disabled.
