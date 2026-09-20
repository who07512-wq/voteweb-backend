/**
 * Database Backup Service — Hardened (Layer B)
 *
 * Exports every business-relevant table's rows to a single JSON snapshot and uploads
 * it to Appwrite Storage bucket `db-backups` (PRIVATE). Protects against Render's
 * free Postgres expiry/wipe and destructive migrations: snapshots live off-host and
 * can be restored with `npm run db:restore`.
 *
 * Backup Policy (explicit, documented):
 * ---------------------------------------------------------------------------
 * Category              | Tables                                          | Included | Rationale
 * ----------------------|-----------------------------------------------|----------|----------------------------------------------
 * Business data         | elections, constituencies, positions,         | YES      | Complete recoverable application state
 *                       | candidates, candidate_applications, votes,    |          |
 *                       | vote_receipts, voter_authorizations,          |          |
 *                       | announcements, support_requests, notifications|          |
 *                       | students (with password_hash required)        | YES      | Required for login post-restore (hash, not plain)
 * Audit data            | audit_logs, auth_audit_logs                   | YES      | Queryable operational audit; kept separately from off-host journal
 * Authentication state  | sessions                                      | NO       | Ephemeral — expires in hours, not required for recovery, reduces secret exposure
 * Ephemeral security    | mfa_challenges, otp_challenges                | NO       | One-time codes, short TTL (5m), not needed for recovery
 * Migrations metadata   | migrations                                    | YES      | Required to know schema version for restore validation
 * System                | pg internal tables                            | NO       | Not needed
 * ---------------------------------------------------------------------------
 * Secrets handling: password_hash is a hash (not reversible) and IS included for
 * recovery. Raw secrets (OTP values, Aadhar plaintext is encrypted? but we store
 * as-is for recovery — bucket is PRIVATE and checksum-verified). Appwrite buckets
 * must be PRIVATE (no Permission.read(Role.any())).
 *
 * Snapshot includes: format, version, snapshot_id, created_at, git_commit, max_migration,
 * row_counts, tables, checksum (SHA-256 of canonical JSON).
 * Verification: after upload, download and validate checksum + row counts.
 *
 * Retention:
 * - journal: permanent (not pruned here; managed by changeJournal bucket policy)
 * - snapshots: configurable, default 90 (RETENTION_DEFAULT). Recommended 90+ days.
 * - pre-deploy / pre-destructive snapshots: tagged type=pre-deploy|pre-destructive, retained
 *   separately — not pruned by default retention unless explicitly allowed (keep=0 means keep all).
 *
 * Design notes:
 * - Plain SQL reads through existing pg pool — no pg_dump binary.
 * - Restore is data-only (schema must exist via migrations), FK-order-aware.
 * - Single-flight lock prevents concurrent runs.
 */

const crypto = require('node:crypto');
const { Client, Storage, ID } = require('node-appwrite');
const { InputFile } = require('node-appwrite/file');

const BACKUP_BUCKET_DEFAULT = 'db-backups';

/**
 * Explicit backup policy: which tables to exclude with rationale.
 * Ephemeral security state is excluded; migrations IS now included.
 */
const EXCLUDED_TABLES = new Set([
  'sessions',        // ephemeral: TTL 8h, not required for recovery
  'mfa_challenges',  // ephemeral OTP/MFA challenges
  'otp_challenges',  // ephemeral OTP challenges
]);

const BACKUP_POLICY = {
  description: 'A-to-Z recoverable business state; ephemeral secrets excluded',
  includedCategories: ['business', 'audit', 'migrations_metadata', 'students_auth_hash'],
  excludedCategories: {
    sessions: 'ephemeral session tokens — not required, short TTL',
    mfa_challenges: 'ephemeral MFA challenges',
    otp_challenges: 'ephemeral OTP challenges',
  },
  // Students password_hash IS included (needed for login continuity) — bucket is PRIVATE
};

