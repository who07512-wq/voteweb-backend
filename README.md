# VoteWeb Backend API

Express + PostgreSQL backend for **CampusVote (VoteWeb)** — an institute / college online voting platform. Owns all identity, authorization, election, and voting data.

| | |
|---|---|
| **Live API** | `https://voteweb-backend-api.onrender.com/api/v1` |
| **Repo** | `who07512-wq/voteweb-backend` — `main` auto-deploys to Render |
| **Frontend** | `who07512-wq/voteweb-frontend` (see `voteweb-frontend/README.md`) |

**Contents**

1. [Tech stack](#tech-stack)
2. [Project structure (file-by-file)](#project-structure)
3. [Environment variables](#environment-variables)
4. [Database (migrations + tables)](#database)
5. [Authentication & security model](#authentication--security)
6. [API route map](#api-route-map)
7. [Email (Brevo)](#email-brevo)
8. [Scripts](#scripts)
9. [Deployment](#deployment)
10. [Other docs in this repo](#other-docs)

---

## Tech stack

| Concern | Choice | Where |
|---|---|---|
| Runtime | Node.js (v18+) | `src/server.js` |
| Framework | Express 4 | `src/app.js` |
| Database driver | `pg` (PostgreSQL) | `src/db/index.js`, `src/config/database.js` |
| JWT (Clerk) verification | `jose` (JWKS) | `src/lib/clerkVerify.js` |
| Password hashing | Node `crypto` (scrypt-style) | `src/lib/password.js` |
| Session tokens | SHA-256 via `hashToken` | `src/lib/crypto.js` |
| TOTP / MFA | custom TOTP | `src/lib/totp.js`, `src/services/mfaService.js` |
| Email | Brevo (transactional) | `src/services/brevoService.js` |
| Rate limiting | `express-rate-limit` | `src/middleware/rateLimiter.js` |
| Headers / parsing | `helmet`, `cookie-parser`, `cors` | `src/app.js` |

## Project structure

```
voteweb-backend/
├── migrate.js                  # Migration runner (applies migrations/*.sql up/down/status/reset)
├── seed.js                     # Dev-only seed data
├── seed-auth.js                # Dev-only auth seed (accounts, sessions, OTPs)
├── check-votes.js              # Vote-integrity check script
├── start.sh                    # Production start wrapper (waits for DB health, then node src/server.js)
├── render.yaml / railway.json  # PaaS deploy configs
├── src/
│   ├── server.js               # Entry point: boots Express, handles SIGTERM/SIGINT graceful shutdown
│   ├── app.js                  # Express app: middleware stack + ALL route mounting
│   ├── config/
│   │   ├── index.js            # Reads env into a config object (PORT, NODE_ENV, DB, cookies, etc.)
│   │   └── database.js         # pg Pool options (ssl, pool min/max/…) from env
│   ├── db/index.js             # Singleton pg Pool + query() helper
│   ├── middleware/
│   │   ├── loadSession.js      # Loads the cv_sid cookie → attaches req.session (used on /auth/me)
│   │   ├── requireAuth.js      # 401 unless a valid session exists
│   │   ├── requireAdmin.js     # requireAuth + role==='ADMIN' (+ dev bypass via ALLOW_DEV_ADMIN)
│   │   ├── requireRole.js      # requireAuth + role allowlist
│   │   ├── csrfProtection.js   # Double-submit CSRF check (cv_csrf cookie ↔ X-CSRF-Token header)
│   │   └── rateLimiter.js      # loginLimiter, otpLimiter, registerLimiter, passwordResetLimiter, mfaLimiter
│   ├── lib/
│   │   ├── cookies.js          # Cookie-set/clear helpers (cv_sid, cv_csrf)
│   │   ├── crypto.js           # hashToken() (SHA-256), encrypt/decrypt helpers
│   │   ├── password.js         # hashPassword() / verifyPassword()
│   │   ├── totp.js             # TOTP generate/verify (admin MFA)
│   │   ├── sanitize.js         # Input sanitization helpers
│   │   ├── authDb.js           # Session/student/auth lookups + publicUser() shape
│   │   └── clerkVerify.js      # Verifies Clerk JWTs against the Clerk JWKS (no debug logging)
│   ├── routes/                 # Express routers (mounted in app.js — see route map below)
│   │   ├── auth.js             # Login/logout/OTP/MFA/register/reset — the big auth router
│   │   ├── clerkAuth.js        # Clerk JWT bridge: /clerk-session (auto-provisions STUDENT accounts)
│   │   ├── emailRecovery.js    # Public "can't access your registered email?" flow
│   │   ├── accessRequests.js   # Public voting-access request flow
│   │   ├── elections.js        # Public election list/detail
│   │   ├── announcements.js    # Public announcements (published only)
│   │   ├── positions.js        # Public positions read (note: PATCH is legacy/public)
│   │   ├── clubs.js            # Public clubs read (note: PATCH is legacy/public)
│   │   ├── candidates.js       # Public candidate read (PATCH: IDOR risk — see audit)
│   │   ├── candidateApplications.js  # Student candidate-application flow (/api/candidates)
│   │   ├── votes.js            # Eligibility + cast vote (+ results), mounted under /api/v1/elections
│   │   ├── notifications.js    # Authenticated user notifications
│   │   ├── support.js          # User support requests
│   │   ├── receipts.js         # Public receipt verification (receipt hash is the secret)
│   │   ├── cad.js              # CAD (election monitor) endpoints under /api/v1/cad
│   │   ├── authorization.js    # GET /api/v1/authorizations/:id (public read)
│   │   ├── debug.js            # ⚠️ NOT mounted in app.js — dead code
│   │   └── admin*.js           # All admin routers (each mounted behind requireAdmin):
│   │       admin.js, adminStudents.js, adminElections.js, adminClubs.js,
│   │       adminPositions.js, adminCandidates.js, adminCandidateApplications.js,
│   │       adminAuthorization.js, adminAnnouncements.js, adminSupport.js,
│   │       adminEmailRecovery.js, adminAccessRequests.js
│   ├── controllers/            # Route handlers (thin: validation → service calls)
│   │   ├── studentController.js, electionController.js, voteController.js,
│   │   ├── candidateController.js, candidateApplicationController.js,
│   │   ├── clubController.js, positionController.js,
│   │   ├── authorizationController.js, announcementController.js,
│   │   ├── supportController.js, notificationController.js,
│   │   ├── adminStats.js, adminAuditLogs.js, adminAnnouncementController.js,
│   │   └── adminSupportController.js
│   └── services/               # Business logic + all SQL
│       ├── sessionService.js   # createSession → sets cv_sid + cv_csrf cookies
│       ├── mfaService.js       # TOTP challenge lifecycle (/mfa/*)
│       ├── otpService.js       # OTP challenge create/verify (email OTP login + reset)
│       ├── brevoService.js     # Sends transactional email via Brevo
│       ├── studentService.js   # Students CRUD, deactivate, role changes
│       ├── electionService.js  # Elections CRUD, status transitions (DRAFT→SCHEDULED→OPEN→CLOSED→PUBLISHED), results gating
│       ├── candidateService.js # Candidates CRUD (ballot rows)
│       ├── candidateApplicationService.js  # Candidate applications + approve/reject
│       ├── authorizationService.js         # Voter-authorization rows/eligibility
│       ├── voteService.js      # Cast/verify/aggregate votes (single vote per position per voter)
│       ├── receiptService.js   # Vote receipts (hash, verify, history)
│       ├── announcementService.js, supportService.js, notificationService.js,
│       ├── accessRequestService.js, clubService.js, positionService.js
├── migrations/                 # One .sql file per schema change (see Database)
└── test/
    ├── api.test.js             # node --test API tests
    └── helpers.js
```

## Environment variables

See `.env.example`. Key variables:

| Variable | Purpose |
|---|---|
| `PORT`, `NODE_ENV` | Server port; `production` disables debug endpoints & dev admin bypass |
| `DATABASE_URL` | PostgreSQL connection string (production) — or `DB_HOST/PORT/NAME/USER/PASSWORD` + `DB_SSL` |
| `SESSION_SECRET` | Used for session-token handling — **required in production** |
| `TOTP_ENCRYPTION_KEY` | Encrypts TOTP MFA secrets — **required in production** |
| `OTP_SECRET` | Hashes OTP codes |
| `COOKIE_SECURE`, `COOKIE_SAMESITE` | Cookie attributes (Secure + SameSite=None for the cross-site Vercel↔Render setup) |
| `CORS_ORIGIN` | Allowed frontend origins (comma-separated) |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | Transactional email |
| `ALLOW_DEV_ADMIN` | Dev-only admin bypass — never true in production |
| `CLERK_ISSUER`, `CLERK_SECRET_KEY` | Clerk JWT verification config (see `clerkVerify.js`) |

> Local dev relies on `dv` run with `npm run dev`. Never commit `.env`.

## Database

The schema is applied by `npm run migrate` (`node migrate.js up`). Migrations (in order):

| Migration | Adds / changes |
|---|---|
| `001_elections.sql` | `elections` table |
| `002_students.sql` | `students` (name, email, role, is_active, …) |
| `003_clubs.sql` | `clubs` |
| `004_positions.sql` | `positions` (name, club_id, display_order, is_active) |
| `005_candidates.sql` | `candidates` (ballot rows) |
| `006_voter_authorizations.sql` | `voter_authorizations` / eligibility |
| `007_votes.sql` | `votes` + `UNIQUE(student_id, election_id, position_id)` |
| `008_audit_logs.sql` | `audit_logs` |
| `013_create_vote_receipts.sql` | `vote_receipts` |
| `014_create_announcements.sql` | `announcements` |
| `015_create_support_requests.sql` | `support_requests` |
| `016_create_notifications.sql` | `notifications` |
| `017_add_results_columns.sql` | `results_published_at` etc. on elections |
| `018_add_published_status.sql` | `election_status` value `PUBLISHED` (`ALTER TYPE ... ADD VALUE`) |
| `019_fix_elections_status_constraint.sql` | Elections status constraint fixes |
| `020_authentication.sql` | Auth/`sessions`/MFA-related tables |
| `021_candidate_applications.sql` | `candidate_applications` (status: draft/submitted/under_review/changes_requested/approved/rejected) |
| `021_otp_challenges.sql` | `otp_challenges` (purpose, target_role, email, otp_hash, expires_at, attempts, rate_key) |
| `022_add_username_mobile.sql` | username/mobile columns |
| `023_candidate_application_extra_fields.sql` | Extended application fields (manifesto, campaign, etc.) |
| `024_student_identity_email_recovery.sql` | Identity/email-recovery support |
| `025_student_access_requests.sql` | `student_access_requests` (status: pending/…) |
| `026_cad_role.sql` | CAD role enums |
| `027_nomination_club_position.sql` | Nomination ↔ club/position |
| `028_profile_photo_text.sql` | Profile photo (text) column |

> ⚠️ Known issue: `018`/`019` run `ALTER TYPE ... ADD VALUE` **inside a transaction** (migrate.js wraps each file). PostgreSQL forbids that, so a *fresh* database boot can fail at 018. The live DB was applied historically; a clean re-deploy would hit this.

## Authentication & security

- **Sessions:** login sets `cv_sid` (httpOnly) + `cv_csrf` cookies on the API origin (`sessionService.createSession`). `loadSession` resolves `cv_sid` → `sessions` row.
- **CSRF:** double-submit — every state-changing request must send `X-CSRF-Token` matching `cv_csrf`. Issued via `GET /api/v1/auth/csrf`.
- **Session binding:** authenticated writes send `X-Session-Binding` (held client-side), checked by the auth middleware.
- **Roles** come only from `students.role` — never from the client. `requireAdmin`/`requireRole` enforce this server-side. (Dev bypass `ALLOW_DEV_ADMIN` only when `!production`.)
- **MFA:** admin users can enroll TOTP (`/mfa/setup`, `/mfa/verify-setup`) via `mfaService` + `totp.js`.
- **Debug endpoints:** every `/api/debug/*` route returns `403 {"error": "Not available in production"}` when `NODE_ENV=production` (logout of dev-only helpers like `test-register`, `sessions/:id`, `otp-code`).
- **Vote integrity:** `votes` row UNIQUE(student_id, election_id, position_id) guarantees one vote per position at the DB level.
- **Rate limiting:** login, OTP, register, password-reset, and MFA endpoints are rate-limited (`rateLimiter.js`).

## API route map

Mounts are defined in `src/app.js`. Read-access rows (elections, positions, clubs, candidates, announcements, receipts) are public by design; everything sensitive is behind `requireAuth` / `requireAdmin`.

| Mount | Router file | Notable endpoints |
|---|---|---|
| `/api/health`, `/api/health/db`, `/api/health/brevo` | `app.js` inline | Liveness checks |
| `/api/v1/auth` | `auth.js` | `GET /csrf`, `GET /me`, `POST /login`, `POST /admin-portal-login`, `POST /logout`, OTP login/reset (`/otp/send-login`, `/otp/verify-login`, `/otp/send-reset`, …), `/mfa/setup` ⁄ `/mfa/verify` ⁄ `/mfa/verify-setup`, `/change-password`, `POST /register`, `/register/instant`, `/register/clerk`, `/forgot-password/clerk` |
| `/api/v1/auth` | `clerkAuth.js` | `POST /clerk-session` (Clerk JWT → backend session) |
| `/api/v1/auth` | `emailRecovery.js` | Email-recovery endpoints |
| `/api/v1/access-requests` | `accessRequests.js` | Public voting-access requests |
| `/api/v1/elections` | `elections.js` | Election list/detail (public read) |
| `/api/v1/elections/:id/eligibility` | `app.js` inline + `voteRoutes` | Eligibility check (authenticated) |
| `/api/v1/elections` (votes) | `votes.js` | Cast vote, results (results gated by `results_published_at`) |
| `/api/v1/announcements` | `announcements.js` | Published announcements |
| `/api/v1/elections/:id/clubs`, `/api/v1/clubs/:id/positions`, `/api/v1/positions/:id/candidates` | `app.js` inline | Public relation reads |
| `/api/v1/positions`, `/api/v1/clubs`, `/api/v1/candidates` | `positions.js`, `clubs.js`, `candidates.js` | Public reads (⚠️ legacy public PATCH handlers exist — see audit) |
| `/api/candidates` | `candidateApplications.js` | Student candidate application submit/my |
| `/api/v1/authorizations/:id` | `authorization.js` | Public read (⚠️ IDOR risk — see audit) |
| `/api/v1/receipts` | `receipts.js` | Public receipt verification |
| `/api/v1/notifications`, `/api/v1/support` | `notifications.js`, `support.js` | Authenticated user features |
| `/api/v1/cad` | `cad.js` | CAD (election monitor) |
| `/api/v1/admin/*` (each) | `admin*.js` | All behind `requireAdmin` — students, elections, clubs, positions, candidates, candidate-applications, authorizations, announcements, support, email-recovery, access-requests, stats, audit-logs, readiness |
| `/api/v1/admin/stats` | `adminStats.js` | Static dashboard stats (`GET`, `requireAdmin`) |
| `/api/v1/admin/live` | `adminLiveResults.js` | **Real-time** dashboard snapshot (`GET /live`, `requireAdmin`) — `{ stats, leaderboard, generatedAt }`. Stats mirror the admin-stats queries; `leaderboard` is the top 10 active candidates by vote count across all active elections (JOINs candidates → positions → clubs/constituencies → elections → votes). Powers the admin dashboard's live polling (4s) and results chart. |

**Known audit findings (fixed / open):**
- ✅ Fixed: all `/api/debug/*` endpoints production-guarded (commits `705b0b1`, `6d81037`).
- ⚠️ Open: public `PATCH` on `positions`/`clubs`; `GET /api/v1/authorizations/:id` IDOR; `GET /api/v1/elections` returns DRAFT/SCHEDULED; CAD results query references non-existent `positions.max_selections` (500); candidate approval doesn't create a `candidates` ballot row; `adminStats` `pendingApps` counts a nonexistent status. See `SECURITY-ASSESSMENT-REPORT.md`.

## Email (Brevo)

`brevoService.js` sends transactional email (OTP codes, registration, receipts, recovery). Configured via `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`. Check config with `GET /api/health/brevo`.

## Scripts

```bash
npm run dev              # node --watch src/server.js
npm start                # node src/server.js
npm run migrate          # node migrate.js up
npm run migrate:status   # node migrate.js status
npm run migrate:down     # node migrate.js down
npm run migrate:reset    # node migrate.js reset
npm run seed             # node seed.js
npm test                 # node --test test/**/*.test.js
```

## Deployment

- **Render** (production): auto-deploys from `main` — build `npm install`, start `npm run migrate && node src/server.js`. See `render.yaml`.
- **Railway**: `railway.json` legacy config for `vote-main`.
- On deploy, `npm run migrate` applies pending migrations; the server waits for DB health (see `start.sh`).

## Other docs

- `INVITE-ONLY-LOGIN.md` — complete authentication & invite-only access guide.
- `SETUP.md`, `DEPLOYMENT.md` — environment setup and deployment walkthroughs.
- `SECURITY-ASSESSMENT-REPORT.md`, `SECURITY-TESTING.md` — security review / testing notes.
- `docs/FEATURE-GAP-REPORT.md`, `docs/STEP13-REPORT.md` — feature & roadmap reports.
- `RENDER-MCP.md` — Render MCP usage notes.