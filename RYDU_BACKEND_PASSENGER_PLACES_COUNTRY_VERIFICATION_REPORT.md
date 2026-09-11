# RYDU Backend — Passenger Places Country Verification Report

**Workspace:** `backend_rydu`  
**Date:** 2026-09-10  
**Scope:** Verify (and fix if needed) passenger Places proxy country handling for Bangladesh and the United States. Passenger Flutter was not modified.

**Final status:** **RYDU BACKEND PASSENGER PLACES COUNTRY FIXED — BD + US SUPPORTED**

---

## 1. Exact endpoint implementation files

Passenger Places routes are registered in `src/routes/v1/passenger/index.ts` and mounted under `/api/v1/passenger`.

| Method | Path | Route | Validator | Handler | Service / provider |
|--------|------|-------|-----------|---------|--------------------|
| `GET` | `/api/v1/passenger/places/autocomplete` | `src/routes/v1/passenger/index.ts` | `placesAutocompleteQuerySchema` in `src/validators/index.ts` | `autocompleteHandler` in `src/controllers/passengerBooking.controller.ts` | `autocompletePlaces` in `src/services/googleMaps/googleMaps.client.ts` |
| `GET` | `/api/v1/passenger/places/details` | same | `placeDetailsQuerySchema` | `placeDetailsHandler` | `fetchPlaceDetails` |
| `GET` | `/api/v1/passenger/places/reverse-geocode` | same | `reverseGeocodeQuerySchema` | `reverseGeocodeHandler` | `reverseGeocode` |
| `GET` | `/api/v1/passenger/places/suggestions` | same | `placeSuggestionsQuerySchema` | `suggestionsHandler` | `listCustomerPlaceSuggestions` in `src/repositories/customer.repository.ts` — **saved/recent places only, no Google call** |
| `POST` | `/api/v1/passenger/routes/preview` | same | `routePreviewSchema` | `routePreviewHandler` | `previewRoute` → `computeRoute` |

Shared helpers:

- Config: `src/config/googleMaps.ts` (`getGoogleMapsConfig`, `isGoogleMapsConfigured`)
- Re-export barrel: `src/services/googleMaps.service.ts`
- Response mapping: `src/services/googleMaps/googleMaps.mapper.ts` (`parseAddressComponents`, `mapPlaceDetailsResult`, `mapGeocodeResult`)
- Types: `src/services/googleMaps/types.ts`
- Errors: `src/services/googleMaps/errors.ts`
- HTTP mapping: `src/utils/googleMapsHandler.ts`
- Auth / limiter: `requireAuth`, `extractUserInfo`, `requireCustomer`, `passengerMapsRateLimit`

No other geolocation provider is used for passenger Places. Admin maps use Mapbox and are out of this path.

---

## 2. Exact provider / API used

**Legacy Google Places Autocomplete API** (not Places API New):

`GET https://maps.googleapis.com/maps/api/place/autocomplete/json`

Country is applied as a `components` filter:

```
components=country:BD
components=country:US
```

This is **not** Places API (New) `includedRegionCodes`.

Other provider calls on the same client:

| Operation | Provider endpoint |
|-----------|-------------------|
| Place details | Legacy Place Details `GET https://maps.googleapis.com/maps/api/place/details/json` with `address_components` |
| Reverse geocode | Geocoding API `GET https://maps.googleapis.com/maps/api/geocode/json` |
| Route preview | Routes API `POST https://routes.googleapis.com/directions/v2:computeRoutes` |

No Google API version migration was performed.

---

## 3. Exact handling of request `country`

Trace for `GET /api/v1/passenger/places/autocomplete`:

1. `req.query.country` is accepted (`optional`).
2. Validation: trim, must match `/^[A-Za-z]{2}$/`, then uppercase (`bd` → `BD`, `us` → `US`). Invalid values are **rejected** (`VALIDATION_ERROR`), not guessed.
3. Controller `autocompleteHandler` forwards `{ lat, lng, city, country, sessionToken }` unchanged.
4. `autocompletePlaces` → `buildAutocompleteProviderParams` → `normalizePlacesCountryCode`.
5. If a valid country is present, the provider request includes `components=country:<ISO>`.
6. If country is omitted, **no** `components` country filter is sent.

Arbitrary valid ISO alpha-2 codes are accepted (not limited to BD/US).

---

## 4. Exact provider request generated

Legacy Autocomplete params now built by `buildAutocompleteProviderParams`:

```
input=<trimmed search>
types=establishment|geocode
language=<GOOGLE_MAPS_LANGUAGE or en>
components=country:BD          # only when country is present
location=<lat>,<lng>           # only when both lat and lng are present
radius=50000                   # only with location
sessiontoken=<token>           # optional
key=<GOOGLE_MAPS_API_KEY>
```

Examples:

