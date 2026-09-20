# ops/recovery/ — Manual Recovery Procedures (NOT auto-deployed)

**Automatic migrations: `migrations/` ONLY.**

Recovery scripts here are **historical evidence** and **manual procedures**, not deploy steps.

## 057_restore_real_candidates.sql
- **Status:** Historical recovery, moved from `migrations/057...` 2026-09-20. Will **never** be auto-run.
- **Purpose:** After `056` wiped all election data, this re-created 15 real candidate applications from surviving Appwrite `candidate-photos` URLs (bio/manifesto/Aadhar unrecoverable — set NULL, phone `0000000000` placeholder).
- **Idempotent:** `WHERE NOT EXISTS (SELECT 1 FROM candidate_applications WHERE student_id = s.id AND status='approved')`.
- **Do NOT** add to `migrations/` or run via `npm run migrate`.

## How to Execute a Recovery (if ever needed again)
1. **Verify target** — confirm `DATABASE_URL` or `--target` is the intended DB (staging first, never assume prod).
2. **Verified backup** — `await backupService.runBackup(pool, {snapshotType:'pre-recovery', verify:true})` → check `verified, checksum, row_counts, fileId`. Record `migration_preflight` row.
3. **Journal** — `changeJournal.record({operation:'MIGRATION_PREFLIGHT', ...})` + `recordCriticalAndEnqueue` for durability.
4. **Prod guard** — `ALLOW_PRODUCTION_RESTORE=true` + `CONFIRM_PRODUCTION_RESTORE=<snapshot_id|checksum>` if target is prod-like.
5. **Confirmation** — type `RESTORE <8char>` or `CONFIRM <token>` as required by `scripts/restore-backup.js`.
6. **Execute** — `psql $DATABASE_URL -f ops/recovery/057_restore_real_candidates.sql` **or** via hardened `node scripts/restore-backup.js --file ops/recovery/057_restore_real_candidates.sql --target ... --confirm ...` (which does steps 2–5 internally).
7. **Verify** — `SELECT count(*) FROM candidate_applications WHERE status='approved'` and compare to expected, check journal `CANDIDATE_APPLICATION_CREATED` events.

## Safety
- Requires explicit operator authorization — not part of `render.yaml` `preDeployCommand`.
- Destructive gate (`migrate.js`) would block this if it were in `migrations/` without verified backup — that's why it lives here.
- Document retention: this file is evidence, not cleanup. Keep indefinitely.

## Do NOT
- Copy `ops/recovery/*.sql` into `migrations/`.
- Run against production without verified backup.
- Hard-code `DATABASE_URL` or Appwrite keys.
