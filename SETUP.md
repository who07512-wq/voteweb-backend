# 📋 VoteWeb Complete Setup Guide

Everything you need to set up, run, test, and deploy VoteWeb.

---

## 🏗️ Project Structure

```
voteweb/
├── src/                    # Backend (Node.js/Express)
│   ├── app.js              # Main Express app
│   ├── server.js           # Server entry point
│   ├── config/             # Configuration
│   ├── controllers/        # Route handlers
│   ├── middleware/          # Auth, CSRF, rate limiting
│   ├── routes/             # API routes
│   ├── services/           # Business logic
│   ├── lib/                # Utilities (crypto, sanitize, cookies)
│   └── db/                 # Database connection
├── test/                   # Backend tests
├── migrations/             # Database migrations
├── voteweb-Frontend/       # Frontend (Next.js 16)
│   └── src/
│       ├── app/            # Pages (52 static + 3 dynamic)
│       ├── components/     # React components
│       └── lib/            # API client, auth, utilities
├── render.yaml             # Render deployment blueprint
├── DEPLOYMENT.md           # Production deployment guide
└── SECURITY-TESTING.md     # Security test cases
```

---

## 🚀 Quick Start (Local Development)

### Prerequisites

- **Node.js** v22+ 
- **PostgreSQL** 17+ (running on port 5434)
- **npm** 10+

### Step 1: Database Setup

```bash
# Create database
psql -U postgres -p 5434 -c "CREATE DATABASE voteweb;"
psql -U postgres -p 5434 -c "CREATE USER voteweb WITH PASSWORD 'voteweb';"
psql -U postgres -p 5434 -c "GRANT ALL PRIVILEGES ON DATABASE voteweb TO voteweb;"
```

### Step 2: Backend Setup

```bash
cd voteweb

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database credentials

# Run migrations
npm run migrate

# Seed test data
node seed.js
node seed-auth.js

# Start backend (port 3000)
npm run dev
```

### Step 3: Frontend Setup

```bash
cd voteweb-Frontend

# Install dependencies
npm install

# Start frontend (port 3001)
npm run dev
```

### Step 4: Verify

```bash
# Backend health check
curl http://localhost:3000/api/health

# Database health check
curl http://localhost:3000/api/health/db

# Frontend
open http://localhost:3001
```

---

## 🔐 Test Credentials

### Authentication Users

| Role | Identifier | Password | Notes |
|------|-----------|----------|-------|
| **Admin** | `ADMIN001` | `AdminPassword123!` | Requires MFA (TOTP) |
| **Student** | `STU001` | `StudentPassword123!` | No MFA |
| **Candidate** | `CAN001` | `CandidatePassword123!` | No MFA |

### Seed Data Students

| External ID | Name | Email |
|-------------|------|-------|
| `STU-001` | Alice Johnson | alice@example.edu |
| `STU-002` | Bob Smith | bob@example.edu |
| `STU-003` | Carol Williams | carol@example.edu |
| `STU-004` | David Brown | david@example.edu |
| `STU-005` | Eva Martinez | eva@example.edu |

### Password Policy

```
✅ Minimum 8 characters
✅ At least one uppercase letter
✅ At least one lowercase letter
✅ At least one number
✅ At least one special character (!@#$%^&*)
❌ Cannot contain student identifier
```

**Valid passwords:**
- `AdminPassword123!`
- `StudentPassword123!`
- `CandidatePassword123!`
- `P@ssw0rd!2026`

**Invalid passwords:**
- `password` (too short, no uppercase, no number)
- `12345678` (no letters)
- `ADMIN001!` (contains student identifier)

---

## 🌐 Environment Configuration

### Backend (.env)

```bash
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgres://voteweb:voteweb@localhost:5434/voteweb

# Security - Session
SESSION_SECRET=dev-only-session-secret-change-in-prod
SESSION_TTL_HOURS=8

# Security - MFA/TOTP
TOTP_ENCRYPTION_KEY=null

# Security - Cookies
COOKIE_SECURE=false

# CORS
CORS_ORIGIN=http://localhost:3001
FRONTEND_URL=http://localhost:3001

# Dev Only
ALLOW_DEV_ADMIN=false
```

### Frontend (.env.local)

```bash
NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1
NEXT_PUBLIC_APP_URL=http://localhost:3001
```

---

## 🧪 Running Tests

### Backend Tests

```bash
cd voteweb
npm test
# Expected: 31/31 tests pass
```

### Frontend Type Check

```bash
cd voteweb/voteweb-Frontend
npx tsc --noEmit
# Expected: 0 errors
```

### Frontend Build

```bash
cd voteweb/voteweb-Frontend
npm run build
# Expected: All 52 static + 3 dynamic pages built
```

### Frontend Lint

```bash
cd voteweb/voteweb-Frontend
npm run lint
# Expected: 0 warnings/errors
```

---

## 📡 API Endpoints

### Health Check (No Auth)

```bash
GET /api/health
GET /api/health/db
```

### Authentication

