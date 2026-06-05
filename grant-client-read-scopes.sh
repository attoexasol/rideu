#!/bin/bash

# Grant read:clients scope to Management API client
# This allows us to query client information

set -e

source .env

echo "🔧 Granting read:clients scope to Management API client..."
echo ""

# Get the Management API resource server ID
MGMT_API_ID=$(curl -s --request GET \
  --url "https://${AUTH0_DOMAIN}/api/v2/resource-servers" \
  --header "authorization: Bearer $(curl -s --request POST \
    --url "https://${AUTH0_DOMAIN}/oauth/token" \
    --header 'content-type: application/json' \
    --data "{
      \"client_id\":\"${AUTH0_MANAGEMENT_CLIENT_ID}\",
      \"client_secret\":\"${AUTH0_MANAGEMENT_CLIENT_SECRET}\",
      \"audience\":\"https://${AUTH0_DOMAIN}/api/v2/\",
      \"grant_type\":\"client_credentials\"
    }" | jq -r '.access_token')" \
  | jq -r '.[] | select(.identifier == "https://'${AUTH0_DOMAIN}'/api/v2/") | .id')

echo "Management API Resource Server ID: $MGMT_API_ID"

# Get current client grants
echo ""
echo "📋 Current grants for client ${AUTH0_MANAGEMENT_CLIENT_ID}..."

# This needs to be done manually via the Auth0 Dashboard
echo ""
echo "⚠️  This script cannot programmatically grant scopes."
echo "    You need to do this manually in the Auth0 Dashboard:"
echo ""
echo "1. Go to: https://manage.auth0.com/dashboard/us/${AUTH0_DOMAIN}/applications"
echo "2. Click on your Management API client (${AUTH0_MANAGEMENT_CLIENT_ID})"
echo "3. Go to the 'APIs' tab"
echo "4. Find 'Auth0 Management API'"
echo "5. Grant these scopes:"
echo "   - read:clients"
echo "   - read:client_keys"
echo ""
echo "After granting scopes, run: node check-client-name.js"