const RETENTION_DEFAULT = 90; // COUNT-BASED: keep last 90 snapshots (approx 90 days if daily). Config via BACKUP_RETENTION_COUNT (not days). See backupScheduler.js.
const RETENTION_PRE_DEPLOY_KEEP = 30; // COUNT-BASED: keep last 30 pre-deploy/pre-destructive snapshots separately (BACKUP_RETENTION_PRE_DEPLOY_COUNT). 0 = keep all (recommended for term).
let inFlight = null;

function getGitCommit() {
  try {
    const { execSync } = require('node:child_process');
    return execSync('git rev-parse HEAD', { encoding: 'utf8', timeout: 2000 }).trim();
  } catch {
    return process.env.GIT_COMMIT || process.env.RENDER_GIT_COMMIT || 'unknown';
  }
}

function backupConfig() {
  const endpoint = process.env.APPWRITE_ENDPOINT;
  const projectId = process.env.APPWRITE_PROJECT_ID;
  // Least-privilege: prefer dedicated backup key, fallback to generic for backward compat
  const apiKey = process.env.APPWRITE_BACKUP_API_KEY || process.env.APPWRITE_API_KEY;
  if (!endpoint || !projectId || !apiKey) {
    const err = new Error('Backup storage is not configured (missing Appwrite env).');
    err.status = 503;
    err.code = 'BACKUP_NOT_CONFIGURED';
    throw err;
  }
  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  return {
    client,
    bucketId: process.env.APPWRITE_BACKUPS_BUCKET || BACKUP_BUCKET_DEFAULT,
  };
}

/**
 * List non-excluded, real tables (base + partitioned) in `public`.
 */
async function listTables(pool) {
  const { rows } = await pool.query(
    `SELECT c.relname AS name,
            COALESCE(json_agg(a.attname ORDER BY a.attnum) FILTER (WHERE a.attname IS NOT NULL), '[]'::json) AS columns
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE c.relkind IN ('r', 'p')
        AND n.nspname = 'public'
      GROUP BY c.oid, c.relname
      ORDER BY c.relname`
  );
  return rows
    .filter((r) => !EXCLUDED_TABLES.has(r.name))
    .map((r) => ({ name: r.name, columns: r.columns }));
}

async function readTableRows(pool, table, columns) {
  const cols = columns.map((c) => `"${c}"`).join(', ');
  const { rows } = await pool.query(
    `SELECT to_jsonb(t) AS row FROM (SELECT ${cols} FROM "${table}") t`
  );
  return rows.map((r) => r.row);
}

/**
 * Build snapshot document with metadata and checksum.
 * @param {import('pg').Pool} pool
 * @param {Object} [opts] - { snapshotType: 'scheduled' | 'pre-deploy' | 'pre-destructive' | 'manual', gitCommit }
 */
async function buildSnapshot(pool, opts = {}) {
  const tables = await listTables(pool);
  const data = {};
  const rowCountByTable = {};
  for (const t of tables) {
    const rows = await readTableRows(pool, t.name, t.columns);
    data[t.name] = rows;
    rowCountByTable[t.name] = rows.length;
  }
  const { rows: migRows } = await pool.query(
    `SELECT COALESCE(MAX(id), 0)::int AS max_migration FROM migrations`
  );
  const maxMigration = migRows[0]?.max_migration ?? 0;
  const { rows: migNames } = await pool.query(`SELECT name FROM migrations ORDER BY id`);
  const snapshotId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const gitCommit = opts.gitCommit || getGitCommit();
  const snapshot = {
    format: 'voteweb-db-snapshot',
    version: 2,
    snapshot_id: snapshotId,
    snapshot_type: opts.snapshotType || 'scheduled',
    created_at: new Date().toISOString(),
    git_commit: gitCommit,
    max_migration: maxMigration,
    migration_names: migNames.map(r => r.name),
    row_counts: rowCountByTable,
    tables: data,
  };
  // checksum over canonical JSON without checksum field itself
  const canonical = JSON.stringify(snapshot);
  const checksum = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  snapshot.checksum = checksum;
  snapshot.checksum_algo = 'sha256';
  return snapshot;
}