```bash
# Get CSRF token
GET /api/v1/auth/csrf

# Login (no MFA)
POST /api/v1/auth/login
Body: {"userIdentifier": "STU001", "password": "StudentPassword123!"}

# Login (requires MFA)
POST /api/v1/auth/login
Body: {"userIdentifier": "ADMIN001", "password": "AdminPassword123!"}

# Verify MFA
POST /api/v1/auth/mfa/verify
Body: {"mfaChallenge": "...", "code": "123456"}

# Logout
POST /api/v1/auth/logout

# Get current user
GET /api/v1/auth/me

# Change password
POST /api/v1/auth/change-password
Body: {"currentPassword": "OldPass123!", "newPassword": "NewPass123!"}

# Register
POST /api/v1/auth/register
Body: {"fullName": "Name", "email": "user@college.edu", "studentIdentifier": "STU-NEW", "password": "Pass123!"}
```

### Public Resources

```bash
GET /api/v1/elections
GET /api/v1/elections/:id
GET /api/v1/elections/:id/clubs
GET /api/v1/clubs/:id/positions
GET /api/v1/positions/:id/candidates
GET /api/v1/candidates
GET /api/v1/candidates/:id
GET /api/v1/announcements
GET /api/v1/receipts/:uuid
```

### Student Routes (Auth Required)

```bash
GET /api/v1/elections/:id/eligibility
GET /api/v1/elections/:id/votes/check
POST /api/v1/elections/:id/votes
GET /api/v1/elections/:id/votes/receipt
GET /api/v1/notifications
POST /api/v1/notifications/:id/read
POST /api/v1/notifications/mark-all-read
POST /api/v1/support
GET /api/v1/support
GET /api/v1/support/:id
```

### Admin Routes (Admin Auth Required)

```bash
GET /api/v1/admin/students
POST /api/v1/admin/students
PATCH /api/v1/admin/students/:id
PATCH /api/v1/admin/students/:id/status

GET /api/v1/admin/elections
POST /api/v1/admin/elections
PATCH /api/v1/admin/elections/:id
PATCH /api/v1/admin/elections/:id/status
POST /api/v1/admin/elections/:id/publish

POST /api/v1/admin/elections/:id/clubs
PATCH /api/v1/admin/clubs/:id

POST /api/v1/admin/clubs/:id/positions
PATCH /api/v1/admin/positions/:id

POST /api/v1/admin/positions/:id/candidates
PATCH /api/v1/admin/candidates/:id

GET /api/v1/admin/elections/:id/authorizations
POST /api/v1/admin/elections/:id/authorizations
PATCH /api/v1/admin/authorizations/:id
DELETE /api/v1/admin/authorizations/:id

GET /api/v1/admin/announcements
POST /api/v1/admin/announcements
PATCH /api/v1/admin/announcements/:id
DELETE /api/v1/admin/announcements/:id

GET /api/v1/admin/support
GET /api/v1/admin/support/:id
PATCH /api/v1/admin/support/:id
```

---

## 🔒 Security Features

### Authentication & Session

| Feature | Status | Implementation |
|---------|--------|----------------|
| Password hashing | ✅ | bcrypt |
| Session tokens | ✅ | Random, hashed with HMAC-SHA256 |
| Session binding | ✅ | X-Session-Binding header |
| Session expiry | ✅ | Configurable (default 8 hours) |
| Account lockout | ✅ | 5 attempts, 15 min lockout |
| MFA/TOTP | ✅ | AES-256-GCM encrypted secrets |

### CSRF Protection

| Feature | Status | Implementation |
|---------|--------|----------------|
| Double-submit cookie | ✅ | Timing-safe comparison |
| CSRF on mutations | ✅ | All POST/PATCH/DELETE routes |
| CSRF on admin routes | ✅ | Announcements, support, candidates, positions |

### Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| Login | 30 attempts | 15 minutes |
| MFA | 20 attempts | 5 minutes |
| Registration | 5 attempts | 1 hour |
| Voting | 10 votes | 1 minute |

### Input Validation

| Feature | Status | Implementation |
|---------|--------|----------------|
| SQL injection | ✅ | Parameterized queries |
| XSS prevention | ✅ | React auto-escape + server sanitization |
| Input length limits | ✅ | Title: 200, Message: 2000, Description: 5000 |
| Email validation | ✅ | Regex pattern |
| Password policy | ✅ | Minimum 8 chars, uppercase, lowercase, number, special |

### Headers & Transport

| Feature | Status | Implementation |
|---------|--------|----------------|
| Security headers | ✅ | Helmet.js |
| CORS | ✅ | Configurable origins |
| HttpOnly cookies | ✅ | Session and CSRF |
| SameSite cookies | ✅ | Lax |
| Secure cookies | ✅ | Production only |

---

## 🚀 Render Deployment

### Quick Deploy

1. Push code to GitHub
2. Go to Render Dashboard → **New** → **Blueprint**
3. Connect repository (render.yaml auto-detected)
4. Configure environment variables
5. Deploy!

### Environment Variables for Production

