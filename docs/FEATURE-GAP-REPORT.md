# FEATURE GAP ANALYSIS - Step 13

## Phase 1: Frontend Feature Inventory

### Public Pages
- `/login` - Role-based authentication (student/candidate/admin)
- `/register` - Student registration
- `/forgot-password` / `/reset-password` - Password reset
- `/verify/[receiptId]` - Public vote verification
- Error pages (403, 404, 500, account-locked, session-expired, maintenance)

### Student Pages (17 pages)
- `/student/dashboard` - Overview with election status
- `/student/vote/*` - Voting flow (select, review, confirm, success)
- `/student/candidates/*` - Browse, compare, view profiles
- `/student/receipt` - Vote receipt
- `/student/results` - Election results
- `/student/profile` - Student profile
- `/student/settings` - Settings
- `/student/notifications` - Notification center
- `/student/help/*` - Help center and support requests
- `/student/guidelines` - Voting guidelines
- `/student/history` - Voting history

### Candidate Pages (7 pages)
- `/candidate/dashboard` - Campaign overview
- `/candidate/profile` - Campaign profile
- `/candidate/manifesto` - Manifesto management
- `/candidate/campaign` - Campaign details
- `/candidate/preview` - Profile preview
- `/candidate/status` - Application status
- `/candidate/settings` - Settings

### Admin Pages (15 pages)
- `/admin/dashboard` - Admin overview
- `/admin/election` - Election management
- `/admin/students` - Student management
- `/admin/candidates` - Candidate management
- `/admin/positions` - Position management
- `/admin/results` - Results management
- `/admin/announcements` - Announcement management
- `/admin/activity` - Activity log
- `/admin/issues` - Support issue management
- `/admin/reports` - Reports
- `/admin/schedule` - Schedule management
- `/admin/settings` - Admin settings

---

## Phase 2: Feature Classification

### 1. ALREADY SUPPORTED BY BACKEND ✅

| Feature | Backend Status |
|---------|----------------|
| Election CRUD | ✅ Full support |
| Club management | ✅ Full support |
| Position management | ✅ Full support |
| Candidate management | ✅ Full support |
| Voter authorization | ✅ Full support |
| Vote submission | ✅ Full support |
| Health endpoints | ✅ Implemented |
| Pagination | ✅ Implemented |
| Audit logging | ✅ Implemented |
| Security headers | ✅ Helmet + CORS |

### 2. NEEDS FRONTEND CONNECTION ONLY 🔌

| Feature | Notes |
|---------|-------|
| Login page UI | UI ready, needs API connection |
| Registration UI | UI ready, needs API connection |
| Admin dashboard data display | UI ready, needs API integration |
| Student dashboard display | UI ready, needs API integration |
| Candidate listing | UI ready, needs API connection |
| Voting flow UI | UI ready, needs real API calls |
| Results display | UI ready, needs API integration |

### 3. NEEDS NEW BACKEND FEATURE 🚨

| Feature | Priority | Description |
|---------|----------|-------------|
| Vote Receipts | HIGH | Store and retrieve vote receipts with hash |
| Announcements | HIGH | Create/manage public announcements |
| Support/Issues | HIGH | Student support ticket system |
| Notifications | MEDIUM | User notification system |
| Student Profile | MEDIUM | Student profile management |
| Candidate Profile | MEDIUM | Candidate-specific profile fields |
| Activity Log API | MEDIUM | Query audit logs via API |
| Password Reset | LOW | Forgot/reset password flow |
| Public Vote Verification | LOW | Verify vote receipt by ID |

### 4. FRONTEND MOCK/DEMO LOGIC TO REPLACE 🔴

| Location | Issue |
|----------|-------|
| `/src/lib/vote-store.ts` | In-memory vote store - MUST replace with API |
| `/src/lib/mock-auth.ts` | Hardcoded credentials - MUST replace with API |
| `/src/lib/election-data.ts` | Mock election data - MUST use backend |
| `/src/lib/results-data.ts` | Mock results - MUST use backend |
| `/src/lib/admin-dashboard-data.ts` | Mock admin data - MUST use API |
| `/src/lib/candidate-data.ts` | Mock candidate data - MUST use API |
| `/src/lib/notification-data.ts` | Mock notifications - MUST use API |
| `/src/lib/help-data.ts` | Mock help data - MUST use API |
| `/src/app/api/vote/route.ts` | Frontend API route - MUST connect to backend |
| `/src/app/api/receipt/route.ts` | Frontend receipt API - MUST connect to backend |

