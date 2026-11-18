# Credential rotation checklist (DriveWize backend)

**Do not print secret values. Do not force-push or rewrite git history without an explicit security decision.**

## Confirmed exposures (remediated in working tree)

| Location | What was exposed | Status in repo |
|----------|------------------|----------------|
| `RAILWAY_ENV_VARS.md` | Auth0 Management client id/secret, Mapbox token | Replaced with placeholders |
| `src/scripts/seed-drivers.ts` | Auth0 domain/M2M secrets, Railway `DATABASE_URL` password | Now reads from environment only |

## Git history

Initial commits still contain historical copies of those secrets. Treat them as **compromised** until rotated, even after the working-tree fix.

## Rotate now (manual)

1. **Auth0 Management API (M2M)**
   - Auth0 Dashboard → Applications → M2M app → **Rotate** client secret.
   - Update production secret stores only (VPS `.env.production`, GitHub Environment `production`).
   - Recreate or rotate the M2M client if the Client ID itself was long-lived in public history.

2. **Mapbox token**
   - Mapbox account → Access tokens → revoke the leaked token → create a new restricted token.
   - Update env stores.

3. **Railway / any DB URL password** that appeared in `seed-drivers.ts` history
   - Rotate the database password on that host (or delete unused Railway DB).
   - Update any remaining consumers.

4. **JWT_SECRET / VIDEO_SIGNING_SECRET**
   - If these ever lived in committed `.env` history, rotate and re-issue sessions/signed URLs.

5. **Stripe**
   - Confirm no live secrets were committed (test placeholders in tests/docs are OK).
   - If any real `sk_live_` / `whsec_` ever leaked, roll keys in Stripe Dashboard.

6. **Firebase service account**
   - If a JSON key was ever committed under `secrets/`, delete the key in Google Cloud and issue a new one.

## After rotation

- [ ] Production `.env.production` updated on VPS
- [ ] GitHub Actions secrets / Environment `production` updated
- [ ] Auth0 M2M scopes re-verified (`AUTH0_SETUP.md`)
- [ ] Smoke: admin user create, maps call, Stripe test webhook
- [ ] Decide separately whether to purge git history (`git filter-repo`) — **not automated here**