```bash
# Backend
NODE_ENV=production
PORT=10000
DATABASE_URL=<render-postgres-url>
SESSION_SECRET=<32-char-hex-string>
TOTP_ENCRYPTION_KEY=<32-byte-base64-string>
COOKIE_SECURE=true
DB_SSL=true
CORS_ORIGIN=https://your-frontend.onrender.com
FRONTEND_URL=https://your-frontend.onrender.com

# Frontend
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://your-backend.onrender.com/api/v1
NEXT_PUBLIC_APP_URL=https://your-frontend.onrender.com
```

### Generate Secure Keys

```bash
# SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# TOTP_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Post-Deploy Commands

```bash
# Run in Render shell
npm run migrate
node seed-auth.js
node seed.js
```

### Cost Estimate

| Service | Plan | Monthly |
|---------|------|---------|
| Backend | Starter | ~$7 |
| Frontend | Starter | ~$7 |
| Database | Starter | ~$7 |
| **Total** | | **~$21/month** |

---

## 🐛 Known Issues & Fixes

### Fixed Issues

| Issue | Fix | Status |
|-------|-----|--------|
| Broken link `/help` on login | Changed to `/student/help` | ✅ Fixed |
| Broken link `/admin/support` | Changed to `/admin/issues` | ✅ Fixed |
| Vote API hardcoded dates | Removed, uses dynamic election data | ✅ Fixed |
| Register page mock | Now calls real API endpoint | ✅ Fixed |
| Receipt page 404 | Checks vote status before fetching receipt | ✅ Fixed |
| Profile page auth error | Redirects to login if not authenticated | ✅ Fixed |
| Hydration mismatch on /500 | Uses useState + useEffect for date | ✅ Fixed |
| Vestigial /api/vote routes | Deleted (unused by any page) | ✅ Fixed |
| Missing CSRF on admin routes | Added to announcements, support, candidates, positions | ✅ Fixed |
| Duplicate candidateRoutes | Removed duplicate declaration in app.js | ✅ Fixed |

### Remaining Items

| Item | Status | Notes |
|------|--------|-------|
| Admin MFA testing | ⏳ Blocked | Needs real TOTP secret |
| Candidate profile editing API | ⏳ Pending | Backend endpoint needed |
| Activity log API | ⏳ Pending | Backend endpoint needed |
| Account deletion API | ⏳ Pending | Backend endpoint needed |

---

## 📊 Page Inventory

### Public Pages (7)

| Route | Description |
|-------|-------------|
| `/login` | User login |
| `/register` | New account registration |
| `/forgot-password` | Password reset request |
| `/reset-password` | Password reset form |
| `/maintenance` | Maintenance notice |
| `/session-expired` | Session expired |
| `/verify/[receiptId]` | Public receipt verification |

### Student Pages (15)

| Route | Description |
|-------|-------------|
| `/student/dashboard` | Student dashboard |
| `/student/vote` | Cast vote |
| `/student/vote/review` | Review ballot |
| `/student/vote/success` | Vote success |
| `/student/candidates` | View candidates |
| `/student/candidates/[id]` | Candidate profile |
| `/student/candidates/compare` | Compare candidates |
| `/student/results` | Election results |
| `/student/guidelines` | Election guidelines |
| `/student/receipt` | Vote receipt |
| `/student/profile` | User profile |
| `/student/settings` | Settings |
| `/student/settings/security` | Security settings |
| `/student/help` | Help center |
| `/student/help/report` | Report issue |
| `/student/help/requests` | Support requests |
| `/student/help/request/[id]` | Request detail |

### Candidate Pages (7)

| Route | Description |
|-------|-------------|
| `/candidate/dashboard` | Candidate dashboard |
| `/candidate/profile` | Edit profile |
| `/candidate/campaign` | Manage campaign |
| `/candidate/manifesto` | Edit manifesto |
| `/candidate/preview` | Preview profile |
| `/candidate/status` | Application status |
| `/candidate/settings` | Settings |

### Admin Pages (12)

| Route | Description |
|-------|-------------|
| `/admin/dashboard` | Admin dashboard |
| `/admin/election` | Election management |
| `/admin/announcements` | Announcements |
| `/admin/candidates` | Candidate management |
| `/admin/positions` | Position management |
| `/admin/students` | Student management |
| `/admin/reports` | Reports |
| `/admin/results` | Results management |
| `/admin/issues` | Support issues |
| `/admin/activity` | Activity log |
| `/admin/schedule` | Schedule |
| `/admin/settings` | Settings |

### Error Pages (4)

| Route | Description |
|-------|-------------|
| `/403` | Access denied |
| `/404` | Not found |
| `/500` | Server error |
| `/unauthorized` | Unauthorized |

---

## 📚 Additional Documentation

- [DEPLOYMENT.md](./DEPLOYMENT.md) - Render deployment guide
- [SECURITY-TESTING.md](./SECURITY-TESTING.md) - Security test cases
- [SECURITY-ASSESSMENT-REPORT.md](./SECURITY-ASSESSMENT-REPORT.md) - Security assessment

---

*Last updated: August 2026*