| Flutter query | Provider `components` | Provider bias |
|---------------|----------------------|---------------|
| `input=Mirpur&lat=23.75&lng=90.38&country=BD` | `country:BD` | `23.75,90.38` / `50000` |
| `input=Broadway&lat=40.758&lng=-73.9855&country=US` | `country:US` | `40.758,-73.9855` / `50000` |
| `input=Mirpur&country=bd` | `country:BD` | none |
| `input=Broadway` (country omitted) | **omitted** | none or lat/lng if provided |

Optional `city` still appends `|locality:<city>` onto `components` when present. It does not invent a country.

---

## 5. Hardcoded-country audit

| Hit | Classification |
|-----|----------------|
| `autocompletePlaces` previously used `options?.country ?? config.defaultCountry` | **Places restriction (fixed).** Omitted `country` silently became `GOOGLE_MAPS_DEFAULT_COUNTRY` or `BD`. |
| `GOOGLE_MAPS_DEFAULT_COUNTRY` in `.env` / `.env.example` / `src/config/googleMaps.ts` / `env-validator.ts` | **Documented leftover service-area config.** Still loaded as `defaultCountry`, **no longer applied** to autocomplete when `country` is omitted. |
| `GOOGLE_MAPS_REGION` default `BD` → Routes API `regionCode` | **Routing bias, not a Places restriction.** Does not reject US/BD coordinates. Not redesigned. |
| `All_APIs_endpoint.md` “Filtered to Bangladesh by default” | **Stale docs** of the old Places default. Runtime no longer does this. |
| `STRIPE_CONNECT_DEFAULT_COUNTRY=US` and Stripe `country: 'US'` fixtures | **Phone/payout / Stripe Connect config** — unrelated to Places. |
| Profile `countryCode` validator | **Unrelated** profile field. |
| Saved-place `countryCode` length(2) | **Saved places storage**, not autocomplete restriction. |
| Docs / reports mentioning Bangladesh or United States in sample addresses | **Unrelated documentation / fixtures.** |
| `includedRegionCodes`, `PLACES_COUNTRY`, `GOOGLE_PLACES_COUNTRY`, `components=country:us` literals in production | **Not present.** |

No production Places path hardcodes `country: 'US'` or `country: 'BD'` onto the provider request after this fix.

---

## 6. Omitted-country behavior

**Before (bug vs current Flutter contract):**

`GET /places/autocomplete?input=...` always sent `components=country:BD` because:

```
components: country:${options?.country ?? config.defaultCountry}
```

and `defaultCountry` is `GOOGLE_MAPS_DEFAULT_COUNTRY` or `'BD'`.

This **was** an explicit documented backend service-area rule (`All_APIs_endpoint.md`, `.env.example`). It silently overrode Flutter’s intentional omit when pickup/GPS `countryCode` is unresolved, and would force Bangladesh results for a US session.

**After (smallest safe fix):**

Omitted `country` sends **no** country `components` filter. `GOOGLE_MAPS_DEFAULT_COUNTRY` is not applied. No US/BD/other country is guessed from locale, SIM, IP, or fare currency.

---

## 7. Reverse-geocode `countryCode` behavior

`GET /api/v1/passenger/places/reverse-geocode?lat=&lng=`

- Provider: Geocoding API with `latlng` only (no country filter).
- Mapping: `mapGeocodeResult` → `parseAddressComponents`.
- `country` = address component `country.long_name`.
- `countryCode` = `country.short_name`, trimmed and uppercased.
- Not derived from formatted address text.

Expected:

| Coordinate | `countryCode` |
|------------|---------------|
| Dhaka `23.8103, 90.4125` | `BD` |
| NYC `40.758, -73.9855` | `US` |

If Google returns no results, the coordinate fallback sets `country` / `countryCode` to `null` (does not invent BD or US).

---

## 8. Place-details `countryCode` behavior

`GET /api/v1/passenger/places/details?placeId=&sessionToken=`

- Requests `fields=place_id,name,formatted_address,geometry,address_components,types`.
- `mapPlaceDetailsResult` uses the same structured-component parser.
- Response includes `country` and `countryCode` when the provider exposes a `country` component.
- `countryCode` is normalized to uppercase ISO alpha-2.

This is what Flutter uses as selected-pickup `countryCode` for later destination autocomplete.

Autocomplete predictions themselves still have `country` / `countryCode` = `null` (legacy Autocomplete does not return address components). That is unchanged and correct.

---

## 9. Route-preview country behavior

`POST /api/v1/passenger/routes/preview`

- Validator: pickup/dropoff/stops are lat/lng only. No country field. No BD-only or US-only bounding box.
- `previewRoute` is a thin wrapper over `computeRoute`.
- Waypoints are sent as `{ location: { latLng: { latitude, longitude } } }`.
- `regionCode: config.region` (env default `BD`) is a Routes API **language/address-bias** field, not a country gate. US and BD coordinates are accepted by current service code.
- Fare quoting also uses `previewRoute` with the same coordinates; fare currency remains `BDT` and is unrelated to Places country.

