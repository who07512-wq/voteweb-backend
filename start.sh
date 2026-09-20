#!/bin/bash
set -e

echo "🚀 VoteWeb Deployment Started"

# Run database migrations (hardened: pre-destructive backup gate, fail-closed)
echo "📦 Running database migrations (policy: ALLOW_DESTRUCTIVE_MIGRATIONS=${ALLOW_DESTRUCTIVE_MIGRATIONS:-(default)})..."
# In production, destructive migrations require verified Appwrite snapshot — fail-closed if unavailable
npm run migrate

echo "✅ Migrations complete (verified backup gate passed if destructive pending)"

# Start the server
echo "🚀 Starting server..."
npm run start
