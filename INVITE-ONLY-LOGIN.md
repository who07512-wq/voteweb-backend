# CampusVote — Invite-Only Login System

> **How this project works when only invited people can sign in — and everyone else is locked out.**

This is the complete guide to the invite-only Google login for **voteweb-frontend** (Next.js on Vercel) + **voteweb-backend** (Express on Render). All sign-in happens through **Clerk (Google)**; a backend "bridge" then issues the real app session. Starting with backend commit `1707a6c6`, sign-in is **invite-only**: a Google account that is not registered in the database and not on the invite list is rejected with an error screen.

---

## 1. The short version

| Question | Answer |
|---|---|
| Who can log in? | Only Google accounts whose email is **already in the database** OR **listed in `INVITED_EMAILS`** |
| What happens to everyone else? | Rejected at the door — red "Sign-in failed" screen, error `NOT_INVITED (403)`, attempt written to the audit log |
| Can someone become admin by picking "Administrator" on the login page? | **No.** The role picker only decides where you're redirected. Your real role comes from the database |
| How does someone become admin? | They must exist in the DB with `role='ADMIN'` — either promoted in SQL, or bootstrapped via the `ADMIN_EMAILS` list |
| Do users still type passwords or OTP codes? | No. Google sign-in only (via Clerk) |

---

## 2. The login flow, step by step

```
/login
  └─ user picks a role (Student / Candidate / Administrator)
  └─ clicks "Continue with Google"
        │  (role is stored in sessionStorage as a routing hint)
        ▼
Google account picker  ──►  /auth/clerk-callback
        │  (Clerk completes the OAuth handshake, verifies the Google session)
        ▼
POST /api/v1/auth/clerk-session
        │  Frontend sends: Clerk session JWT (Bearer) + email + name + requested role
        ▼
Backend bridge (src/routes/clerkAuth.js):
  1. Verifies the JWT signature against Clerk's JWKS (forged tokens fail here)
  2. Confirms the token's issuer matches this Clerk instance
  3. Cross-checks the email against Clerk's API (server-to-server)
  4. Looks up the email in the `students` table
        │
        ├─ Email found ──► use the existing account + its DB role
        │                    (if the email is in ADMIN_EMAILS and isn't admin
        │                     yet, it is promoted to ADMIN — the bootstrap)
        │
        └─ Email NOT found
             ├─ INVITE_ONLY=true and email not in INVITED_EMAILS
             │     ──► 403 NOT_INVITED + audit log entry. Rejected. 🔒
             │
             └─ Email IS in INVITED_EMAILS
                   ──► account auto-created (STUDENT or CANDIDATE,
                        or ADMIN if the email is also in ADMIN_EMAILS)
        ▼
Backend session created (cv_sid cookie + binding token)
        ▼
Redirect to the dashboard for the DB-verified role
( /admin/dashboard, /candidate/dashboard or /student/dashboard ;
  students & candidates are asked for their roll number once, first )
```

---

## 3. Configuration (environment variables on the Render backend)

| Variable | Example | What it does |
|---|---|---|
| `INVITE_ONLY` | `true` | Master switch. `true` = unknown emails are rejected. Any other value (or unset) = open mode (anyone can sign up) |
| `INVITED_EMAILS` | `who07512@gmail.com,a.b@gmail.com,c@dbit.in` | Comma-separated allow-list. People on this list can create an account on first sign-in. **Case-insensitive, spaces ignored** |
| `ADMIN_EMAILS` | `who07512@gmail.com` | Comma-separated bootstrap list. Anyone on it is **created as ADMIN** (if new) or **promoted to ADMIN** (if existing) the next time they sign in |
| `CLERK_ISSUER` | `https://closing-hawk-9939.clerk.accounts.dev` | Clerk instance URL — tokens from any other instance are refused |
| `CLERK_SECRET_KEY` | `sk_test_...` | Lets the backend verify the signer's email with Clerk's API directly |

All five are already set on the Render service `voteweb-api` (`voteweb-backend-api.onrender.com`).

### How to invite more people

1. Render Dashboard → **voteweb-api** → **Environment** → edit `INVITED_EMAILS`
2. Add emails, comma-separated (keep the existing ones — the whole value is replaced)
3. Save → Render redeploys automatically → done. The person just signs in with that Google account