**No hidden single-country validation.** Routing was not redesigned.

---

## 10. Live / sandbox verification results

`GOOGLE_MAPS_API_KEY` is present in the local environment. Direct provider calls (same URLs/params the backend now generates) were executed. The key was not logged.

| Probe | Result |
|-------|--------|
| Autocomplete `Mirpur` + Dhaka lat/lng + `components=country:BD` | `OK` — e.g. `Mirpur-10, Dhaka, Bangladesh` |
| Autocomplete `Broadway` + NYC lat/lng + `components=country:US` | `OK` — e.g. `Broadway, New York, NY, USA` |
| Autocomplete `Broadway` + NYC lat/lng, **no** `components` | `OK` — US-biased by lat/lng, not forced to BD |
| Reverse geocode Dhaka `23.8103, 90.4125` | `country=Bangladesh`, `countryCode=BD` |
| Reverse geocode NYC `40.758, -73.9855` | `country=United States`, `countryCode=US` |
| Place details after BD autocomplete | `country=Bangladesh`, `countryCode=BD` |
| Place details after US autocomplete | `country=United States`, `countryCode=US` |

Authenticated HTTP hits against a running local/deployed passenger API were not required; the provider contract matches the backend client.

---

## 11. Files changed

| File | Change |
|------|--------|
| `src/services/googleMaps/googleMaps.client.ts` | Stop applying `defaultCountry` when `country` is omitted. Add `normalizePlacesCountryCode` + `buildAutocompleteProviderParams`. Honor request country only. |
| `src/services/googleMaps/googleMaps.mapper.ts` | Uppercase structured `countryCode`. |
| `src/validators/index.ts` | Autocomplete `country`: ISO alpha-2 letters + uppercase transform; reject invalid codes. |
| `tests/googleMaps.places-country.test.ts` | New focused A–M coverage. |
| `tests/googleMaps.mapper.test.ts` | `countryCode` mapping cases. |
| `tests/validators.passenger.test.ts` | Country accept / normalize / reject / omit. |
| `tests/route.service.test.ts` | US coordinates accepted; no country gate. |
| `RYDU_BACKEND_PASSENGER_PLACES_COUNTRY_VERIFICATION_REPORT.md` | This report. |

Passenger Flutter was not modified.

---

## 12. Tests / build

```
npx jest tests/googleMaps.places-country.test.ts tests/googleMaps.mapper.test.ts tests/validators.passenger.test.ts tests/route.service.test.ts --no-coverage
```

**4 suites, 38 tests, all passed.**

Coverage of the requested cases:

| Case | Result |
|------|--------|
| A. `country=BD` → `components=country:BD` | Pass |
| B. `country=US` → `components=country:US` | Pass |
| C. `bd` → `BD` | Pass |
| D. `us` → `US` | Pass |
| E. Invalid country rejected (validator); builder does not guess | Pass |
| F. Omitted country unrestricted | Pass |
| G. Reverse geocode BD → `countryCode=BD` | Pass |
| H. Reverse geocode US → `countryCode=US` | Pass |
| I. Place details preserves `countryCode` | Pass |
| J. No hardcoded US override | Pass |
| K. No hardcoded BD override | Pass |
| L. Dynamic lat/lng bias intact | Pass |
| M. Route preview has no hidden single-country restriction | Pass |

```
npx tsc --noEmit   # pass
npm run build      # pass (`tsc`)
```

---

## 13. Google API / provider limitations

- Legacy Autocomplete **does not return** `country` / `countryCode` on predictions. Flutter must use reverse-geocode or place details for `countryCode`.
- `components=country:XX` is a hard country restriction. `location` + `radius=50000` is a **bias**, not a hard radius clip. Both can be combined (Dhaka + `BD`, NYC + `US`).
- Conflicting pairs (Dhaka coords + `country=US`) are not rewritten by the backend; Google will restrict to the requested country and only bias toward the point.
- Routes API `regionCode` (default `BD`) may influence address interpretation if addresses are sent, but this backend sends lat/lng waypoints. It is not a US-block.
- `GOOGLE_MAPS_DEFAULT_COUNTRY` remains in config/env for compatibility but is unused by autocomplete after this fix.
- Places API (New) `includedRegionCodes` is not used and was not migrated.

---

## Final status

**RYDU BACKEND PASSENGER PLACES COUNTRY FIXED — BD + US SUPPORTED**

The request `country` parameter is honored for Bangladesh and the United States, lowercase codes normalize to ISO alpha-2, invalid codes are rejected without guessing, omitted country no longer silently forces BD, reverse-geocode and place-details preserve uppercase `countryCode`, and route preview accepts both BD and US coordinates.
