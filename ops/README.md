# ops/ — Maintenance & Recovery Operations (NOT auto-deployed)

**Automatic migrations live ONLY under `migrations/`** — executed by `migrate.js up` in production (`migrate.js:resolveMigrationsDir`). `ops/` is NEVER auto-run.

## Layout
- `ops/recovery/` — historical recovery scripts (e.g., `057_restore_real_candidates.sql` moved from `migrations/` 2026-09-20). NOT part of deploy lifecycle.
- `ops/` root — manual maintenance docs.

## Recovery SQL Rules
- `migrations/057_restore_real_candidates.sql` is **historical** — it reconstructed 15 candidates after `056` wipe using Appwrite photos. It is **NOT** an automatic migration.
- `ops/recovery/` scripts must **never** be added to `migrations/`.
- Production restoration requires:
  1. Explicit operator authorization (separate from deploy).
  2. Verify target `DATABASE_URL` (use `--target`, never assume).
  3. Fresh **verified** snapshot: `backupService.runBackup({snapshotType:'pre-recovery', verify:true})` → checksum + row-count verified.
  4. `ALLOW_PRODUCTION_RESTORE=true` + `CONFIRM_PRODUCTION_RESTORE=<snapshot_id|checksum>` for any prod target.
  5. Journal `MIGRATION_PREFLIGHT` / `RESTORE_STARTED` with snapshot metadata.
  6. Execute via hardened `scripts/restore-backup.js` or `node ops/recovery/run.js` (not `npm run migrate`).

## Inspecting a Recovery Script
```bash
cat ops/recovery/057_restore_real_candidates.sql | head -30
# Check header for SAFETY block, idempotency (WHERE NOT EXISTS), and required pre-backup
```

## Destructive Migration Gate
- `src/lib/destructiveDetection.js` classifies `DELETE`/`TRUNCATE`/`DROP TABLE|SCHEMA|DATABASE`/`ALTER DROP`/`CASCADE`/`DO $$`/`EXECUTE format`/`FOREACH DELETE`/`broad UPDATE`.
- `migrate.js` fails closed: `classify → guard (ALLOW_DESTRUCTIVE_MIGRATIONS) → verified pre-destructive snapshot → checksum/row-count/metadata → only then SQL`. Any failure → `exit 1`, no SQL executed.
- `056_remove_all_elections.sql` is the regression test for this gate.

## Test vs Production
- `test/migrations/README.md` — test data lives there, run with `--migrations-dir test/migrations` against disposable DB.
- Never copy `ops/recovery/*.sql` or `test/migrations/*.sql` into `migrations/` to make them auto-execute.

## Inventory (2026-09-20)
- `001`–`008`, `013`–`035` — legitimate schema (keep).
- `038_remove_clubs.sql` — legitimate schema refactor (drops `clubs` after migrating to `constituencies`) — keep but gated as destructive (requires verified backup already — passed on live because it was already applied before gate existed; new deploys will gate it if pending).
- `039_cleanup_test_applications.sql`, `040_cleanup_testcase1_election2.sql`, `042_test_simulation_seed.sql`, `043_test_simulation_passwords.sql`, `044_test_simulation_cleanup.sql`, `045_test_simulation_real_emails.sql`, `046_test_simulation_cleanup_real.sql`, `047_add_8th_voter_bmtashwin.sql`, `048_recreate_test_live_15.sql`, `049_final_cleanup_after_15_test.sql`, `050_fill_class_…`, `051_fix_test_positions_gender.sql`, `052_recreate_after_049_fix_gender.sql`, `053_set_passwords…`, `054_backfill…`, `055_restore_who07512…` — historical test/repair data. They remain in `migrations/` for history but are now classified as destructive and would require verified backup + `ALLOW_DESTRUCTIVE_MIGRATIONS=true` if re-run on a fresh DB. **Do not add new test data to `migrations/`** — use `test/migrations/`.
- `056_remove_all_elections.sql` — destructive wipe (regression test). Keep for evidence, gated.
- `057` — **moved** to `ops/recovery/` (this fix).