> Tip: students at the institute can be invited in batches by pasting a whole list of `@dbit.in` addresses. There is no limit on list length.

### How to make someone an admin

**Option A — bootstrap list (easiest):** add their email to `ADMIN_EMAILS` on Render, ask them to sign out and sign in once. Done.

**Option B — direct SQL:** `UPDATE students SET role = 'ADMIN' WHERE email = 'their.email@gmail.com';`

---

## 4. What different people experience

| Who | Experience |
|---|---|
| **Invited person, first time** | Google sign-in → account is created → roll-number prompt (students/candidates) → dashboard |
| **Existing user** | Google sign-in → straight to their dashboard |
| **Bootstrap admin** (`ADMIN_EMAILS`) | Google sign-in → promoted to ADMIN on the fly → `/admin/dashboard` |
| **Uninvited person** | Google sign-in succeeds at Google, then the callback page shows **"Sign-in failed — This Google account has not been invited to CampusVote. Ask the election administrator for access."** No account is created, nothing is leaked. The attempt is recorded in `audit_logs` as `clerk_login_denied` |
| **Forged/expired token** | Rejected by JWT verification before any DB lookup (`INVALID_CLERK_TOKEN`) |

---

## 5. Where the enforcement lives (code map)

| File | Role |
|---|---|
| `voteweb-backend/src/routes/clerkAuth.js` | **The gate.** JWT verification, invite check, auto-provisioning, admin bootstrap, session creation. This is the only place a new session can be born from a Google login |
| `voteweb-frontend/src/app/login/[[...rest]]/page.tsx` | Role picker + "Continue with Google" button. Role is a **routing hint only** — it cannot grant privileges |
| `voteweb-frontend/src/app/auth/clerk-callback/page.tsx` | Completes the OAuth handshake, calls the bridge, routes to the dashboard |
| `voteweb-backend/migrations/020_authentication.sql` | Defines the `user_role` enum (`STUDENT`, `CANDIDATE`, `ADMIN`) |

Defense in depth: even if the login page were tampered with, the **backend** re-verifies everything (JWT signature, issuer, email, invite list, DB role). The frontend is never trusted.

---

## 6. Quick start (fresh deployment)

1. **Backend (Render):** set the five env vars from section 3, deploy
2. **Frontend (Vercel):** set `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/login`, deploy
3. **Clerk dashboard:** enable **Google** as a sign-in option (Configure → Sign-in options)
4. **First admin:** put your own email in both `INVITED_EMAILS` and `ADMIN_EMAILS`, then sign in once — you're admin
5. **Invite everyone else:** append their emails to `INVITED_EMAILS`
6. **Verify lockout:** try signing in with a Google account that isn't invited — you should see the rejection screen

---

## 7. FAQ & troubleshooting

**"It says I haven't been invited but I'm sure I'm on the list."**
The backend was deployed *before* the env var was updated — check Render's deploy timestamp. Also confirm the email matches exactly (the comparison is case-insensitive, but the address must be identical otherwise).

**"Someone signed in as STUDENT but should be ADMIN."**
Add them to `ADMIN_EMAILS` and have them sign out → sign in again. The promotion runs at sign-in time.

**"I want open sign-up for a test run."**
Set `INVITE_ONLY=false` on Render (or delete the var), redeploy. Turn it back to `true` before the real election.

**"Can I remove someone's access?"**
Deactivate them in the DB: `UPDATE students SET is_active = FALSE WHERE email = '...';` — active accounts are the only ones that match the lookup. Also remove them from `INVITED_EMAILS` so they can't come back.

**"Is the roll-number step part of security?"**
No — it's a UX record-keeping step (localStorage). The real authorization is the DB role checked on every API call.

---

## 8. Security notes

- Session tokens are httpOnly cookies (`cv_sid`) — JavaScript can't read them, so XSS can't steal a session directly
- Every bridge call is rate-limited (`loginLimiter`) and CSRF-protected
- All sign-ins and rejected attempts are written to `audit_logs` (`clerk_google_login` / `clerk_login_denied`) — useful for spotting someone probing the door
- Clerk dev instance (`pk_test_…`) is fine for the rehearsal; for the real election create a Clerk **production instance** and swap in the `pk_live_` / `sk_live_` keys on both Vercel and Render
