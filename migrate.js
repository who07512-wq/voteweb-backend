/**
 * Migration Runner — Hardened for production safety
 * Applies SQL migration files in order and tracks executed migrations.
 * Includes mandatory pre-deploy backup gate for destructive migrations.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const crypto = require('node:crypto');

// Load environment - Railway provides env vars directly, .env is for local dev
require('dotenv').config();

// Validate required environment variables
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is not set!');
  console.error('Please set DATABASE_URL to your PostgreSQL connection string.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: 10000,
});

const { filterDestructive } = require('./src/lib/destructiveDetection');

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function allowDestructive() {
  // Default: false in production, true in dev/test unless explicitly blocked
  // Explicit override: ALLOW_DESTRUCTIVE_MIGRATIONS=true allows destructive in prod after verified backup
  const raw = process.env.ALLOW_DESTRUCTIVE_MIGRATIONS;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return !isProduction(); // dev/test allows, prod blocks
}

function getGitCommit() {
  try {
    const { execSync } = require('node:child_process');
    return execSync('git rev-parse HEAD', { encoding: 'utf8', timeout: 2000 }).trim();
  } catch {
    return process.env.GIT_COMMIT || process.env.RENDER_GIT_COMMIT || 'unknown';
  }
}

async function getAppliedMigrations() {
  const result = await pool.query(`
    SELECT name FROM migrations
    ORDER BY id ASC
  `);
  return result.rows.map(row => row.name);
}

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
}

/**
 * Create and verify a fresh full snapshot before any destructive migration.
 * Fail-closed: any backup or verification failure => throw => deployment blocked.
 */
