# ops/recovery/ — Manual Recovery Procedures (NOT auto-deployed)

**Automatic migrations: `migrations/` ONLY.**

Recovery scripts here are **historical evidence** and **manual procedures**, not deploy steps.

## 057_restore_real_candidates.sql
- **Status:** Historical recovery, moved from `migrations/057...` 2026-09-20. Will **never** be auto-run.
- **Purpose:** After `056` wiped all election data, this re-created 15 real candidate applications from surviving Appwrite `candidate-photos` URLs (bio/manifesto/Aadhar unrecoverable — set NULL, phone `0000000000` placeholder).
- **Idempotent:** `WHERE NOT EXISTS (SELECT 1 FROM candidate_applications WHERE student_id = s.id AND status='approved')`.
- **Do NOT** add to `migrations/` or run via `npm run migrate`.

## How to Execute a Recovery (if ever needed again)
**Important distinction:** `scripts/restore-backup.js` / `restoreService.safeRestore` only restores **snapshot files** (`db-backups` JSON, e.g., `voteweb-snapshot-*.json`) — it does **not** execute arbitrary SQL. `057` is historical **SQL**, not a snapshot, so it requires a separate SQL execution path.

For **snapshot restores** (generic):
1. **Verify target** — confirm `DATABASE_URL` or `--target` is intended DB (staging first).
2. **Verified pre-restore backup** — `restoreService.safeRestore` automatically creates `pre-restore` snapshot with `verify:true` (fail-closed if fails) — you do not run `psql`.
3. **Prod guard** — `ALLOW_PRODUCTION_RESTORE=true` + `--confirm <snapshot_id|checksum>` if prod.
4. **Execute** — `node scripts/restore-backup.js --file-id <id> --target ... --confirm ...`
5. **Verify** — `SELECT` row counts, journal `RESTORE_COMPLETED`.

For **SQL recovery (057)** — historical, not snapshot:
1. **Verify target** — same as above, but explicitly confirm target is **not** prod unless intentional.
2. **Verified pre-recovery backup** — manually run `await backupService.runBackup(targetPool, {snapshotType:'pre-recovery', verify:true})` via `node -e` or `ops/recovery/run.js` (must succeed, checksum verified). Record `migration_preflight`.
3. **Journal** — `changeJournal.recordCritical({operation:'MIGRATION_PREFLIGHT', ...})` (durably spooled).
4. **Prod guard** — same `ALLOW_PRODUCTION_RESTORE` + `CONFIRM` if target is prod-like (even for SQL, treat as prod restore).
5. **Confirmation** — interactive `RESTORE <8char>` if CLI, or explicit operator sign-off.
6. **Execute SQL** — **only** via `psql $DATABASE_URL -f ops/recovery/057_restore_real_candidates.sql` after steps 1–5, **not** via snapshot restore CLI. Do not use `npm run migrate` for this.
7. **Verify** — `SELECT count(*) FROM candidate_applications WHERE status='approved'` and journal.

## Safety
- Requires explicit operator authorization — not part of `render.yaml` `preDeployCommand`.
- Destructive gate (`migrate.js`) would block this if it were in `migrations/` without verified backup — that's why it lives here.
- Document retention: this file is evidence, not cleanup. Keep indefinitely.

## Do NOT
- Copy `ops/recovery/*.sql` into `migrations/`.
- Run against production without verified backup.
- Hard-code `DATABASE_URL` or Appwrite keys.
