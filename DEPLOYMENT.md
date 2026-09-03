# 🚀 Render Deployment Guide

Complete guide for deploying VoteWeb to Render.

## Prerequisites

1. **Render Account** - Sign up at [render.com](https://render.com)
2. **Git Repository** - Push your code to GitHub/GitLab
3. **Render CLI** (optional) - Install with `npm install -g @render/compose-cli`

## Quick Deploy (Blueprint)

### Option 1: Using Render Blueprint (Recommended)

1. Push your code to GitHub/GitLab
2. Go to Render Dashboard → **New** → **Blueprint**
3. Connect your repository
4. Render will auto-detect `render.yaml` and create services
5. Configure environment variables as needed

### Option 2: Manual Setup

#### Step 1: Create PostgreSQL Database

1. Go to Render Dashboard → **New** → **PostgreSQL**
2. Name: `voteweb-db`
3. Plan: `basic-256mb` (the old `starter` DB plan is legacy and can no longer be created)
4. Click **Create Database**
5. Copy the **Internal Database URL**

#### Step 2: Create Backend Service

1. Go to Render Dashboard → **New** → **Web Service**
2. Connect your repository
3. Configure:
   - **Name**: `voteweb-backend`
   - **Runtime**: Node
   - **Plan**: Starter
   - **Root Directory**: `.` (or leave empty if at root)
   - **Build Command**: `npm install`
   - **Pre-Deploy Command**: `npm run migrate` (runs after build, before start — recommended for migrations)
   - **Start Command**: `node src/server.js`
4. Add Environment Variables:
   ```
   NODE_ENV=production
   PORT=10000
   DATABASE_URL=<your-database-url>
   SESSION_SECRET=<generate-with-node-e-console-log-require-crypto-randombytes-32-tostring-hex>
   TOTP_ENCRYPTION_KEY=<generate-with-node-e-console-log-require-crypto-randombytes-32-tostring-base64>
   COOKIE_SECURE=true
   DB_SSL=true
   CORS_ORIGIN=<frontend-url>
   FRONTEND_URL=<frontend-url>
   ```
5. Click **Create Web Service**

#### Step 3: Create Frontend Service

1. Go to Render Dashboard → **New** → **Web Service**
2. Connect your repository
3. Configure:
   - **Name**: `voteweb-frontend`
   - **Runtime**: Node
   - **Plan**: Starter
   - **Root Directory**: `voteweb-Frontend`
   - **Build Command**: `npm ci --include=dev && npm run build`
     > `--include=dev` is required: Render builds with `NODE_ENV=production`, which otherwise skips devDependencies (`typescript`, `tailwindcss`, `eslint`) and breaks `next build`.
   - **Start Command**: `npm start`
4. Add Environment Variables:
   ```
   NODE_ENV=production
   NEXT_PUBLIC_API_URL=<backend-url>
   NEXT_PUBLIC_APP_URL=<frontend-url>
   ```
5. Click **Create Web Service**

## Environment Variables

### Backend Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `production` |
| `PORT` | Server port | `10000` |
| `DATABASE_URL` | PostgreSQL connection | `postgres://user:pass@host:5432/db` |
| `SESSION_SECRET` | Session encryption key (32+ chars) | `openssl rand -hex 32` |
| `TOTP_ENCRYPTION_KEY` | MFA encryption key (32 bytes base64) | `openssl rand -base64 32` |
| `COOKIE_SECURE` | Enable secure cookies | `true` |
| `DB_SSL` | Enable database SSL | `true` |
| `CORS_ORIGIN` | Allowed frontend origin | `https://voteweb-frontend.onrender.com` |
| `FRONTEND_URL` | Frontend URL for redirects | `https://voteweb-frontend.onrender.com` |
| `SESSION_TTL_HOURS` | Session duration (hours) | `8` |

### Frontend Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `production` |
| `NEXT_PUBLIC_API_URL` | Backend API URL (the app appends `/api/v1` automatically, so the bare origin also works) | `https://voteweb-backend.onrender.com` |
| `NEXT_PUBLIC_APP_URL` | Frontend URL | `https://voteweb-frontend.onrender.com` |

## Generate Secure Keys

```bash
# Generate SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate TOTP_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Database Setup

Migrations run automatically via the **Pre-Deploy Command** on every deploy, so you don't need to run `npm run migrate` manually.

### ⚠️ Do NOT seed in production

The seed scripts create accounts with **publicly documented passwords** (`ADMIN001` / `AdminPassword123!`) and **disable admin MFA**.
They now refuse to run when `NODE_ENV=production` (override with `SEED_ALLOWED_IN_PROD=true` — not recommended).

If you must seed for testing:

```bash
# Connect to your Render shell
NODE_ENV=development node seed-auth.js
NODE_ENV=development node seed.js
```

Then **immediately change every seeded password** before making the site public.

## Post-Deployment Checklist

- [ ] Backend health check passes: `https://voteweb-backend.onrender.com/api/health`
- [ ] Database health check passes: `https://voteweb-backend.onrender.com/api/health/db`
- [ ] Frontend loads: `https://voteweb-frontend.onrender.com`
- [ ] `CORS_ORIGIN` / `FRONTEND_URL` were set during blueprint creation and match the frontend URL **exactly** (including `https://`)
- [ ] Login works with a **real** admin/student account (create one via the admin panel — don't rely on seeded test users)
- [ ] Cookies work between `*.onrender.com` subdomains (SameSite=Lax is fine because both are on `onrender.com`)
- [ ] SSL is enabled for all services
- [ ] No `.env`, `.env.production`, or `cookies.txt` files were pushed to GitHub

> **Custom domains:** if you later point the frontend and backend at custom domains on **different registrable domains**
> (e.g. `voteweb.com` and `voteweb-api.com`), cookies become cross-site and login will silently break.
> In that case, use the same domain for both (e.g. `app.voteweb.com` + `api.voteweb.com`) or switch cookies to `SameSite=None` + `Secure`.

## Test Credentials (After Seeding)

| Role | Identifier | Password |
|------|-----------|----------|
| Admin | `ADMIN001` | `AdminPassword123!` |
| Student | `STU001` | `StudentPassword123!` |
| Candidate | `CAN001` | `CandidatePassword123!` |

## Troubleshooting

### Common Issues

1. **CORS Errors**
   - Ensure `CORS_ORIGIN` matches your frontend URL exactly
   - Include `https://` protocol

2. **Database Connection Failed**
   - Check `DATABASE_URL` is correct
   - Ensure `DB_SSL=true` for Render PostgreSQL

3. **Session Issues**
   - Verify `SESSION_SECRET` is 32+ characters
   - Check `COOKIE_SECURE=true` for HTTPS

4. **Build Failures**
   - Check build logs in Render dashboard
   - Ensure all dependencies are in `package.json`

## Cost Estimate

| Service | Plan | Monthly Cost |
|---------|------|--------------|
| Backend | Starter | ~$7 |
| Frontend | Starter | ~$7 |
| Database | Starter | ~$7 |
| **Total** | | **~$21/month** |

## Scaling

For production traffic, consider:
- **Pro plan** for better performance
- **Auto-scaling** for traffic spikes
- **Redis** for session caching (instead of in-memory)
- **CDN** for static assets
