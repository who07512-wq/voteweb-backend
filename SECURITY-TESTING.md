# 🔐 VoteWeb Security Testing Guide

Complete reference for security testing the CampusVote voting platform.

---

## 📋 Table of Contents

1. [Test Credentials](#test-credentials)
2. [Environment Configuration](#environment-configuration)
3. [Database Setup](#database-setup)
4. [API Endpoint Reference](#api-endpoint-reference)
5. [Security Feature Checklist](#security-feature-checklist)
6. [Attack Scenarios & Test Cases](#attack-scenarios--test-cases)
7. [Manual Testing Scripts](#manual-testing-scripts)
8. [Security Architecture](#security-architecture)

---

## 1. Test Credentials

### Authentication Users (from `seed-auth.js`)

| Role | Identifier | Password | Notes |
|------|-----------|----------|-------|
| **Admin** | `ADMIN001` | `AdminPassword123!` | Requires MFA (TOTP) |
| **Student** | `STU001` | `StudentPassword123!` | No MFA |
| **Candidate** | `CAN001` | `CandidatePassword123!` | No MFA |

### Seed Data Students (from `seed.js`)

| External ID | Name | Email |
|-------------|------|-------|
| `STU-001` | Alice Johnson | alice@example.edu |
| `STU-002` | Bob Smith | bob@example.edu |
| `STU-003` | Carol Williams | carol@example.edu |
| `STU-004` | David Brown | david@example.edu |
| `STU-005` | Eva Martinez | eva@example.edu |

### Test Password Policy

```
Minimum 8 characters
At least one uppercase letter
At least one lowercase letter
At least one number
At least one special character
Cannot contain student identifier
```

**Valid passwords:**
- `AdminPassword123!`
- `StudentPassword123!`
- `CandidatePassword123!`
- `TestPassword123!`
- `P@ssw0rd!2026`

**Invalid passwords (should be rejected):**
- `password` (too short, no uppercase, no number, no special)
- `12345678` (no letters)
- `ADMIN001!` (contains student identifier)
- `abcdefgh` (no uppercase, no number, no special)

---

## 2. Environment Configuration

### Required Environment Variables

```bash
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgres://voteweb:voteweb@localhost:5434/voteweb

# Security - Session (REQUIRED in production)
SESSION_SECRET=change-this-to-a-32-char-secret-in-prod
SESSION_TTL_HOURS=8

# Security - MFA/TOTP (REQUIRED for MFA)
TOTP_ENCRYPTION_KEY=change-this-to-44-char-base64-key-in-prod

# Security - Cookies
COOKIE_SECURE=false  # Set true in production

# CORS
CORS_ORIGIN=http://localhost:3001
FRONTEND_URL=http://localhost:3001

# Dev Only (NEVER enable in production)
ALLOW_DEV_ADMIN=false
```

### Security Defaults

| Setting | Default | Production Required |
|---------|---------|-------------------|
| `SESSION_SECRET` | `dev-only-session-secret-change-in-prod` | ✅ Yes (32+ chars) |
| `TOTP_ENCRYPTION_KEY` | `null` | ✅ Yes (32 bytes base64) |
| `COOKIE_SECURE` | `false` | ✅ Yes (`true`) |
| `SESSION_TTL_HOURS` | `8` | Recommended |
| `ALLOW_DEV_ADMIN` | `false` | ❌ Must be `false` |

---

## 3. Database Setup

### Quick Setup

```bash
# 1. Run migrations
npm run migrate

# 2. Seed test data
npm run seed

# 3. Seed auth users
node seed-auth.js

# 4. Run tests
npm test
```

### Test Database

```bash
# Default test DB (used by test suite)
DATABASE_URL=postgres://voteweb:voteweb@localhost:5434/voteweb

# Or set custom
TEST_DATABASE_URL=postgres://user:pass@host:port/dbname
```

### Database Schema Tables

```
students            - User accounts (id, external_id, name, email, role, password_hash)
sessions            - Active sessions (session_hash, student_id, binding_hash, expires_at)
elections           - Election definitions (name, status, start_time, end_time)
clubs               - Election clubs (election_id, name)
positions           - Club positions (club_id, name, display_order)
candidates          - Position candidates (position_id, name, description)
votes               - Cast votes (student_id, election_id, position_id, candidate_id)
vote_receipts       - Vote receipts (student_id, election_id, vote_id, receipt_hash, nullifier)
voter_authorizations - Voter eligibility (student_id, election_id, is_authorized)
announcements       - Election announcements (title, message, is_published)
support_requests    - Student support tickets (student_id, category, description, status)
notifications       - User notifications (user_id, type, title, is_read)
registration_requests - Pending registrations (full_name, email, student_identifier, password_hash)
audit_log           - Security audit trail (action, ip, metadata)
```

---

## 4. API Endpoint Reference

### Base URL

```
http://localhost:3000/api/v1
```

### Health Check (No Auth)

```bash
# Health check
curl http://localhost:3000/api/health

# Database health
curl http://localhost:3000/api/health/db
```

### Authentication

```bash
# Get CSRF token (required before any POST)
curl -c cookies.txt http://localhost:3000/api/v1/auth/csrf
# Returns: { "data": { "csrfToken": "..." } }

# Login (no MFA - student)
curl -b cookies.txt -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -d '{"userIdentifier": "STU001", "password": "StudentPassword123!"}'
# Returns: { "data": { "authenticated": true, "bindingToken": "...", "user": {...} } }

# Login (requires MFA - admin)
curl -b cookies.txt -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -d '{"userIdentifier": "ADMIN001", "password": "AdminPassword123!"}'
# Returns: { "data": { "authenticated": false, "mfaRequired": true, "mfaChallenge": "..." } }

# Verify MFA
curl -b cookies.txt -X POST http://localhost:3000/api/v1/auth/mfa/verify \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>" \
  -d '{"mfaChallenge": "<challenge>", "code": "123456"}'

# Get current user
curl -b cookies.txt http://localhost:3000/api/v1/auth/me

# Change password
curl -b cookies.txt -X POST http://localhost:3000/api/v1/auth/change-password \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>" \
  -d '{"currentPassword": "OldPassword123!", "newPassword": "NewPassword123!"}'

# Register new account
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -d '{"fullName": "New Student", "email": "new@college.edu", "studentIdentifier": "STU-NEW", "password": "SecurePass123!"}'

# Logout
curl -b cookies.txt -X POST http://localhost:3000/api/v1/auth/logout \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>"
```

### Public Resources (No Auth)

```bash
# List elections
curl http://localhost:3000/api/v1/elections

# Get election by ID
curl http://localhost:3000/api/v1/elections/1

# Get election clubs
curl http://localhost:3000/api/v1/elections/1/clubs

# Get club positions
curl http://localhost:3000/api/v1/clubs/1/positions

# Get position candidates
curl http://localhost:3000/api/v1/positions/1/candidates

# List announcements
curl http://localhost:3000/api/v1/announcements

# Public receipt verification
curl http://localhost:3000/api/v1/receipts/<receipt_uuid>
```

### Student Routes (Auth Required)

```bash
# Check eligibility
curl -b cookies.txt http://localhost:3000/api/v1/elections/1/eligibility

# Check vote status
curl -b cookies.txt http://localhost:3000/api/v1/elections/1/votes/check

# Cast vote
curl -b cookies.txt -X POST http://localhost:3000/api/v1/elections/1/votes \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>" \
  -d '{"club_id": 1, "position_id": 1, "candidate_id": 1}'

# Get my receipt
curl -b cookies.txt http://localhost:3000/api/v1/elections/1/votes/receipt

# Get notifications
curl -b cookies.txt http://localhost:3000/api/v1/notifications

# Mark notification read
curl -b cookies.txt -X PATCH http://localhost:3000/api/v1/notifications/1/read \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>"

# Mark all read
curl -b cookies.txt -X POST http://localhost:3000/api/v1/notifications/mark-all-read \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>"

# Create support request
curl -b cookies.txt -X POST http://localhost:3000/api/v1/support \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>" \
  -d '{"category": "voting", "subject": "Test Issue", "description": "Cannot vote for position 1", "priority": "normal"}'

# Get my support requests
curl -b cookies.txt http://localhost:3000/api/v1/support

# Get support request detail
curl -b cookies.txt http://localhost:3000/api/v1/support/1
```

### Admin Routes (Admin Auth Required)

```bash
# List all students
curl -b cookies.txt http://localhost:3000/api/v1/admin/students

# Create student
curl -b cookies.txt -X POST http://localhost:3000/api/v1/admin/students \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>" \
  -d '{"external_id": "STU-NEW", "name": "New Student", "email": "new@college.edu"}'

# Update student
curl -b cookies.txt -X PATCH http://localhost:3000/api/v1/admin/students/1 \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>" \
  -d '{"name": "Updated Name"}'

# Toggle student status
curl -b cookies.txt -X PATCH http://localhost:3000/api/v1/admin/students/1/status \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>" \
  -d '{"is_active": false}'

# List all elections (admin)
curl -b cookies.txt http://localhost:3000/api/v1/admin/elections

# Create election
curl -b cookies.txt -X POST http://localhost:3000/api/v1/admin/elections \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>" \
  -d '{"name": "Test Election", "description": "Test", "start_time": "2026-09-01T09:00:00Z", "end_time": "2026-09-10T17:00:00Z", "status": "DRAFT"}'

# Update election
curl -b cookies.txt -X PATCH http://localhost:3000/api/v1/admin/elections/1 \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>" \
  -d '{"status": "OPEN"}'

# Update election status
curl -b cookies.txt -X PATCH http://localhost:3000/api/v1/admin/elections/1/status \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>" \
  -d '{"status": "CLOSED"}'

# Publish election results
curl -b cookies.txt -X POST http://localhost:3000/api/v1/admin/elections/1/publish \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>"

# Check election readiness
curl -b cookies.txt http://localhost:3000/api/v1/admin/elections/1/readiness

# Create club
curl -b cookies.txt -X POST http://localhost:3000/api/v1/admin/elections/1/clubs \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>" \
  -d '{"name": "New Club", "description": "A new club"}'

# Update club
curl -b cookies.txt -X PATCH http://localhost:3000/api/v1/admin/clubs/1 \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>" \
  -d '{"name": "Updated Club"}'

# Create position
curl -b cookies.txt -X POST http://localhost:3000/api/v1/admin/clubs/1/positions \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>" \
  -d '{"name": "New Position", "description": "Position description", "display_order": 1}'

# Update position
curl -b cookies.txt -X PATCH http://localhost:3000/api/v1/admin/positions/1 \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>" \
  -d '{"name": "Updated Position"}'

# Create candidate
curl -b cookies.txt -X POST http://localhost:3000/api/v1/admin/positions/1/candidates \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>" \
  -d '{"name": "New Candidate", "bio": "Candidate bio"}'

# Update candidate
curl -b cookies.txt -X PATCH http://localhost:3000/api/v1/admin/candidates/1 \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>" \
  -d '{"name": "Updated Candidate"}'

# List authorizations
curl -b cookies.txt http://localhost:3000/api/v1/admin/elections/1/authorizations

# Create authorization
curl -b cookies.txt -X POST http://localhost:3000/api/v1/admin/elections/1/authorizations \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>" \
  -d '{"student_id": 1, "authorized_clubs": [1]}'

# Update authorization
curl -b cookies.txt -X PATCH http://localhost:3000/api/v1/admin/authorizations/1 \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>" \
  -d '{"is_authorized": false}'

# Delete authorization
curl -b cookies.txt -X DELETE http://localhost:3000/api/v1/admin/authorizations/1 \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>"

# List announcements (admin)
curl -b cookies.txt http://localhost:3000/api/v1/admin/announcements

# Create announcement
curl -b cookies.txt -X POST http://localhost:3000/api/v1/admin/announcements \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>" \
  -d '{"title": "Test Announcement", "content": "Announcement content", "is_active": true}'

# Update announcement
curl -b cookies.txt -X PATCH http://localhost:3000/api/v1/admin/announcements/1 \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>" \
  -d '{"title": "Updated Title"}'

# Delete announcement
curl -b cookies.txt -X DELETE http://localhost:3000/api/v1/admin/announcements/1 \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>"

# List support requests (admin)
curl -b cookies.txt http://localhost:3000/api/v1/admin/support

# Get support request (admin)
curl -b cookies.txt http://localhost:3000/api/v1/admin/support/1

# Update support request (admin)
curl -b cookies.txt -X PATCH http://localhost:3000/api/v1/admin/support/1 \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf_token>" \
  -H "X-Session-Binding: <binding_token>" \
  -d '{"status": "in_review", "admin_notes": "Looking into this"}'
```

---

## 5. Security Feature Checklist

### ✅ Authentication & Session

| Feature | Status | Endpoint |
|---------|--------|----------|
| Password hashing (bcrypt) | ✅ | `src/lib/password.js` |
| Session tokens (random, hashed) | ✅ | `src/lib/crypto.js` |
| Session binding token | ✅ | `X-Session-Binding` header |
| Session expiry (configurable) | ✅ | `SESSION_TTL_HOURS` |
| Account lockout (5 attempts) | ✅ | `src/middleware/rateLimiter.js` |
| MFA/TOTP support | ✅ | `/auth/mfa/*` |
| Password change required | ✅ | `password_change_required` field |

### ✅ Authorization

| Feature | Status | Endpoint |
|---------|--------|----------|
| Role-based access (ADMIN/STUDENT/CANDIDATE) | ✅ | `src/middleware/requireAdmin.js` |
| Admin route protection | ✅ | `requireAdmin` middleware |
| Student route protection | ✅ | `requireAuth` middleware |
| IDOR protection (receipts) | ✅ | Ownership check in controller |
| Impersonation prevention | ✅ | Body student_id rejected |

### ✅ CSRF Protection

| Feature | Status | Endpoint |
|---------|--------|----------|
| Double-submit cookie pattern | ✅ | `src/middleware/csrfProtection.js` |
| CSRF on login | ✅ | `POST /auth/login` |
| CSRF on logout | ✅ | `POST /auth/logout` |
| CSRF on vote | ✅ | `POST /elections/:id/votes` |
| CSRF on admin mutations | ✅ | All POST/PATCH/DELETE |
| CSRF on announcements | ✅ | POST/PATCH/DELETE |
| CSRF on support | ✅ | POST/PATCH |
| CSRF on candidates | ✅ | PATCH |
| CSRF on positions | ✅ | PATCH |
| CSRF on authorizations | ✅ | PATCH/DELETE |

### ✅ Rate Limiting

| Feature | Limit | Window |
|---------|-------|--------|
| Login attempts | 30 | 15 minutes |
| MFA attempts | 20 | 5 minutes |
| Registration | 5 | 1 hour |
| Voting | 10 | 1 minute |

### ✅ Input Validation

| Feature | Status |
|---------|--------|
| SQL injection (parameterized queries) | ✅ |
| XSS (React auto-escaping) | ✅ |
| Input length limits | ✅ |
| Email format validation | ✅ |
| Password policy enforcement | ✅ |
| Required field validation | ✅ |

### ✅ Headers & Transport

| Feature | Status |
|---------|--------|
| Helmet.js security headers | ✅ |
| CORS configuration | ✅ |
| HttpOnly cookies | ✅ |
| SameSite cookies | ✅ |
| Secure cookies (production) | ✅ |

---

## 6. Attack Scenarios & Test Cases

### 🔴 Critical Security Tests

#### 1. SQL Injection
```bash
# Test login with SQL injection
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <token>" \
  -d '{"userIdentifier": "admin'\'' OR 1=1--", "password": "anything"}'
# Expected: 401 Unauthorized

# Test search with SQL injection
curl "http://localhost:3000/api/v1/elections?status=OPEN'%20OR%201=1--"
# Expected: Normal response, no data leak
```

#### 2. Cross-Site Scripting (XSS)
```bash
# Test announcement with XSS payload
curl -b cookies.txt -X POST http://localhost:3000/api/v1/admin/announcements \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <token>" \
  -H "X-Session-Binding: <binding>" \
  -d '{"title": "<script>alert(1)</script>", "content": "Test"}'
# Expected: Title stored, but rendered safely by React

# Test support request with XSS
curl -b cookies.txt -X POST http://localhost:3000/api/v1/support \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <token>" \
  -H "X-Session-Binding: <binding>" \
  -d '{"category": "voting", "subject": "<img src=x onerror=alert(1)>", "description": "Test"}'
```

#### 3. CSRF Attacks
```bash
# Test POST without CSRF token
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"userIdentifier": "STU001", "password": "StudentPassword123!"}'
# Expected: 403 CSRF_INVALID

# Test POST with wrong CSRF token
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: wrong-token" \
  -d '{"userIdentifier": "STU001", "password": "StudentPassword123!"}'
# Expected: 403 CSRF_INVALID

# Test vote without binding token
curl -b cookies.txt -X POST http://localhost:3000/api/v1/elections/1/votes \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <token>" \
  -d '{"club_id": 1, "position_id": 1, "candidate_id": 1}'
# Expected: 401 (no binding token)
```

#### 4. IDOR (Insecure Direct Object Reference)
```bash
# Student A votes, then Student B tries to read Student A's receipt
# Step 1: Student A votes and gets receipt
# Step 2: Student B logs in
curl -b cookies_student_b.txt http://localhost:3000/api/v1/elections/1/votes/receipt/<student_a_vote_id>
# Expected: 403 or 404
```

#### 5. Impersonation
```bash
# Try to vote as another student
curl -b cookies.txt -X POST http://localhost:3000/api/v1/elections/1/votes \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <token>" \
  -H "X-Session-Binding: <binding>" \
  -d '{"student_id": 9999, "club_id": 1, "position_id": 1, "candidate_id": 1}'
# Expected: 403 IMPersonation_ATTEMPT
```

#### 6. Privilege Escalation
```bash
# Student trying admin routes
curl -b cookies_student.txt http://localhost:3000/api/v1/admin/students
# Expected: 401 or 403

# Student trying to create election
curl -b cookies_student.txt -X POST http://localhost:3000/api/v1/admin/elections \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <token>" \
  -H "X-Session-Binding: <binding>" \
  -d '{"name": "Hacked Election"}'
# Expected: 401 or 403
```

#### 7. Session Fixation
```bash
# Try to use session without binding token on state-changing request
curl -b cookies.txt -X POST http://localhost:3000/api/v1/auth/change-password \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <token>" \
  -d '{"currentPassword": "OldPass123!", "newPassword": "NewPass123!"}'
# Expected: 401 (no binding token)
```

#### 8. Rate Limiting
```bash
# Brute force login (should be rate limited after 30 attempts)
for i in {1..35}; do
  curl -s -X POST http://localhost:3000/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -H "X-CSRF-Token: <token>" \
    -d '{"userIdentifier": "STU001", "password": "WrongPassword"}'
done
# Expected: 429 Too Many Requests after 30 attempts
```

#### 9. Vote Integrity
```bash
# Double vote for same position
curl -b cookies.txt -X POST http://localhost:3000/api/v1/elections/1/votes \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <token>" \
  -H "X-Session-Binding: <binding>" \
  -d '{"club_id": 1, "position_id": 1, "candidate_id": 1}'
# First: 201 Created

curl -b cookies.txt -X POST http://localhost:3000/api/v1/elections/1/votes \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <token>" \
  -H "X-Session-Binding: <binding>" \
  -d '{"club_id": 1, "position_id": 1, "candidate_id": 2}'
# Second: 409 ALREADY_VOTED
```

#### 10. Receipt Forgery
```bash
# Try to verify non-existent receipt
curl http://localhost:3000/api/v1/receipts/00000000-0000-4000-8000-000000000000
# Expected: 404

# Try malformed receipt ID
curl http://localhost:3000/api/v1/receipts/not-a-uuid
# Expected: 400
```

---

## 7. Manual Testing Scripts

### Full Authentication Flow Test

```bash
#!/bin/bash
BASE_URL="http://localhost:3000"

echo "=== Step 1: Get CSRF Token ==="
CSRF=$(curl -s -c cookies.txt $BASE_URL/api/v1/auth/csrf | jq -r '.data.csrfToken')
echo "CSRF Token: $CSRF"

echo "=== Step 2: Login as Student ==="
LOGIN=$(curl -s -b cookies.txt -X POST $BASE_URL/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"userIdentifier": "STU001", "password": "StudentPassword123!"}')
echo "$LOGIN" | jq .
BINDING=$(echo "$LOGIN" | jq -r '.data.bindingToken')
echo "Binding Token: $BINDING"

echo "=== Step 3: Check Eligibility ==="
curl -s -b cookies.txt $BASE_URL/api/v1/elections/1/eligibility | jq .

echo "=== Step 4: Check Vote Status ==="
curl -s -b cookies.txt $BASE_URL/api/v1/elections/1/votes/check | jq .

echo "=== Step 5: Cast Vote ==="
curl -s -b cookies.txt -X POST $BASE_URL/api/v1/elections/1/votes \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -H "X-Session-Binding: $BINDING" \
  -d '{"club_id": 1, "position_id": 1, "candidate_id": 1}' | jq .

echo "=== Step 6: Get Receipt ==="
curl -s -b cookies.txt $BASE_URL/api/v1/elections/1/votes/receipt | jq .

echo "=== Step 7: Logout ==="
curl -s -b cookies.txt -X POST $BASE_URL/api/v1/auth/logout \
  -H "X-CSRF-Token: $CSRF" \
  -H "X-Session-Binding: $BINDING" | jq .

rm -f cookies.txt
```

### Admin Flow Test

```bash
#!/bin/bash
BASE_URL="http://localhost:3000"

echo "=== Admin Login (requires MFA) ==="
CSRF=$(curl -s -c cookies.txt $BASE_URL/api/v1/auth/csrf | jq -r '.data.csrfToken')
MFA_RESPONSE=$(curl -s -b cookies.txt -X POST $BASE_URL/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"userIdentifier": "ADMIN001", "password": "AdminPassword123!"}')
echo "$MFA_RESPONSE" | jq .
MFA_CHALLENGE=$(echo "$MFA_RESPONSE" | jq -r '.data.mfaChallenge')

echo "=== Verify MFA ==="
# Note: You need a real TOTP code from an authenticator app
MFA_VERIFY=$(curl -s -b cookies.txt -X POST $BASE_URL/api/v1/auth/mfa/verify \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d "{\"mfaChallenge\": \"$MFA_CHALLENGE\", \"code\": \"123456\"}")
echo "$MFA_VERIFY" | jq .
BINDING=$(echo "$MFA_VERIFY" | jq -r '.data.bindingToken')

echo "=== List Students ==="
curl -s -b cookies.txt $BASE_URL/api/v1/admin/students | jq .

echo "=== List Elections ==="
curl -s -b cookies.txt $BASE_URL/api/v1/admin/elections | jq .

echo "=== Logout ==="
curl -s -b cookies.txt -X POST $BASE_URL/api/v1/auth/logout \
  -H "X-CSRF-Token: $CSRF" \
  -H "X-Session-Binding: $BINDING" | jq .

rm -f cookies.txt
```

### Security Headers Test

```bash
#!/bin/bash
echo "=== Security Headers Check ==="
curl -s -I http://localhost:3000/api/health | grep -iE "(strict-transport|content-security|x-frame|x-content-type|x-xss|referrer-policy|permissions-policy|helmet)"
```

---

## 8. Security Architecture

### Request Flow

```
Client Request
    ↓
[Helmet.js] → Security headers
    ↓
[CORS] → Origin validation
    ↓
[Body Parser] → JSON parsing (1mb limit)
    ↓
[Cookie Parser] → Extract cookies
    ↓
[loadSession] → Validate session, populate req.user
    ↓
[CSRF Protection] → Validate CSRF token (state-changing)
    ↓
[Rate Limiter] → Check rate limits
    ↓
[requireAdmin/requireAuth] → Role validation
    ↓
Route Handler
```

### Cookie Security

| Cookie | HttpOnly | Secure | SameSite | MaxAge |
|--------|----------|--------|----------|--------|
| `cv_sid` (session) | ✅ | Config | lax | 8 hours |
| `cv_csrf` | ❌ | Config | lax | 1 hour |

### Token Security

| Token | Storage | Transmission | Validation |
|-------|---------|--------------|------------|
| Session | HttpOnly cookie | Cookie header | HMAC-SHA256 hash |
| CSRF | JavaScript accessible | X-CSRF-Token header | Timing-safe comparison |
| Binding | sessionStorage | X-Session-Binding header | HMAC-SHA256 hash |

### Database Security

| Measure | Implementation |
|---------|---------------|
| SQL Injection | Parameterized queries ($1, $2, ...) |
| Password Storage | bcrypt hashing |
| TOTP Secrets | AES-256-GCM encryption |
| Session Tokens | HMAC-SHA256 hashing |
| Audit Trail | All security events logged |

---

## 🔍 Quick Security Audit Commands

```bash
# 1. Check for hardcoded secrets
grep -r "password\|secret\|token\|key" src/ --include="*.js" --include="*.ts" | grep -v node_modules

# 2. Check for console.log in production code
grep -r "console.log" src/ --include="*.js" --include="*.ts" | grep -v node_modules

# 3. Check for eval/exec
grep -r "eval\|exec\|Function(" src/ --include="*.js" --include="*.ts" | grep -v node_modules

# 4. Check for SQL injection patterns
grep -r "query.*\${" src/ --include="*.js" | grep -v node_modules

# 5. Check for missing CSRF on mutations
grep -r "router\.\(post\|patch\|delete\)" src/routes/ --include="*.js" | grep -v csrf

# 6. Run automated tests
npm test

# 7. Check TypeScript errors
cd voteweb-Frontend && npx tsc --noEmit

# 8. Check ESLint
cd voteweb-Frontend && npx eslint .
```

---

## 📝 Security Testing Checklist

### Pre-Deployment

- [ ] All test credentials changed for production
- [ ] `SESSION_SECRET` is 32+ characters, random
- [ ] `TOTP_ENCRYPTION_KEY` is set and secure
- [ ] `COOKIE_SECURE=true` in production
- [ ] `ALLOW_DEV_ADMIN=false` in production
- [ ] `NODE_ENV=production`
- [ ] CORS restricted to production domain
- [ ] No `console.log` in production code
- [ ] No hardcoded secrets in source code
- [ ] All admin routes have CSRF protection
- [ ] All state-changing routes have rate limiting
- [ ] Database connections use SSL
- [ ] Error messages don't leak internal details

### Runtime Testing

- [ ] Login with valid credentials works
- [ ] Login with invalid credentials fails
- [ ] MFA flow works for admin
- [ ] Session expires after TTL
- [ ] Binding token required for state changes
- [ ] CSRF token required for mutations
- [ ] Rate limiting triggers after threshold
- [ ] IDOR protection works (can't read others' receipts)
- [ ] Impersonation blocked (can't vote as others)
- [ ] Privilege escalation blocked (student → admin)
- [ ] Double voting blocked
- [ ] Receipt verification works for valid receipts
- [ ] Receipt verification fails for invalid receipts
- [ ] Admin can manage elections
- [ ] Admin can publish results
- [ ] Students can view published results

---

*Last updated: August 2026*
