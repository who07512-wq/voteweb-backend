# ops/ — Maintenance Operations (NOT auto-deployed)

This directory holds **manual** SQL operations that are NEVER run by `npm run migrate` in production.

* `migrations/` is the ONLY directory executed by `migrate.js up` in production (`NODE_ENV=production`).
* `ops/` scripts require explicit `psql` or `node ops/run.js` invocation against a **non-production** DB unless a verified snapshot exists.
* Destructive `ops/` scripts must:
  1. Create a verified snapshot via `backupService.runBackup({snapshotType:'pre-destructive', verify:true})`
  2. Require `ALLOW_DESTRUCTIVE_MIGRATIONS=true` in production.
  3. Journal via `changeJournal.record`.

Do NOT move test setup/cleanup into `migrations/` to make them auto-execute on Render.
