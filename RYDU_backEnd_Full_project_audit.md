# RYD U Backend — Full Project Audit

**Project:** DriveWize / RYD U Backend API  
**Package:** `drivewize-backend` v1.0.0  
**Author:** Daedastream LLC  
**Audit date:** July 11, 2026  
**Auditor scope:** Source code, database schema, migrations, API contracts, tests, documentation  
**Authority:** Source code and actual schema (not documentation alone)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Business Context](#business-context)
3. [Technology Stack](#technology-stack)
4. [Project Structure](#project-structure)
5. [Runtime Architecture](#runtime-architecture)
6. [Environment & Configuration](#environment--configuration)
7. [Database Schema](#database-schema)
8. [Migrations](#migrations)
9. [Authentication & Authorization](#authentication--authorization)
10. [API Inventory](#api-inventory)
11. [Booking & Dispatch System](#booking--dispatch-system)
12. [WebSocket & Real-Time](#websocket--real-time)
13. [Rate Limiting](#rate-limiting)
14. [Maps Integration](#maps-integration)
15. [Video & Recording](#video--recording)
16. [QR Code System](#qr-code-system)
17. [Background Jobs](#background-jobs)
18. [Testing](#testing)
19. [Documentation Inventory](#documentation-inventory)
20. [Known Gaps & Technical Debt](#known-gaps--technical-debt)
21. [Security Audit](#security-audit)
22. [Multi-Fleet Architecture Readiness](#multi-fleet-architecture-readiness)
23. [Recommendations](#recommendations)
24. [Appendix: File Index](#appendix-file-index)

---

## Executive Summary

The RYD U backend is a **Node.js / Express / TypeScript** API serving three client applications:

| Client | Stack | Primary APIs |
|--------|-------|--------------|
| **Admin dashboard** | Web | `/api/admin/*`, `/api/drivers`, `/api/reports`, `/api/v1/admin/*` |
| **Driver app** | Kotlin | `/api/auth`, `/api/drivers`, `/api/locations`, `/api/v1/driver/bookings` |
| **Passenger app** | Flutter | `/api/v1/passenger/*` |

**Current business model:** Single global fleet — all vehicles belong to the platform; admins register drivers and assign vehicles; passengers book by service category; backend dispatch is authoritative.

**Overall maturity:** Production-capable for single-fleet ride-hailing with GPS tracking, dispatch, booking lifecycle, live video, and QR workflows. **Not ready** for multi-owner / multi-fleet without schema and RBAC changes.

| Area | Status |
|------|--------|
| Passenger booking & dispatch | ✅ Implemented |
| Driver offer accept/decline/status | ✅ Implemented |
| GPS tracking (HTTP + WebSocket) | ✅ Implemented |
| Google Maps proxy (passenger) | ✅ Implemented |
| Rate limiting (tiered, per-route) | ✅ Implemented |
| Video recording (live segments + trip upload) | ✅ Implemented |
| QR (driver, vehicle, company check-in, passenger trip) | ✅ Implemented |
| Payment capture / commissions / payouts | ❌ Not implemented |
| Multi-fleet / multi-tenant | ❌ Not implemented |
| Vehicle CRUD API | ❌ Missing (seed/DB only) |
| `driver_vehicle_assignments` runtime use | ❌ Orphaned table |

**Audit status:** `READY FOR MULTI-FLEET DESIGN` (design phase only — no implementation in this audit)

---

## Business Context

### Current flows

```
Admin → creates driver (Auth0) → assigns vehicleId + service categories
Driver → check-in (company QR) → goes online → POST /api/locations every ~5s
Passenger → selects service category → POST /bookings → backend dispatches
Backend → offers to eligible drivers → driver accepts → ride lifecycle
```

### Key business rules (enforced in code)

1. **Dispatch is backend-authoritative** — clients do not select drivers.
2. **Driver eligibility** requires: online, not busy, assigned vehicle, approved vehicle status, matching service category, fresh GPS, within radius.
3. **Passenger cancel** allowed in `searching`, `offered`, `driver_en_route`, `arrived` — blocked after `in_progress`.
4. **Recording consent** required before driver can set status to `in_progress`.
5. **Idempotency** on booking create and cancel via `Idempotency-Key` header.

### Future requirement (not yet built)

Support platform-owned vehicles, individual owners, companies, fleet operators, transport agencies, partner organizations, fleet managers, commissions, settlements, and payouts — while preserving existing data and dispatch behavior.

---

## Technology Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Runtime | Node.js | ≥ 18 |
| Language | TypeScript | 5.3+ |
| HTTP framework | Express | 4.18 |
| ORM | Drizzle ORM | 0.44 |
| Database | PostgreSQL | 15+ |
| Cache / Pub-Sub | Redis (ioredis) | 7+ |
| WebSocket | Socket.IO + Redis adapter | 4.6 |
| Auth | Auth0 (RS256 JWKS) + local HS256 JWT sessions | — |
| Validation | Zod | 3.22 |
| Rate limiting | express-rate-limit + custom Redis store | 7.1 |
| File upload | Multer | 2.2 |
| Logging | Pino | 8.17 |
| Testing | Jest + ts-jest + supertest | 29.7 |
| Maps (passenger) | Google Maps Platform (server-side) | — |
| Maps (admin GPS snap) | Mapbox Matching API | — |

---

## Project Structure

```
backend/
├── src/
│   ├── index.ts                 # App entry, middleware, route mounts, background jobs
│   ├── config/                  # auth0, redis, dispatch, rate-limit, env-validator, googleMaps
│   ├── constants/               # bookingStatus, vehicleTypes
│   ├── controllers/             # HTTP handlers (booking, video, QR, auth)
│   ├── db/
│   │   ├── schema/              # 23 Drizzle table definitions
│   │   ├── migrations/          # 14 SQL migrations (0000–0013)
│   │   ├── migrate.ts           # Migration runner
│   │   ├── connection.ts        # postgres.js + Drizzle client
│   │   ├── seed.ts              # Dev seed data
│   │   └── utils.ts             # DB helper utilities
│   ├── middleware/              # auth, rbac, rate-limiters, upload, logger, error-handler
│   ├── repositories/            # Data access (booking, serviceCategory, QR, attendance)
│   ├── routes/                  # Express routers
│   │   ├── admin/               # User management
│   │   └── v1/                  # passenger, driver, admin booking APIs
│   ├── services/                # Business logic (dispatch, booking, maps, video, auth0)
│   ├── scripts/                 # Diagnostics, backfill, live verification
│   ├── utils/                   # geo, response, jwt-verifier, idempotency
│   ├── validators/              # Zod schemas
│   └── websocket/               # Socket.IO server + handlers
├── tests/                       # 9 Jest test suites (77 tests)
├── dist/                        # Compiled JavaScript output
├── uploads/                     # Local video segment storage
└── *.md                         # API reference docs (18 files)
```

**Approximate scale:** ~287 TypeScript source files under `src/`.

---

## Runtime Architecture

```
                    ┌─────────────────────────────────────────┐
                    │           Clients                        │
                    │  Admin Web │ Kotlin Driver │ Flutter Pax │
                    └─────┬──────────┬──────────────┬─────────┘
                          │ HTTP     │ HTTP/WS      │ HTTP/WS
                          ▼          ▼              ▼
                    ┌─────────────────────────────────────────┐
                    │  Express (port 3000, trust proxy: 1)     │
                    │  helmet → cors → rate-limit → json       │
                    └─────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐   ┌──────────┐   ┌──────────────┐
    │PostgreSQL│   │  Redis   │   │  Socket.IO   │
    │ Drizzle  │   │ cache +  │   │ Redis adapter│
    │          │   │ pub/sub  │   │              │
    └──────────┘   └──────────┘   └──────────────┘
                          │
                    Background jobs:
                    - Driver inactivity checker
                    - Offer expiration (15s interval)
```

### Startup sequence

1. `validateEnvironment()` + `printEnvironmentInfo()`
2. `verifyCriticalServices()` (DB + Redis health)
3. `startInactivityChecker()` — marks stale drivers offline
4. `processExpiredOffers()` every 15 seconds
5. HTTP server on `0.0.0.0:PORT`
6. Socket.IO with Redis adapter
7. `setupBookingEventSubscriber()` — Redis pub/sub → Socket.IO rooms

### Graceful shutdown

`SIGTERM` / `SIGINT` → stop background jobs → close HTTP → close Redis + DB connections.

---

## Environment & Configuration

### Required by environment (`src/config/env-validator.ts`)

| Variable | development | staging | production |
|----------|-------------|---------|------------|
| `PORT` | ✅ | ✅ | ✅ |
| `DATABASE_URL` | ✅ | ✅ | ✅ |
| `REDIS_URL` | optional | ✅ | ✅ |
| `AUTH0_*` | optional | ✅ | ✅ |
| `JWT_SECRET` | optional | ✅ | ✅ (≥32 chars) |
| `GOOGLE_MAPS_API_KEY` | optional | optional | ✅ |
| `MAPBOX_ACCESS_TOKEN` | optional | optional | ✅ |

### Key operational variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `NODE_ENV` | Tier selection (dev/staging/production/test) | development |
| `CORS_ORIGIN` | Allowed origins (comma-separated) | localhost:5173,8081 |
| `BYPASS_AUTH` | Skip JWT verification (dev only) | false |
| `DRIVER_LOCATION_STALE_SECONDS` | GPS freshness threshold | 120 |
| `DISPATCH_RADIUS_KM` | Offer radius | 15 |
| `DISPATCH_BATCH_SIZE` | Drivers per offer batch | 5 |
| `DISPATCH_OFFER_TIMEOUT_SECONDS` | Offer TTL | 45 |
| `DISPATCH_MAX_BATCHES` | Max dispatch retries | 3 |
| `DB_TRANSACTION_TIMEOUT_MS` | Accept/cancel transaction timeout | 8000 |
| `RATE_LIMIT_*` | Per-tier rate limits | See Rate Limiting section |

See `.env.example` for full list including rate-limit placeholders.

---

## Database Schema

**Engine:** PostgreSQL  
**ORM:** Drizzle ORM  
**Tables:** 23 (+ 1 enum `vehicle_type`)

### Entity relationship overview

```
admin_users ──┐
customers ────┼── sessions (polymorphic user_id + user_type)
drivers ──────┘

drivers ── vehicle_id ──► vehicles
drivers ── driver_vehicle_assignments ──► vehicles (UNUSED at runtime)
drivers ── driver_service_categories ──► service_categories
drivers ── locations, trips, driver_attendance, booking_offers

customers ── bookings ── booking_stops, booking_offers, booking_events
bookings ── assigned_driver_id ──► drivers
bookings ── assigned_vehicle_id ──► vehicles
bookings ── linked_trip_id ──► trips (FK in migration, partial in Drizzle)

trips ── trip_videos, video_sessions ── video_segments
```

### Table reference

#### `admin_users`
| Column | Notes |
|--------|-------|
| `id` | UUID PK |
| `auth0_id` | Unique |
| `email` | Unique |
| `name` | |
| `role` | `admin` (default), `super_admin` |

No fleet scope. Global platform administrators.

#### `customers` (passengers)
| Column | Notes |
|--------|-------|
| `id` | UUID PK |
| `auth0_id` | Unique, nullable for email-auth path |
| `email`, `name`, `phone_*` | |
| `status` | default `active` |
| `email_verified_at`, `phone_verified_at` | |
| `active_session_id`, `active_device_id` | Single-session enforcement |

#### `drivers`
| Column | Notes |
|--------|-------|
| `id` | UUID PK |
| `auth0_id`, `email` | Unique |
| `status` | `offline` (default), `online`, `busy` |
| **`vehicle_id`** | FK → vehicles — **dispatch authority** |
| `vehicle_type` | enum: sedan, suv, van, mini_bus, coach_bus |
| `cab_name`, `cab_number`, `cab_licence` | Denormalized cab identity |
| `vehicle_make/model/year/color` | Denormalized vehicle display |
| `qr_code`, `vehicle_qr_code` | Per-driver QR identifiers |
| `last_seen`, `active_session_id`, `active_device_id` | Session/device tracking |

**No approval workflow column.** Admin creation = implicit approval.

#### `vehicles`
| Column | Notes |
|--------|-------|
| `id` | UUID PK |
| `make`, `model`, `year` | |
| `plate_number`, `vin`, `body_number` | Unique where set |
| **`status`** | default `active` — dispatch accepts `active` or `approved` |
| `qr_code` | Unique vehicle QR |

**No `owner_id`, `fleet_id`, or ownership fields.**

#### `driver_vehicle_assignments`
| Column | Notes |
|--------|-------|
| `driver_id`, `vehicle_id` | FKs with cascade |
| `assigned_at`, `unassigned_at` | History timestamps |
| `is_active` | default true |

**Table exists; repository exists; NOT imported by any service or route.** Runtime uses `drivers.vehicle_id` only.

#### `driver_service_categories`
| Column | Notes |
|--------|-------|
| `driver_id`, `service_category_id` | Unique pair |
| `is_primary` | Stored, **not used in dispatch** |
| `verified_at` | Set on admin assign, **not checked in dispatch** |

#### `driver_attendance`
| Column | Notes |
|--------|-------|
| `driver_id` | FK |
| `check_in_time`, `check_out_time` | |
| `location` | |
| `status` | `checked_in` / `checked_out` |

Used with company QR check-in flow.

#### `service_categories`
| Column | Notes |
|--------|-------|
| `code` | Unique (ride, bike, cng, moto, premium, comfort) |
| `base_fare`, `per_km_rate`, `min_fare` | Pricing |
| `capacity`, `is_active`, `sort_order` | |

Global catalog — not fleet-scoped.

#### `bookings`
| Column | Notes |
|--------|-------|
| `customer_id`, `service_category_id` | Required FKs |
| `status` | See Booking Statuses section |
| `pickup_*`, `dropoff_*` | Geo + address |
| `estimated_fare`, `final_fare`, `discount_amount` | Fare snapshot |
| `payment_method_id`, `payment_status` | Shallow payment model |
| **`assigned_driver_id`** | Set at accept |
| **`assigned_vehicle_id`** | Set at accept from `driver.vehicleId` |
| `linked_trip_id` | Optional trip link |
| `dispatch_batch` | Dispatch retry counter |
| `recording_consented_at` | Required before `in_progress` |
| `route_encoded_polyline` | Google route snapshot |
| `share_token` | Share link |

**No fleet FK. Driver/vehicle display fields are live-joined, not frozen on booking.**

#### `booking_offers`
| Column | Notes |
|--------|-------|
| `booking_id`, `driver_id` | Unique pair |
| `status` | pending, accepted, declined, expired, taken, cancelled |
| `distance_to_pickup_km`, `expires_at` | |

#### `booking_events`
| Column | Notes |
|--------|-------|
| `booking_id` | FK |
| `actor_type`, `actor_id` | Polymorphic audit |
| `event_type`, `payload` | JSONB |

#### `booking_stops`, `booking_idempotency_keys`, `customer_places`
Standard supporting tables for multi-stop routes, idempotent booking/cancel, and saved addresses.

#### `trips`, `locations`
Legacy GPS trip tracking. Linked to bookings via `trips.booking_id` / `bookings.linked_trip_id`.

#### `trip_videos`, `video_sessions`, `video_segments`
Trip recording and live video segment storage.

#### `payment_methods`, `promotions`
Global lookup tables. `cash` payment method seeded.

#### `sessions`
Polymorphic: `user_id` + `user_type` (admin/driver/customer). **No FK constraint.**

#### `logs`
System-wide audit: `event_type`, `user_id`, `user_type`, `message`, `metadata` (JSONB).

### Missing schema domains

| Domain | Status |
|--------|--------|
| Organizations / fleets | ❌ |
| Vehicle ownership | ❌ |
| `vehicle_service_categories` | ❌ |
| Documents / KYC | ❌ (inline cab fields only) |
| Commissions | ❌ |
| Settlements / payouts | ❌ |
| Payment transactions | ❌ |

### Schema vs migration gaps

- `bookings.linked_trip_id` → `trips.id` — FK in SQL migration `0011`, not in Drizzle schema
- `trips.booking_id` → `bookings.id` — same

---

## Migrations

| # | Tag | Summary |
|---|-----|---------|
| 0000 | redundant_deathbird | Core: drivers, locations, trips, admin_users, sessions, vehicles, logs |
| 0001 | flawless_preak | Session extensions |
| 0002 | friendly_ultimatum | Driver session fields |
| 0003 | steep_lorna_dane | Additional schema |
| 0004 | add_cab_vehicle_fields | Cab/vehicle denorm on drivers |
| 0005 | add_cab_licence | Cab licence field |
| 0006 | add_qr_code | Driver QR codes |
| 0007 | phase1_vehicle_qr_assignments_attendance | Vehicles QR, **driver_vehicle_assignments**, driver_attendance |
| 0008 | passenger_trip_qr | Passenger trip QR on trips |
| 0009 | add_driver_vehicle_qr_code | Per-driver vehicle QR |
| 0010 | trip_videos | Trip video uploads |
| 0011 | passenger_booking_system | Full booking system (customers, bookings, offers, events, video sessions, service categories) |
| 0012 | customer_email_auth | Customer email/password auth path |
| 0013 | passenger_maps_route | Route polyline, idempotency keys, customer_places country_code |

**Runner:** `npm run db:migrate` → `src/db/migrate.ts`  
**Down migrations:** Only 0007 and 0008 have `.down.sql` files.

---

## Authentication & Authorization

### User tables (three separate entities)

| Table | Auth0 role | JWT `userType` |
|-------|-----------|----------------|
| `admin_users` | `admin`, `super_admin` | admin |
| `drivers` | `driver` | driver |
| `customers` | `customer` | customer |

### Auth flows

| Flow | Endpoint | Token |
|------|----------|-------|
| Admin/Driver login | `POST /api/auth/login` | Auth0 token → backend HS256 session JWT |
| Passenger register/login | `POST /api/v1/passenger/auth/register`, `/login` | Email/password → session JWT |
| Token refresh | `POST /api/auth/refresh` | Refresh token → new access JWT |
| WebSocket | Socket `authenticate` event | Bearer JWT in handshake |

### Roles

| Role | Hierarchy | Capabilities |
|------|-----------|--------------|
| `super_admin` | 3 | All admin + role changes + create admins |
| `admin` | 2 | Global driver CRUD, reports, service categories, company QR |
| `driver` | 1 | Own profile, location, offers, rides |
| `customer` | 1 | Own bookings, maps, places |

### Permission system

`Auth0Permissions` defined in `src/config/auth0.ts` but **`checkPermission()` is never used on any route**. All access control is role string matching.

### Middleware inconsistency

Two `requireAdmin` implementations:
- `src/middleware/auth.ts` — case-insensitive
- `src/middleware/rbac.ts` — case-sensitive exact match

Routes use both interchangeably.

### Development bypass

`BYPASS_AUTH=true` or dev mode without token → mock `super_admin` user (HTTP and WebSocket).

### Driver access helper

`canActOnDriver()` in `src/utils/driverAccess.ts`: admin/super_admin OR matching driver `userId`/`auth0Id`.

---

## API Inventory

### Health & root

| Method | Path | Auth |
|--------|------|------|
| GET | `/` | Public |
| GET | `/health` | Public (skipped from rate limit) |
| GET | `/api/health` | Public (skipped from rate limit) |

### Auth (`/api/auth`)

| Method | Path | Auth | Rate limit |
|--------|------|------|------------|
| POST | `/login` | Public | auth |
| POST | `/refresh` | Public | auth |
| POST | `/logout` | Bearer | global |
| GET | `/me` | Bearer | global |
| GET | `/verify` | Bearer | global |

### Admin users (`/api/admin/users`)

| Method | Path | Auth |
|--------|------|------|
| GET | `/` | admin, super_admin |
| POST | `/` | admin (drivers) / super_admin (any) |
| PATCH | `/:id/role` | super_admin |
| POST | `/:id/reset-password` | admin / super_admin |
| DELETE | `/:id` | admin / super_admin |

Legacy response envelope: `{ status, data, message }`.

### Drivers (`/api/drivers`)

| Method | Path | Auth |
|--------|------|------|
| GET | `/me` | driver |
| GET | `/qr/:qrCode` | any authenticated |
| GET | `/:id/qrcode` | admin or own driver |
| POST | `/scan-vehicle` | driver self or admin |
| POST | `/check-in` | driver self or admin |
| POST | `/check-out` | driver self or admin |
| GET | `/:driverId/assignment` | driver self or admin |
| GET | `/:driverId/attendance` | driver self or admin |
| GET | `/` | admin |
| GET | `/:id` | own driver or admin |
| POST | `/` | admin |
| PUT | `/:id` | admin |
| PATCH | `/:id/cab-identifier` | admin |
| DELETE | `/:id` | admin |
| PATCH | `/:id/status` | own driver or admin |

### Vehicles (`/api/vehicles`)

| Method | Path | Auth |
|--------|------|------|
| POST | `/scan` | any authenticated |
| GET | `/:driverId/qrcode` | admin |

**Note:** No `POST /api/vehicles` CRUD exists in code (referenced in Postman docs only). Vehicles created via `db/seed.ts`.

### Company (`/api/company`)

| Method | Path | Auth |
|--------|------|------|
| GET | `/checkin/qrcode` | admin |

Fixed QR value: `COMPANY_CHECKIN`.

### Locations (`/api/locations`)

| Method | Path | Auth | Rate limit |
|--------|------|------|------------|
| GET | `/active` | admin | global |
| POST | `/` | driver | **driver_location** (dedicated) |
| GET | `/:driverId` | admin or own driver | global |
| GET | `/:driverId/breadcrumbs` | admin or own driver | global |
| DELETE | `/:driverId` | admin | global |

### Trips (`/api/trips`)

| Method | Path | Auth |
|--------|------|------|
| GET | `/` | admin |
| GET | `/current` | authenticated |
| POST | `/` | driver |
| GET | `/:id` | authenticated |
| POST | `/:id/end` | driver |
| GET | `/:id/locations` | authenticated |
| POST | `/:id/verify-passenger-qr` | driver |
| PUT | `/:id` | driver |
| GET | `/:id/passenger-qr` | authenticated |

### Reports (`/api/reports`)

| Method | Path | Auth |
|--------|------|------|
| GET | `/driver/:driverId` | admin |
| GET | `/trips` | admin |
| GET | `/fleet` | admin |

All reports are **global** (no tenant filter).

### Videos (`/api/videos`)

| Method | Path | Auth |
|--------|------|------|
| POST | `/upload` | driver |
| POST | `/upload-chunk` | driver |
| GET | `/:tripId` | admin |
| DELETE | `/:id` | admin |

### Passenger auth (`/api/v1/passenger/auth`)

| Method | Path | Auth |
|--------|------|------|
| POST | `/register` | public |
| POST | `/login` | public |
| POST | `/forgot-password` | public |
| POST | `/logout` | customer |
| GET | `/me` | customer |

### Passenger booking (`/api/v1/passenger`)

| Method | Path | Auth | Rate limit |
|--------|------|------|------------|
| GET | `/places/autocomplete` | customer | passenger_maps |
| GET | `/places/details` | customer | passenger_maps |
| GET | `/places/reverse-geocode` | customer | passenger_maps |
| GET | `/places/suggestions` | customer | global |
| GET | `/pickup-spots` | customer | passenger_maps |
| POST | `/places` | customer | global |
| PATCH | `/places/:placeId` | customer | global |
| DELETE | `/places/:placeId` | customer | global |
| POST | `/routes/preview` | customer | passenger_maps |
| GET | `/services` | customer | global |
| GET | `/payment-methods` | customer | global |
| GET | `/drivers/nearby` | customer | global |
| POST | `/bookings/quote` | customer | passenger_maps |
| POST | `/bookings` | customer | passenger_booking |
| GET | `/bookings` | customer | global |
| GET | `/bookings/active` | customer | passenger_recovery |
| GET | `/bookings/:bookingId` | customer | global |
| POST | `/bookings/:bookingId/cancel` | customer | passenger_cancel |
| POST | `/bookings/:bookingId/consent-recording` | customer | global |
| GET | `/bookings/:bookingId/share` | customer | global |
| GET | `/bookings/:bookingId/live-video` | customer | global |

### Driver bookings (`/api/v1/driver/bookings`)

| Method | Path | Auth | Rate limit |
|--------|------|------|------------|
| GET | `/active` | driver | driver_recovery |
| GET | `/offers/pending` | driver | driver_recovery |
| GET | `/offers` | driver | global (skipped) |
| GET | `/offers/:offerId` | driver | global (skipped) |
| GET | `/:bookingId` | driver | global (skipped) |
| POST | `/:bookingId/accept` | driver | driver_offer |
| POST | `/:bookingId/reject` | driver | global (skipped) |
| POST | `/:bookingId/decline` | driver | driver_offer |
| PATCH | `/:bookingId/status` | driver | driver_offer |
| POST | `/:bookingId/cancel` | driver | global (skipped) |
| POST | `/:bookingId/video/segments` | driver | video_upload |

### Admin booking (`/api/v1/admin`)

| Method | Path | Auth |
|--------|------|------|
| GET | `/service-categories` | admin |
| GET | `/drivers/:driverId/service-categories` | admin |
| POST | `/driver-service-categories` | admin |
| DELETE | `/drivers/:driverId/service-categories/:categoryId` | admin |

---

## Booking & Dispatch System

### Booking statuses

```
quoted → searching → offered → accepted → driver_en_route → arrived → in_progress → completed
                  ↘ cancelled / expired / no_drivers
                  scheduled (future pickups)
```

### Dispatch configuration (`src/config/dispatch.ts`)

| Setting | Env var | Default |
|---------|---------|---------|
| Location stale | `DRIVER_LOCATION_STALE_SECONDS` | 120s |
| Radius | `DISPATCH_RADIUS_KM` | 15 km |
| Batch size | `DISPATCH_BATCH_SIZE` | 5 |
| Offer TTL | `DISPATCH_OFFER_TIMEOUT_SECONDS` | 45s |
| Max batches | `DISPATCH_MAX_BATCHES` | 3 |

### Dispatch flow

1. `confirmBooking()` → status `searching`, calls `startDispatch()`
2. `findNearbyDriversForCategory()` — Redis active drivers + eligibility filter
3. `startDispatch()` — creates `booking_offers`, emits `booking:offer` via Redis pub/sub → Socket.IO
4. Driver `acceptBookingOffer()` — re-checks eligibility, transaction sets `assigned_driver_id` + `assigned_vehicle_id`, driver → `busy`
5. `processExpiredOffers()` — expires stale offers, reverts booking to `searching` if no pending offers

### Driver eligibility (`checkDriverEligibility`)

| # | Check | Failure code |
|---|-------|--------------|
| 1 | Driver exists | `DRIVER_NOT_ELIGIBLE` |
| 2 | Not busy (no active booking) | `DRIVER_BUSY` |
| 3 | Status `online` (Redis or DB) | `DRIVER_NOT_ONLINE` |
| 4 | `drivers.vehicleId` set | `NO_ACTIVE_VEHICLE` |
| 5 | `vehicles.status` ∈ {active, approved} | `VEHICLE_NOT_APPROVED` |
| 6 | Service category in `driver_service_categories` | `SERVICE_CATEGORY_MISMATCH` |
| 7 | GPS in Redis | `LOCATION_STALE` |
| 8 | Valid coordinates | `LOCATION_STALE` |
| 9 | Fresh heartbeat/location | `LOCATION_STALE` |
| 10 | Within dispatch radius | `DRIVER_NOT_ELIGIBLE` |

### Booking snapshots

| When | Stored on booking |
|------|-------------------|
| Create | Fare, route, addresses — **no driver/vehicle** |
| Accept | `assigned_driver_id`, `assigned_vehicle_id`, `accepted_at`, `driver_eta_minutes` |
| Read | Driver name, phone, plate — **live JOIN**, not frozen |

### Idempotency

- `POST /bookings` — `Idempotency-Key` header scoped per customer
- `POST /bookings/:id/cancel` — `Idempotency-Key` scoped per booking (`cancel:{bookingId}:{key}`)

### Transaction safety

Accept and cancel use `withTransactionTimeout()` — DB-only inside transaction; Redis/socket side effects after commit. Prevents deadlock from holding row locks during external calls.

---

## WebSocket & Real-Time

### Server setup (`src/websocket/server.ts`)

- Socket.IO with Redis adapter for horizontal scaling
- JWT authentication on connect (or dev mock admin)
- Ping: 5s interval, 10s timeout
- Rooms: `customer-{id}`, `driver-{id}`, `admin`

### Client → Server events

| Event | Handler | Purpose |
|-------|---------|---------|
| `authenticate` | authentication.ts | JWT validation, room join |
| `location:update` | location.ts | GPS from driver (alternative to HTTP POST) |
| `driver:status` | driver-status.ts | Online/offline toggle |
| `booking:*` | booking.ts | Booking-related client events |

### Server → Client events (via `bookingNotify.service.ts`)

| Event | Recipients | Purpose |
|-------|------------|---------|
| `booking:offer` | driver | New dispatch offer |
| `booking:offer:cancelled` | driver | Offer withdrawn |
| `booking:accepted` | customer | Driver assigned |
| `booking:status` | customer, driver, admin | Status changes |
| `booking:recording-consent` | driver | Passenger consented |
| `driver:location` | customer | Live driver position during ride |
| `video:live-segment` | customer, admin | Live video chunk available |
| `location:broadcast` | admin | All driver positions (Mapbox snap) |

### Redis pub/sub bridge

`setupBookingEventSubscriber()` listens on Redis channels and emits to Socket.IO rooms — enables multi-instance dispatch notifications.

---

## Rate Limiting

**Implementation:** `src/config/rate-limit.ts` + `src/middleware/rate-limiters.ts` + `src/middleware/create-rate-limiter.ts`

### Tier defaults

| Limiter | development | staging | production |
|---------|-------------|---------|------------|
| global | 5000/min | 500/min | 100/15min |
| auth | 100/min | 50/min | 50/15min |
| passenger_maps | 300/min | 300/min | 60/min |
| passenger_booking | 100/min | 100/min | 20/min |
| passenger_cancel | 30/min | 30/min | 10/min |
| passenger_recovery | 300/min | 200/min | 60/min |
| driver_location | 1000/min | 1000/min | 20/min |
| driver_offer | 300/min | 300/min | 30/min |
| driver_recovery | 300/min | 200/min | 60/min |
| video_upload | 120/min | 120/min | 30/min |

### Key strategy

| Context | Key format |
|---------|------------|
| Passenger endpoints | `customer:{userId}` |
| Driver endpoints | `driver:{userId}` |
| Cancel | `cancel:{userId}:{bookingId}` |
| Auth / unauthenticated | `ip:{ip}` |

### Global skip paths

Dedicated limiters own these routes — global limiter skips them to prevent GPS/maps traffic from blocking cancel/accept. See `src/middleware/rate-limit-paths.ts`.

### 429 response contract

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Please try again shortly."
  }
}
```

Headers: `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`.

### Redis store

`RedisRateLimitStore` used when `RATE_LIMIT_USE_REDIS=true` or production with `REDIS_URL`.

### Safe 429 logging

Logs: limiter name, method, path, status 429, retry-after, user role, request ID. **No JWTs or credentials.**

---

## Maps Integration

### Passenger (Google Maps — server-side only)

| Feature | Service | Cached |
|---------|---------|--------|
| Autocomplete | Places API | No |
| Place details | Places API | Yes (300s) |
| Reverse geocode | Geocoding API | Yes (300s) |
| Route preview | Routes API v2 | Yes (300s) |
| Booking quote | Routes API v2 + fare calc | Yes (300s) |

Config: `src/config/googleMaps.ts`, `GOOGLE_MAPS_*` env vars.  
Min autocomplete length enforced server-side (Flutter must also debounce).

### Admin (Mapbox)

- `MAPBOX_ACCESS_TOKEN` — road snapping on location breadcrumbs and WebSocket `location:broadcast`
- Not used by passenger Flutter app

---

## Video & Recording

### Trip video upload (`/api/videos`)

- Driver uploads full trip recordings (multipart)
- Stored locally under `uploads/` (served at `/uploads`)
- Metadata in `trip_videos` table

### Live video segments (`POST /api/v1/driver/bookings/:id/video/segments`)

- Multipart chunk upload during active ride
- `video_sessions` + `video_segments` tables
- Segments emitted to passenger via `video:live-segment` WebSocket event
- Passenger accesses via `GET /bookings/:id/live-video`

### Recording consent

- `POST /bookings/:id/consent-recording` sets `recording_consented_at`
- Driver blocked from `in_progress` without consent (`RECORDING_CONSENT_REQUIRED`)

---

## QR Code System

| QR type | Constant / field | Endpoint | Purpose |
|---------|------------------|----------|---------|
| Driver identity | `drivers.qr_code` | `GET /api/drivers/qr/:qrCode` | Driver lookup |
| Driver vehicle | `drivers.vehicle_qr_code` | `POST /api/drivers/scan-vehicle` | Verify ownership (does not assign) |
| Vehicle registry | `vehicles.qr_code` | `POST /api/vehicles/scan` | Open lookup |
| Company check-in | `COMPANY_CHECKIN` | `GET /api/company/checkin/qrcode` | Attendance gate |
| Passenger trip | `trips.passenger_qr_code` | `POST /api/trips/:id/verify-passenger-qr` | Verify passenger boarding |

Backfill scripts: `npm run db:backfill-qr`, `npm run db:backfill-vehicle-qr`

---

## Background Jobs

| Job | Interval | File | Purpose |
|-----|----------|------|---------|
| Offer expiration | 15s | `dispatch.service.ts` | Expire stale offers, revert to searching |
| Driver inactivity | configurable | `driver-inactivity-checker.ts` | Mark stale drivers offline (Redis heartbeat + DB + location) |

---

## Testing

### Test suites (9 files, 77 tests passing)

| File | Coverage area |
|------|---------------|
| `validators.passenger.test.ts` | Zod passenger validators |
| `googleMaps.mapper.test.ts` | Google Maps response mapping |
| `route.service.test.ts` | Route computation |
| `fare.service.test.ts` | Fare calculation + promotions |
| `dispatch.contract.test.ts` | Status transitions, location freshness |
| `cross-app-dispatch-fixes.test.ts` | Flutter null compat, Redis heartbeat, offer expiration |
| `active-booking-cancellation.test.ts` | Cancel policy, idempotency, rate-limit skip paths |
| `accept-cancel-concurrency.test.ts` | Transaction safety, deadlock prevention |
| `rate-limit-config.test.ts` | Tier defaults, isolation, Retry-After, GPS allowance |

### Commands

```bash
npm test          # 77 tests
npm run build     # TypeScript compile
npm run lint      # ESLint
```

### Coverage threshold

Configured at 0% (no enforced minimum).

---

## Documentation Inventory

| File | Content |
|------|---------|
| `README.md` | Setup, scripts, project structure |
| `DRIVER_PASSENGER_BOOKING_CONTRACT.md` | **Authoritative** booking lifecycle, dispatch, sockets |
| `ADMIN_PANEL_API.md` | Admin dashboard API reference |
| `PASSENGER_APP_API.md` | Passenger app API reference |
| `All_APIs_endpoint.md` | Comprehensive passenger API (may lag rate-limit updates) |
| `QR_CODE_API.md` | QR workflows |
| `POSTMAN_*.md` | Postman testing guides |
| `VIDEO_API_REFERENCE.md` | Video endpoints |
| `VIDEO_IMPLEMENTATION_REPORT.md` | Video implementation notes |
| `AUTH0_SETUP.md` | Auth0 configuration |
| `DATABASE_README.md` | Database setup |
| `DATABASE_MIGRATION_GUIDE.md` | Migration guide |
| `RAILWAY_ENV_VARS.md` | Deployment env vars |
| `.env.example` | Environment template |

---

## Known Gaps & Technical Debt

| # | Issue | Severity | Detail |
|---|-------|----------|--------|
| 1 | No vehicle CRUD API | High | Vehicles only via seed/DB; admin assigns UUID |
| 2 | `driver_vehicle_assignments` orphaned | High | Table + repo exist; dispatch uses `drivers.vehicle_id` only |
| 3 | Dual vehicle model | Medium | `vehicles` table vs denorm fields on `drivers` can drift |
| 4 | QR scan doesn't assign vehicle | Medium | `scan-vehicle` verifies only; no assignment write |
| 5 | `verified_at` not enforced | Medium | Service category verification stored but not checked |
| 6 | Permissions unused | Medium | `Auth0Permissions` defined, never enforced |
| 7 | Dual `requireAdmin` | Low | Case-sensitive vs insensitive implementations |
| 8 | Drizzle/migration FK gap | Low | `linked_trip_id` / `booking_id` FKs missing in Drizzle schema |
| 9 | No payment rails | High | `payment_status` only; no capture, commission, payout |
| 10 | No multi-tenant isolation | Critical (future) | All admin queries global |
| 11 | Polymorphic sessions/logs | Low | No FK integrity on `user_id` |
| 12 | `POST /api/vehicles/scan` open | Medium | Any authenticated user can resolve vehicle QR |
| 13 | Documentation drift | Low | `All_APIs_endpoint.md` rate-limit section outdated |
| 14 | `is_primary` on service categories unused | Low | Stored, not used in dispatch |

---

## Security Audit

| Area | Finding | Risk |
|------|---------|------|
| Auth bypass | `BYPASS_AUTH=true` grants super_admin | High in misconfigured deploy |
| JWT secrets | `JWT_SECRET` must be ≥32 chars in production | High if weak |
| CORS | Configurable via `CORS_ORIGIN` | Medium if `*` in production |
| Rate limiting | Tiered, per-route, identity-keyed | ✅ Mitigated |
| Helmet | Enabled | ✅ |
| Trust proxy | Set to 1 | ✅ Correct for single reverse proxy |
| QR endpoints | Some open to any authenticated user | Medium |
| Admin scope | Global — no fleet isolation | Critical for multi-fleet |
| Session enforcement | Single active session per driver/customer device | ✅ |
| SQL injection | Drizzle parameterized queries | ✅ Low risk |
| File upload | Multer with size limits on video | Medium — validate MIME |
| Secrets in repo | `.env` in git status (should not commit) | High if pushed |

---

## Multi-Fleet Architecture Readiness

### Current state: single global fleet

- No `fleet_accounts`, `organizations`, or `tenant_id` anywhere
- All vehicles implicitly platform-owned
- All admin APIs return global data
- Dispatch pool is global
- "Company" = fixed attendance QR, not a business entity

### Existing building blocks

| Asset | Multi-fleet utility |
|-------|---------------------|
| `driver_vehicle_assignments` | Ready for history — needs wiring |
| `driver_service_categories` | Per-driver categories — may move to vehicle level |
| `bookings.assigned_*` FKs | Good snapshot pattern — extend with fleet FK |
| `booking_events` | Audit trail — add fleet context |
| `checkDriverEligibility()` | Extend with fleet + vehicle category checks |

### Recommended target schema (design only)

```
fleet_accounts              — platform, owner, company, agency, partner
fleet_memberships           — fleet managers, dispatchers (RBAC)
driver_fleet_memberships    — driver ↔ fleet affiliation
driver_vehicle_assignments — activate existing table + sync drivers.vehicle_id
vehicle_service_categories  — vehicle ↔ service type (new)
fleet_documents             — KYC, insurance, licences
booking_settlement_lines    — commission/payout extensibility (Phase 6)
```

### Migration phases (non-destructive)

| Phase | Action |
|-------|--------|
| 0 | Audit (this document) |
| 1 | Create Platform Fleet; backfill all vehicles/drivers/bookings |
| 2 | Wire `driver_vehicle_assignments`; add `vehicle_service_categories` |
| 3 | Fleet RBAC + scoped admin queries |
| 4 | Dispatch hardening (fleet filter, vehicle categories, booking snapshots) |
| 5 | Owner onboarding + document approval |
| 6 | Commission / settlement / payout |

### Security risks if multi-org added without Phase 3

- Fleet A admin sees Fleet B drivers, vehicles, bookings
- Cross-fleet vehicle reassignment
- Global dispatch offers leak across fleets

### Product decisions required

1. Opaque dispatch vs passenger fleet/operator selection
2. Global vs per-fleet service catalog and pricing
3. Driver multi-fleet employment
4. Vehicle transfer between fleets
5. Dispatch priority across fleets
6. Approval authority (platform vs fleet manager)
7. Per-fleet company check-in QR
8. Commission model and payment provider
9. Auth model for fleet users
10. Geographic territory exclusivity

**Multi-fleet status:** `READY FOR MULTI-FLEET DESIGN`

---

## Recommendations

### Immediate (no schema change)

1. Wire `driver_vehicle_assignments` into admin `PUT /api/drivers/:id` vehicle changes
2. Enforce `verified_at` in dispatch eligibility (feature flag)
3. Add vehicle CRUD admin endpoints
4. Unify `requireAdmin` to single case-insensitive implementation
5. Update `All_APIs_endpoint.md` rate-limit section to match centralized config
6. Ensure production deploy uses `NODE_ENV=staging` for QA servers

### Short-term (pre multi-fleet)

1. Add booking snapshot columns at accept (plate, make, model, driver name)
2. Make `POST /api/drivers/scan-vehicle` write assignment history
3. Close open QR scan endpoints or restrict by role
4. Add Drizzle FK declarations for `linked_trip_id` / `booking_id`

### Medium-term (multi-fleet Phase 1–3)

1. `fleet_accounts` + Platform Fleet bootstrap migration
2. `fleet_memberships` + scoped middleware
3. `vehicle_service_categories` + dispatch filter

### Long-term (Phase 4–6)

1. Document/KYC workflow
2. Payment provider integration
3. Commission rules + settlement batches

---

## Appendix: File Index

### Core services

| File | Responsibility |
|------|----------------|
| `src/services/booking.service.ts` | Booking create, cancel, active restore, formatting |
| `src/services/dispatch.service.ts` | Dispatch, offers, accept, expiration |
| `src/services/driverAvailability.service.ts` | Eligibility checks, busy/online management |
| `src/services/driverBooking.service.ts` | Driver booking read models |
| `src/services/bookingNotify.service.ts` | Redis pub/sub → Socket.IO events |
| `src/services/fare.service.ts` | Fare calculation |
| `src/services/googleMaps.service.ts` | Google Maps proxy |
| `src/services/auth0Management.ts` | Auth0 user lifecycle |
| `src/services/driver-inactivity-checker.ts` | Stale driver detection |
| `src/services/video-storage.service.ts` | Local video file management |
| `src/services/liveVideo.service.ts` | Live segment handling |

### Repositories

| File | Tables |
|------|--------|
| `booking.repository.ts` | bookings, offers, events |
| `serviceCategory.repository.ts` | service_categories, driver_service_categories |
| `driverVehicleAssignment.repository.ts` | driver_vehicle_assignments (**unused**) |
| `driverAttendance.repository.ts` | driver_attendance |
| `driverQrCode.repository.ts` | drivers QR |
| `companyCheckInQr.repository.ts` | company QR |
| `passengerTripQr.repository.ts` | trips passenger QR |
| `customer.repository.ts` | customers |

### Config files

| File | Purpose |
|------|---------|
| `src/config/auth0.ts` | Auth0 roles and permissions |
| `src/config/redis.ts` | Redis clients, pub/sub, realtime cache |
| `src/config/dispatch.ts` | Dispatch env defaults |
| `src/config/rate-limit.ts` | Rate limit tier defaults |
| `src/config/googleMaps.ts` | Google Maps config |
| `src/config/env-validator.ts` | Startup env validation |

---

## Audit Sign-Off

| Item | Value |
|------|-------|
| Document | `RYDU_backEnd_Full_project_audit.md` |
| Code modified during audit | **None** |
| Test status at audit time | 77/77 passing |
| Build status at audit time | Passing |
| Multi-fleet readiness | Design-ready, not implementation-ready |
| Overall project status | **Production-capable single-fleet platform** |

---

*End of audit.*
