# test/migrations — Test-Only Data Setup/Cleanup

**Never auto-executed in production.**

* Production `migrate.js up` reads ONLY `migrations/` (see `migrate.js:resolveMigrationsDir`).
* To run test migrations: `ALLOW_TEST_MIGRATIONS=true DATABASE_URL=postgres://.../test_db node migrate.js up --migrations-dir test/migrations`
* Test seeding/cleanup (e.g., `TEST_ELECTION_DELETE_ME`) belongs here, NOT in `migrations/`.
* CI must use a disposable test database (e.g., `127.0.0.1:5434/voteweb_test`), never `voteweb` production.
* Destructive test cleanup files that historically lived in `migrations/` (039,040,042-046,048-049,056-057) remain there for history but are now gated by the pre-destructive backup + `ALLOW_DESTRUCTIVE_MIGRATIONS` policy. New test migrations MUST go here.