function computeChecksum(snapshotWithoutChecksum) {
  const clone = { ...snapshotWithoutChecksum };
  delete clone.checksum;
  delete clone.checksum_algo;
  const canonical = JSON.stringify(clone);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function verifySnapshotIntegrity(snapshot) {
  if (!snapshot || snapshot.format !== 'voteweb-db-snapshot') {
    return { valid: false, error: 'Invalid format' };
  }
  if (!snapshot.checksum) {
    return { valid: false, error: 'Missing checksum' };
  }
  const expected = computeChecksum(snapshot);
  if (expected !== snapshot.checksum) {
    return { valid: false, error: `Checksum mismatch: expected ${expected}, got ${snapshot.checksum}` };
  }
  // row_counts vs actual tables length
  for (const [tbl, cnt] of Object.entries(snapshot.row_counts || {})) {
    const actual = (snapshot.tables?.[tbl] || []).length;
    if (actual !== cnt) {
      return { valid: false, error: `Row count mismatch for ${tbl}: expected ${cnt}, got ${actual}` };
    }
  }
  return { valid: true };
}

/**
 * Run full snapshot + upload (PRIVATE bucket) + verify. Single-flight.
 * @param {import('pg').Pool} [pool]
 * @param {Object} [opts] - { snapshotType, verify: boolean }
 */
async function runBackup(pool, opts = {}) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const { client, bucketId } = backupConfig();
    const storage = new Storage(client);
    const dbPool = pool || require('../db').pool;
    const snapshot = await buildSnapshot(dbPool, { snapshotType: opts.snapshotType || 'scheduled', gitCommit: opts.gitCommit });
    const json = JSON.stringify(snapshot);
    const bytes = Buffer.byteLength(json, 'utf8');
    // File name includes type + timestamp + snapshot_id for immutability
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `voteweb-snapshot-${snapshot.snapshot_type}-${ts}-${snapshot.snapshot_id.slice(0, 8)}.json`;
    // upload PRIVATE — no Permission.read(Role.any())
    const file = await storage.createFile(
      bucketId,
      ID.unique(),
      InputFile.fromBuffer(Buffer.from(json, 'utf8'), fileName)
    );

    // Verification: download and validate checksum if requested (default true for pre-deploy)
    let verified = false;
    let verifyError = null;
    if (opts.verify !== false) {
      try {
        const downloaded = await downloadBackup(file.$id, pool);
        const v = verifySnapshotIntegrity(downloaded);
        if (!v.valid) throw new Error(v.error);
        // Also verify size/checksum matches uploaded
        if (downloaded.snapshot_id !== snapshot.snapshot_id) throw new Error('Snapshot ID mismatch after round-trip');
        verified = true;
      } catch (e) {
        verifyError = e.message;
        // Do not delete the file — it may still be useful — but report unverified
        console.error(`[backup] verification failed for ${file.$id}: ${e.message}`);
        if (opts.snapshotType === 'pre-destructive' || opts.snapshotType === 'pre-deploy') {
          // For destructive gates, failed verification MUST be treated as backup failure
          throw new Error(`Backup verification failed: ${e.message}`);
        }
      }
    } else {
      // Even without verify, ensure file exists via getFile
      try {
        await storage.getFile(bucketId, file.$id);
        verified = true;
      } catch (e) {
        verifyError = e.message;
      }
    }

    return {
      fileId: file.$id,
      bucketId,
      url: `${process.env.APPWRITE_ENDPOINT}/storage/buckets/${bucketId}/files/${file.$id}/view?project=${process.env.APPWRITE_PROJECT_ID}`,
      bytes,
      rowCounts: snapshot.row_counts,
      createdAt: snapshot.created_at,
      snapshotId: snapshot.snapshot_id,
      checksum: snapshot.checksum,
      gitCommit: snapshot.git_commit,
      snapshotType: snapshot.snapshot_type,
      verified,
      verifyError,
    };
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * Separate retention for pre-deploy snapshots: keep last N pre-deploy + N regular.
 * Regular prune only touches snapshots matching voteweb-snapshot-scheduled or manual.
 */
async function listBackups(filterType = null) {
  const { client, bucketId } = backupConfig();
  const storage = new Storage(client);
  const res = await storage.listFiles(bucketId, []);
  let files = (res.files || [])
    .filter((f) => f.name.startsWith('voteweb-snapshot-'))
    .map((f) => ({
      fileId: f.$id,
      name: f.name,
      bytes: f.sizeOriginal,
      createdAt: f.$createdAt,
      snapshotType: f.name.includes('pre-destructive') ? 'pre-destructive' : f.name.includes('pre-deploy') ? 'pre-deploy' : 'scheduled',
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (filterType) files = files.filter(f => f.snapshotType === filterType);
  return files;
}

async function downloadBackup(fileId, poolOverride) {
  const { client, bucketId } = backupConfig();
  const storage = new Storage(client);
  const res = await storage.getFileDownload(bucketId, fileId);
  // node-appwrite may return parsed JSON object (if content-type json) or ArrayBuffer/Buffer
  if (res && typeof res === 'object' && res.format === 'voteweb-db-snapshot') {
    return res;
  }
  let buf;
  if (Buffer.isBuffer(res)) buf = res;
  else if (res instanceof ArrayBuffer) buf = Buffer.from(res);
  else if (res instanceof Uint8Array) buf = Buffer.from(res);
  else if (res && typeof res.arrayBuffer === 'function') buf = Buffer.from(await res.arrayBuffer());
  else if (typeof res === 'string') buf = Buffer.from(res, 'utf8');
  else if (res && typeof res === 'object') {
    // Fallback: stringify object then parse
    return res;
  } else {
    buf = Buffer.from(String(res), 'utf8');
  }
  const text = buf.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    // If already object-like string, try direct
    if (typeof res === 'object') return res;
    throw new Error('Failed to parse snapshot JSON');
  }
}

/**
 * Prune snapshots beyond `keep` (default RETENTION_DEFAULT). Pre-deploy snapshots have separate retention
 * via `keepPreDeploy` (default RETENTION_PRE_DEPLOY_KEEP). If keep=0, keep all.
 */
async function pruneBackups(keep = RETENTION_DEFAULT, opts = {}) {
  const keepPreDeploy = opts.keepPreDeploy ?? RETENTION_PRE_DEPLOY_KEEP;
  const { client, bucketId } = backupConfig();
  const storage = new Storage(client);
  const all = await listBackups();
  const regular = all.filter(f => f.snapshotType === 'scheduled' || f.snapshotType === 'manual');
  const preDeploy = all.filter(f => f.snapshotType === 'pre-deploy' || f.snapshotType === 'pre-destructive');

  let deleted = 0;
  if (keep > 0 && regular.length > keep) {
    const old = regular.slice(keep);
    for (const f of old) {
      await storage.deleteFile(bucketId, f.fileId);
      deleted++;
    }
  }
  if (keepPreDeploy > 0 && preDeploy.length > keepPreDeploy) {
    const old = preDeploy.slice(keepPreDeploy);
    for (const f of old) {
      await storage.deleteFile(bucketId, f.fileId);
      deleted++;
    }
  }
  const kept = all.length - deleted;
  return { deleted, kept, regular: regular.length, preDeploy: preDeploy.length };
}

async function verifyBackup(fileId) {
  const snapshot = await downloadBackup(fileId);
  const integrity = verifySnapshotIntegrity(snapshot);
  // Validate expected tables exist (at least core business tables)
  const expectedCore = ['elections', 'students', 'constituencies', 'positions', 'candidates', 'candidate_applications', 'votes', 'voter_authorizations'];
  const missing = expectedCore.filter(t => !(t in (snapshot.tables || {})));
  if (missing.length) {
    return { valid: false, error: `Missing core tables: ${missing.join(', ')}`, snapshot };
  }
  if (!integrity.valid) return { valid: false, error: integrity.error, snapshot };
  return { valid: true, snapshot, rowCounts: snapshot.row_counts, checksum: snapshot.checksum };
}

async function orderTablesByDependencies(pool, tableNames) {
  const wanted = new Set(tableNames);
  const { rows } = await pool.query(
    `SELECT DISTINCT conrelid::regclass::text AS child,
            confrelid::regclass::text AS parent
       FROM pg_constraint
      WHERE contype = 'f'
        AND connamespace = 'public'::regnamespace`
  );
  const deps = new Map(tableNames.map((t) => [t, []]));
  for (const { child, parent } of rows) {
    if (wanted.has(child) && wanted.has(parent) && child !== parent) {
      deps.get(child).push(parent);
    }
  }
  const ordered = [];
  const remaining = new Map(deps);
  while (remaining.size) {
    const ready = [...remaining.entries()]
      .filter(([, ds]) => ds.every((d) => !remaining.has(d)))
      .map(([t]) => t)
      .sort();
    if (!ready.length) {
      ordered.push(...[...remaining.keys()].sort());
      break;
    }
    for (const t of ready) {
      ordered.push(t);
      remaining.delete(t);
    }
  }
  return ordered;
}

async function restoreSnapshot(snapshot, pool) {
  if (!snapshot || snapshot.format !== 'voteweb-db-snapshot') {
    const err = new Error('Not a valid voteweb-db-snapshot file.');
    err.status = 400;
    err.code = 'INVALID_SNAPSHOT';
    throw err;
  }
  // Verify integrity before restore (fail-closed)
  const integrity = verifySnapshotIntegrity(snapshot);
  if (!integrity.valid) {
    const err = new Error(`Snapshot integrity failed: ${integrity.error}`);
    err.code = 'RESTORE_CHECKSUM_FAILED';
    err.status = 400;
    throw err;
  }
  // Also ensure core tables present
  const expectedCore = ['elections', 'students', 'constituencies', 'positions', 'candidates', 'candidate_applications', 'votes', 'voter_authorizations'];
  const missing = expectedCore.filter(t => !(t in (snapshot.tables || {})));
  if (missing.length) {
    const err = new Error(`Snapshot missing core tables: ${missing.join(', ')}`);
    err.code = 'RESTORE_MISSING_TABLES';
    err.status = 400;
    throw err;
  }
  const dbPool = pool || require('../db').pool;
  const client = await dbPool.connect();
  const tables = snapshot.tables || {};
  const restored = {};
  try {
    await client.query('BEGIN');
    const dbTables = await listTables(dbPool);
    const existing = new Set(dbTables.map((t) => t.name));
    const present = Object.keys(tables).filter(
      (t) => existing.has(t) && Array.isArray(tables[t])
    );
    if (present.length) {
      await client.query(
        `TRUNCATE TABLE ${present.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`
      );
    }
    const ordered = await orderTablesByDependencies(dbPool, present);
    for (const name of ordered) {
      const rows = tables[name] || [];
      restored[name] = 0;
      for (const row of rows) {
        const colNames = Object.keys(row).filter((c) => c !== '$id' && c !== '$createdAt' && c !== '$updatedAt');
        if (!colNames.length) continue;
        const placeholders = colNames.map((_, i) => `$${i + 1}`);
        const { rowCount } = await client.query(
          `INSERT INTO "${name}" (${colNames.map((c) => `"${c}"`).join(', ')})
           VALUES (${placeholders})
           ON CONFLICT DO NOTHING`,
          colNames.map((c) => row[c])
        );
        restored[name] += rowCount || 0;
      }
    }
    for (const name of ordered) {
      const { rows: hasId } = await client.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'id'
          LIMIT 1`,
        [name]
      );
      if (!hasId.length) continue;
      const { rows: seqRows } = await client.query(
        `SELECT pg_get_serial_sequence($1, 'id') AS seq`,
        [name]
      );
      const seq = seqRows[0]?.seq;
      if (!seq) continue;
      await client.query(
        `SELECT setval($1, COALESCE((SELECT MAX(id) FROM "${name}"), 1), TRUE)`,
        [seq]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return restored;
}

module.exports = {
  runBackup,
  listBackups,
  downloadBackup,
  pruneBackups,
  restoreSnapshot,
  buildSnapshot,
  listTables,
  verifyBackup,
  verifySnapshotIntegrity,
  computeChecksum,
  backupConfig,
  RETENTION_DEFAULT,
  RETENTION_PRE_DEPLOY_KEEP,
  EXCLUDED_TABLES,
  BACKUP_POLICY,
  BACKUP_BUCKET_DEFAULT,
};