async function createVerifiedPreDestructiveSnapshot(pendingDestructive) {
  console.log('');
  console.log('⚠️  DESTRUCTIVE MIGRATION GATE: detected pending destructive migration(s):');
  for (const d of pendingDestructive) {
    console.log(`   - ${d.file}: ${d.reasons.join(', ')}`);
  }
  console.log('');
  console.log(`Production gate: ALLOW_DESTRUCTIVE_MIGRATIONS=${process.env.ALLOW_DESTRUCTIVE_MIGRATIONS || '(default)'} | NODE_ENV=${process.env.NODE_ENV || 'development'}`);
  if (isProduction() && !allowDestructive()) {
    console.error('');
    console.error('⛔ BLOCKED: Destructive migrations are disabled in production.');
    console.error('To allow, set ALLOW_DESTRUCTIVE_MIGRATIONS=true AND ensure a verified backup succeeds.');
    console.error('This is intentional — prevents 056-style wipes without explicit manual override.');
    console.error('');
    throw new Error('Destructive migrations blocked by ALLOW_DESTRUCTIVE_MIGRATIONS policy');
  }
  console.log('Proceeding with mandatory verified backup (fail-closed)...');
  const backupService = require('./src/services/backupService');
  const start = Date.now();
  const result = await backupService.runBackup(pool, { snapshotType: 'pre-destructive', verify: true });
  const elapsed = Date.now() - start;
  if (!result.verified) {
    throw new Error(`Pre-destructive backup verification failed: ${result.verifyError || 'unknown'}`);
  }
  if (!result.fileId || !result.bytes || result.bytes < 100) {
    throw new Error('Pre-destructive backup verification failed: missing or empty file');
  }
  console.log(`✓ Verified pre-destructive snapshot: ${result.fileId} (${result.bytes} bytes, ${Object.values(result.rowCounts).reduce((a,b)=>a+b,0)} rows, ${elapsed}ms)`);
  console.log(`  checksum: ${result.checksum}`);
  console.log(`  type: ${result.snapshotType} | git: ${result.gitCommit.slice(0,8)} | verified: ${result.verified}`);
  // Record preflight metadata into migrations table for audit (non-blocking)
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS migration_preflight (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        git_commit TEXT,
        snapshot_id TEXT,
        file_id TEXT,
        checksum TEXT,
        pending_files TEXT[]
      )`
    );
    await pool.query(
      `INSERT INTO migration_preflight (git_commit, snapshot_id, file_id, checksum, pending_files) VALUES ($1,$2,$3,$4,$5)`,
      [result.gitCommit, result.snapshotId, result.fileId, result.checksum, pendingDestructive.map(d=>d.file)]
    );
  } catch (e) {
    console.warn(`[migrate] preflight audit insert failed (non-fatal): ${e.message}`);
  }
  // Also emit a journal event for the preflight
  try {
    const changeJournal = require('./src/services/changeJournal');
    await changeJournal.recordAndFlush({
      operation: 'MIGRATION_PRE_DESTRUCTIVE_BACKUP',
      source: 'migration',
      actorType: 'SYSTEM',
      entity: 'migration_preflight',
      metadata: {
        pendingDestructive: pendingDestructive.map(d=>({file:d.file, reasons:d.reasons})),
        snapshotId: result.snapshotId,
        fileId: result.fileId,
        checksum: result.checksum,
        gitCommit: result.gitCommit,
      },
      success: true,
    });
  } catch {}
  return result;
}

function resolveMigrationsDir() {
  // Production: only migrations/ is executed.
  // Test isolation: test/migrations or ops/migrations are NOT auto-executed in production.
  // Use --migrations-dir override if needed.
  const argIdx = process.argv.indexOf('--migrations-dir');
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    return path.resolve(process.argv[argIdx + 1]);
  }
  // Explicit test mode: ALLOW_TEST_MIGRATIONS=true + NODE_ENV != production + manual flag
  return path.join(__dirname, 'migrations');
}

async function runMigrations() {
  const args = process.argv.slice(2);
  const command = args[0] || 'up';

  console.log('=== VoteWeb Migration Runner (hardened) ===');
  console.log('Database:', process.env.DATABASE_URL ? '(using DATABASE_URL)' : 'ERROR: No DATABASE_URL');
  console.log('SSL:', process.env.DB_SSL === 'true' ? 'enabled' : 'disabled');
  console.log('Env:', process.env.NODE_ENV || 'development');
  console.log('Git:', getGitCommit().slice(0, 8));
  console.log('Policy: ALLOW_DESTRUCTIVE_MIGRATIONS=' + (process.env.ALLOW_DESTRUCTIVE_MIGRATIONS || (isProduction() ? 'false (default prod)' : 'true (default dev)')));
  console.log('');

  // Test connection first
  try {
    await pool.query('SELECT 1');
    console.log('✓ Database connection established');
  } catch (err) {
    console.error('✗ Database connection failed:', err.message);
    process.exit(1);
  }

  await ensureMigrationsTable();

  const migrationsDir = resolveMigrationsDir();
  if (!fs.existsSync(migrationsDir)) {
    console.error(`Migrations directory not found: ${migrationsDir}`);
    process.exit(1);
  }
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const applied = await getAppliedMigrations();

  if (command === 'up') {
    console.log(`Found ${files.length} migration files in ${path.relative(process.cwd(), migrationsDir)}`);
    console.log(`Applied: ${applied.length}, Pending: ${files.filter(f=>!applied.includes(f)).length}\n`);

    // Preflight: classify pending
    const pendingFiles = files.filter(f => !applied.includes(f));
    const pendingWithSql = pendingFiles.map(file => ({
      file,
      sql: fs.readFileSync(path.join(migrationsDir, file), 'utf8'),
    }));
    const { destructive, all } = filterDestructive(pendingWithSql);
    if (pendingWithSql.length) {
      console.log('Pending classification:');
      for (const r of all) {
        const status = r.isDestructive ? '⚠️  DESTRUCTIVE' : '✓ safe';
        const detail = r.reasons.length ? ` (${r.reasons.join(', ')})` : '';
        console.log(`  ${status}: ${r.file}${detail}`);
      }
      console.log('');
    }
    // Mandatory verified backup gate for any destructive pending
    if (destructive.length > 0) {
      try {
        await createVerifiedPreDestructiveSnapshot(destructive);
      } catch (err) {
        console.error('');
        console.error(`⛔ MIGRATION BLOCKED: verified backup gate failed: ${err.message}`);
        console.error('Deployment will fail safely. Fix Appwrite config or set ALLOW_DESTRUCTIVE_MIGRATIONS appropriately.');
        console.error('');
        await pool.end();
        process.exit(1);
      }
    }

    for (const file of files) {
      if (applied.includes(file)) {
        console.log(`Skipping (already applied): ${file}`);
        continue;
      }

      console.log(`Applying: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      // Double-check per-file destructive still requires backup already done; if not destructively flagged but actually destructive, also gate
      const classification = filterDestructive([{ file, sql }]);
      if (classification.destructive.length && destructive.length === 0) {
        // Edge: pending set changed? re-gate
        console.warn(`[migrate] late destructive detection for ${file} — re-validating backup gate`);
        try {
          await createVerifiedPreDestructiveSnapshot(classification.destructive);
        } catch (err) {
          console.error(`⛔ BLOCKED ${file}: ${err.message}`);
          await pool.end();
          process.exit(1);
        }
      }

      try {
        await pool.query('BEGIN');
        await pool.query(sql);
        await pool.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
        await pool.query('COMMIT');
        console.log(`  ✓ Applied: ${file}`);
        // Journal migration apply
        try {
          const changeJournal = require('./src/services/changeJournal');
          changeJournal.record({
            operation: 'MIGRATION_APPLIED',
            source: 'migration',
            actorType: 'SYSTEM',
            entity: 'migrations',
            entityId: file,
            metadata: { file, gitCommit: getGitCommit() },
            success: true,
          });
        } catch {}
      } catch (err) {
        await pool.query('ROLLBACK');
        console.error(`  ✗ Failed: ${file}`);
        console.error(`  Error: ${err.message}`);
        try {
          const changeJournal = require('./src/services/changeJournal');
          await changeJournal.recordAndFlush({
            operation: 'MIGRATION_FAILED',
            source: 'migration',
            actorType: 'SYSTEM',
            entity: 'migrations',
            entityId: file,
            metadata: { file, error: err.message, gitCommit: getGitCommit() },
            success: false,
          });
        } catch {}
        process.exit(1);
      }
    }

    // Flush journal after all migrations
    try { await require('./src/services/changeJournal').flush(); } catch {}
    console.log('\n=== All migrations complete ===');
  } else if (command === 'down') {
    const migrationName = args[1];
    if (!migrationName) {
      console.error('Usage: node migrate.js down <migration_name>');
      process.exit(1);
    }

    const rollbackFile = migrationName.replace('.sql', '_rollback.sql');
    const rollbackPath = path.join(migrationsDir, rollbackFile);

    if (!fs.existsSync(rollbackPath)) {
      console.error(`Rollback file not found: ${rollbackFile}`);
      process.exit(1);
    }

    console.log(`Rolling back: ${migrationName}`);
    const sql = fs.readFileSync(rollbackPath, 'utf8');

    try {
      await pool.query('BEGIN');
      await pool.query(sql);
      await pool.query('DELETE FROM migrations WHERE name = $1', [migrationName]);
      await pool.query('COMMIT');
      console.log(`  ✓ Rolled back: ${migrationName}`);
    } catch (err) {
      await pool.query('ROLLBACK');
      console.error(`  ✗ Rollback failed: ${err.message}`);
      process.exit(1);
    }
  } else if (command === 'status') {
    console.log('Migration status:\n');
    console.log('Applied:');
    for (const m of applied) {
      console.log(`  ✓ ${m}`);
    }
    const pending = files.filter(f => !applied.includes(f));
    console.log('\nPending:');
    for (const f of pending) {
      const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
      const cls = require('./src/lib/destructiveDetection').isDestructiveSql(sql, f);
      const tag = cls.isDestructive ? ` [DESTRUCTIVE: ${cls.reasons.join(', ')}]` : '';
      console.log(`  ○ ${f}${tag}`);
    }
    if (isProduction()) {
      console.log(`\nProduction gate: ALLOW_DESTRUCTIVE_MIGRATIONS=${process.env.ALLOW_DESTRUCTIVE_MIGRATIONS || 'false (default)'}`);
    }
  } else if (command === 'reset') {
    if (isProduction()) {
      console.error('⛔ reset is blocked in production (NODE_ENV=production). Use a non-production database.');
      await pool.end();
      process.exit(1);
    }
    // Also require explicit env for dev reset safety
    if (process.env.ALLOW_RESET !== 'true') {
      console.error('⛔ reset requires ALLOW_RESET=true (safety). Set ALLOW_RESET=true to confirm.');
      await pool.end();
      process.exit(1);
    }
    console.log('WARNING: This will drop all tables and re-run migrations');
    console.log('Type "yes" to confirm: ');
    const answer = await new Promise(resolve => {
      process.stdin.once('data', d => resolve(d.toString().trim()));
    });

    if (answer !== 'yes') {
      console.log('Aborted.');
      process.exit(0);
    }

    // Mandatory backup before reset in non-prod as well (fail-closed)
    try {
      const backupService = require('./src/services/backupService');
      console.log('Creating verified snapshot before reset...');
      const res = await backupService.runBackup(pool, { snapshotType: 'pre-destructive', verify: true });
      if (!res.verified) throw new Error(res.verifyError || 'verification failed');
      console.log(`✓ Pre-reset snapshot verified: ${res.fileId}`);
    } catch (err) {
      console.error(`⛔ reset blocked: backup failed: ${err.message}`);
      await pool.end();
      process.exit(1);
    }

    await pool.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN (
          SELECT tablename FROM pg_tables
          WHERE schemaname = 'public'
          AND tablename != 'migrations'
        ) LOOP
          EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);

    console.log('Tables dropped. Re-running migrations...\n');
    // Use a fresh call but avoid infinite recursion: directly re-enter up logic
    const appliedAfterDrop = [];
    const filesAfterDrop = fs.readdirSync(migrationsDir).filter(f=>f.endsWith('.sql')).sort();
    for (const file of filesAfterDrop) {
      if (appliedAfterDrop.includes(file)) continue;
      console.log(`Applying: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      try {
        await pool.query('BEGIN');
        await pool.query(sql);
        await pool.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
        await pool.query('COMMIT');
        console.log(`  ✓ Applied: ${file}`);
      } catch (err) {
        await pool.query('ROLLBACK');
        console.error(`  ✗ Failed: ${file}`);
        console.error(`  Error: ${err.message}`);
        process.exit(1);
      }
    }
    console.log('\n=== Reset complete ===');
  } else if (command === 'verify') {
    // Verify latest snapshot integrity
    const backupService = require('./src/services/backupService');
    const files = await backupService.listBackups();
    if (!files.length) {
      console.log('No snapshots found.');
    } else {
      console.log(`Latest snapshot: ${files[0].name} (${files[0].fileId})`);
      const v = await backupService.verifyBackup(files[0].fileId);
      if (v.valid) {
        console.log('✓ Snapshot integrity verified');
        console.log(`  checksum: ${v.checksum}`);
        console.log(`  tables: ${Object.keys(v.snapshot.tables || {}).length}, rows: ${Object.values(v.snapshot.row_counts || {}).reduce((a,b)=>a+b,0)}`);
      } else {
        console.error(`✗ Verification failed: ${v.error}`);
        process.exit(1);
      }
    }
  }

  await pool.end();
}

runMigrations().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
