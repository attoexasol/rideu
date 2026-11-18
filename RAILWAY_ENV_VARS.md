# Railway / Hosting Environment Variables

## Add these to your backend service variables

Use your own Auth0 Management API and Mapbox credentials. **Never commit real secret values.**

### Auth0 Management API (REQUIRED for user creation)

```
AUTH0_MANAGEMENT_CLIENT_ID=<your-m2m-client-id>
AUTH0_MANAGEMENT_CLIENT_SECRET=<your-m2m-client-secret>
```

Create a Machine-to-Machine application in Auth0 with Management API scopes
(`create:users`, `update:users`, `delete:users`, `read:roles`, `create:role_members`, etc.).
See `AUTH0_SETUP.md`.

### Mapbox (REQUIRED for road snapping / admin map)

```
MAPBOX_ACCESS_TOKEN=<your-mapbox-secret-or-token>
```

## How to Add

1. Open your host dashboard (Railway, VPS env file, or GitHub Environment secrets).
2. Select the **backend** service / staging env.
3. Add each variable with values from Auth0 / Mapbox dashboards (not from git).
4. Redeploy / restart the backend.

## Verify in Auth0

Ensure these roles exist:

- `Driver`
- `Admin`
- `Super Admin`

## Security

- Rotate any credentials that were previously committed to git (see
  `docs/docker/CREDENTIAL_ROTATION_CHECKLIST.md`).
- Prefer separate M2M apps and Mapbox tokens for staging vs production.
