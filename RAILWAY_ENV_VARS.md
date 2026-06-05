# Railway Environment Variables

## Add these to Railway Backend Service

Go to your Railway backend service and add these environment variables:

### Auth0 Management API (REQUIRED for user creation)
```
AUTH0_MANAGEMENT_CLIENT_ID=rjWwtSrC1rWZwkgz2EpNetoVQGHLsJEN
AUTH0_MANAGEMENT_CLIENT_SECRET=0LeWmq9oH8nCVAtn5unhkkoEQUrZUkIT7qKIw-55J6jfryECf5VYT42hzm6hbe3u
```

### Mapbox (REQUIRED for road snapping)
```
MAPBOX_ACCESS_TOKEN=sk.eyJ1IjoibG91aXN4c2hlaWQiLCJhIjoiY21neG54ams0MG8zZjJpc2RseWNsbTl5YiJ9.NSnyhAwG2FJGqF9-Yti_kw
```

## How to Add in Railway

1. Go to https://railway.app
2. Select your project
3. Click on the **backend** service
4. Go to **Variables** tab
5. Click **+ New Variable**
6. Add each variable above
7. Railway will automatically redeploy

## Verify in Auth0

Make sure these roles exist in Auth0:
1. Go to Auth0 Dashboard → User Management → Roles
2. Create these exact role names if they don't exist:
   - `Driver`
   - `Admin`
   - `Super Admin`

## Test

After deployment, try creating a new admin user in the admin portal.
It should now work properly!