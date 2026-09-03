#!/bin/bash
set -e

echo "🚀 VoteWeb Deployment Started"

# Run database migrations
echo "📦 Running database migrations..."
npm run migrate

echo "✅ Migrations complete"

# Start the server
echo "🚀 Starting server..."
npm run start