---

## Phase 3: Backend Features to Implement

### 1. VOTE RECEIPTS (HIGH)
**Database Table: `vote_receipts`**
- `id` (UUID, PK)
- `vote_id` (FK to votes)
- `receipt_hash` (SHA256 hash)
- `nullifier` (random string for privacy)
- `created_at`

**API Endpoints:**
- `GET /api/v1/votes/:voteId/receipt` - Get receipt for a vote
- `GET /api/v1/verify/:receiptId` - Public verification endpoint

### 2. ANNOUNCEMENTS (HIGH)
**Database Table: `announcements`**
- `id` (PK)
- `election_id` (FK, nullable for system-wide)
- `title`
- `message`
- `audience` (student/candidate/admin/all)
- `status` (draft/scheduled/published/archived)
- `publish_date`
- `created_by`
- `created_at`, `updated_at`

**API Endpoints:**
- `GET /api/v1/announcements` - List announcements
- `POST /api/v1/admin/announcements` - Create announcement
- `PATCH /api/v1/admin/announcements/:id` - Update announcement
- `DELETE /api/v1/admin/announcements/:id` - Delete announcement

### 3. SUPPORT/ISSUES (HIGH)
**Database Table: `support_requests`**
- `id` (PK)
- `student_id` (FK)
- `election_id` (FK, nullable)
- `category` (login/voting/candidate/receipt/technical/account/other)
- `status` (open/in_review/waiting/resolved/closed)
- `description`
- `receipt_id` (nullable, for vote-related issues)
- `response`
- `assigned_to`
- `created_at`, `updated_at`

**API Endpoints:**
- `GET /api/v1/support/requests` - List own requests (student)
- `POST /api/v1/support/requests` - Create request
- `GET /api/v1/support/requests/:id` - Get request details
- `PATCH /api/v1/admin/support/:id` - Update request (admin)
- `GET /api/v1/admin/support` - List all requests (admin)

### 4. NOTIFICATIONS (MEDIUM)
**Database Table: `notifications`**
- `id` (PK)
- `user_id` (student/admin ID)
- `user_type` (student/candidate/admin)
- `type` (success/info/warning/error)
- `category` (voting/election/candidate/support/account/system/results)
- `priority` (normal/important/action_required/critical)
- `title`
- `message`
- `action_label`
- `action_href`
- `read`
- `created_at`

**API Endpoints:**
- `GET /api/v1/notifications` - List notifications for user
- `PATCH /api/v1/notifications/:id/read` - Mark as read
- `PATCH /api/v1/notifications/read-all` - Mark all as read

### 5. STUDENT PROFILE (MEDIUM)
**Extend existing `students` table with:**
- `email`
- `password_hash`
- `department`
- `year`
- `profile_image_url`

**API Endpoints:**
- `GET /api/v1/students/profile` - Get own profile
- `PATCH /api/v1/students/profile` - Update own profile
- `POST /api/v1/auth/register` - Registration
- `POST /api/v1/auth/login` - Login
- `POST /api/v1/auth/logout` - Logout
- `POST /api/v1/auth/forgot-password` - Request reset
- `POST /api/v1/auth/reset-password` - Reset password

### 6. ACTIVITY LOG API (MEDIUM)
**Extend existing audit_logs with API access:**
- `GET /api/v1/admin/activity` - Query activity logs with filters
- Filters: actor_id, action, entity_type, date range

---

## Implementation Priority Order

1. Vote Receipts (critical for voting integrity)
2. Announcements (needed for election communication)
3. Support/Issues (student help system)
4. Notifications (improve user experience)
5. Student Profile (registration/login)
6. Activity Log API (admin feature)

---

## Security Considerations

- Vote receipts must NOT reveal candidate choices
- Receipt hash must be non-reversible
- Notifications are user-private
- Support requests are student-private
- Admin endpoints require admin authentication
- All new endpoints must use requireAdmin where appropriate
