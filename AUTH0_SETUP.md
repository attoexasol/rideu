# Auth0 Management API Setup Guide

## Problem
Creating admin and super_admin users is failing because the Auth0 Management API is not configured.

## Solution

### Step 1: Create a Machine-to-Machine Application in Auth0

1. Go to your Auth0 Dashboard
2. Navigate to **Applications** → **Create Application**
3. Choose **Machine to Machine Applications**
4. Name it: `DriveWize Management API`
5. Select the **Auth0 Management API**
6. Grant these scopes (permissions):
   - `create:users`
   - `update:users`
   - `delete:users`
   - `update:users_app_metadata`
   - `create:users_app_metadata`
   - `read:roles`
   - `create:role_members`
   - `delete:role_members`
   - `update:roles`

### Step 2: Get the Credentials

After creating the application:
1. Go to the **Settings** tab
2. Copy the **Client ID** → This is your `AUTH0_MANAGEMENT_CLIENT_ID`
3. Copy the **Client Secret** → This is your `AUTH0_MANAGEMENT_CLIENT_SECRET`

### Step 3: Create Auth0 Roles (if not exists)

1. Go to **User Management** → **Roles**
2. Create three roles with these exact names:
   - `Driver`
   - `Admin`
   - `Super Admin`

### Step 4: Add Environment Variables

Add these to your backend `.env` file:

```env
# Existing Auth0 config (you should already have these)
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://api.drivewize.com
AUTH0_CLIENT_ID=your-client-id

# NEW: Auth0 Management API credentials
AUTH0_MANAGEMENT_CLIENT_ID=your-m2m-client-id
AUTH0_MANAGEMENT_CLIENT_SECRET=your-m2m-client-secret
```

### Step 5: Add to Railway/Production

In Railway or your production environment:

1. Go to your backend service
2. Navigate to **Variables**
3. Add:
   - `AUTH0_MANAGEMENT_CLIENT_ID` = (your M2M client ID)
   - `AUTH0_MANAGEMENT_CLIENT_SECRET` = (your M2M client secret)

### Step 6: Restart the Backend

After adding the environment variables, restart your backend service.

## Verification

Once configured, creating users will:
1. Create the user in Auth0 with password authentication
2. Assign the appropriate Auth0 role
3. Store the user in the database
4. Allow them to log in to the admin portal

## Troubleshooting

If user creation still fails:

1. **Check logs** for specific error messages
2. **Verify scopes** - Ensure your M2M app has all required permissions
3. **Check role names** - Auth0 roles must match exactly: `Driver`, `Admin`, `Super Admin`
4. **Test token** - Try the Management API Explorer in Auth0 Dashboard

## Security Notes

- **NEVER** commit the Management API credentials to git
- Keep the Client Secret secure
- Rotate credentials regularly
- Use different M2M apps for dev/staging/production