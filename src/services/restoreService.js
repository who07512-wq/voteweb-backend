/**
 * Restore Service — Hardened (service-layer prod guards)
 * Ensures no direct call can bypass production safety.
 */
const backupService = require('./backupService');
const changeJournal = require('./changeJournal');
const crypto = require('node:crypto');

function isProdTarget(target) {
  const t = String(target || process.env.DATABASE_URL || '');
  return /onrender|render\.com|rds\.amazonaws|prod/i.test(t) || process.env.NODE_ENV === 'production';
}

async function safeRestore(snapshot, pool, opts = {}) {
  const { target, confirmToken, allowProd } = opts;

  if (!target && !process.env.DATABASE_URL) {
    const err = new Error('Restore requires explicit target (DATABASE_URL or --target)');
    err.code = 'RESTORE_TARGET_REQUIRED';
    err.status = 400;
    throw err;
  }
  const targetUrl = target || process.env.DATABASE_URL;

  if (!snapshot) {
    const err = new Error('Snapshot is required');
    err.code = 'RESTORE_SNAPSHOT_REQUIRED';
    err.status = 400;
    throw err;
  }

  // Verify snapshot integrity (checksum + row counts)
  const integrity = backupService.verifySnapshotIntegrity(snapshot);
  if (!integrity.valid) {
    const err = new Error(`Snapshot integrity failed: ${integrity.error}`);
    err.code = 'RESTORE_CHECKSUM_FAILED';
    err.status = 400;
    throw err;
  }
  // Also verify core tables
  const v = await backupService.verifyBackup ? null : null; // placeholder
  // verifyBackup already checks core tables; we replicate minimal check here without Appwrite fetch
  const expectedCore = ['elections', 'students', 'constituencies', 'positions', 'candidates', 'candidate_applications', 'votes', 'voter_authorizations'];
  const missing = expectedCore.filter(t => !(t in (snapshot.tables || {})));
  if (missing.length) {
    const err = new Error(`Snapshot missing core tables: ${missing.join(', ')}`);
    err.code = 'RESTORE_MISSING_TABLES';
    err.status = 400;
    throw err;
  }

  // Production guard
  if (isProdTarget(targetUrl)) {
    if (allowProd !== true && process.env.ALLOW_PRODUCTION_RESTORE !== 'true') {
      const err = new Error('Production restore blocked: ALLOW_PRODUCTION_RESTORE=true required');
      err.code = 'PROD_RESTORE_BLOCKED';
      err.status = 403;
      throw err;
    }
    if (!confirmToken || (confirmToken !== snapshot.snapshot_id && confirmToken !== snapshot.checksum)) {
      const err = new Error('Production restore requires --confirm <snapshot_id|checksum> matching snapshot');
      err.code = 'PROD_RESTORE_CONFIRM_REQUIRED';
      err.status = 403;
      throw err;
    }
  } else {
    // Non-prod still requires confirmToken if snapshot is prod-like? No, but if opts.confirm is required for safety, enforce when provided?
  }

  // Pre-restore backup (fail-closed) — must use SAME target pool for backup and restore
  // Prefer explicit pool for target to avoid env mutation race; fallback to passed pool or global
  let targetPool = pool;
  let tempPool = null;
  if (target && !pool) {
    const { Pool } = require('pg');
    tempPool = new Pool({ connectionString: targetUrl, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined, connectionTimeoutMillis: 10000 });
    targetPool = tempPool;
  } else if (!targetPool) {
    targetPool = require('../db').pool;
  }
  let preBackup = null;
  try {
    preBackup = await backupService.runBackup(targetPool, { snapshotType: 'pre-restore', verify: true });
    if (!preBackup.verified) throw new Error(preBackup.verifyError || 'pre-restore backup not verified');
  } catch (e) {
    if (tempPool) await tempPool.end().catch(() => {});
    const err = new Error(`Pre-restore backup failed: ${e.message}`);
    err.code = 'PRE_RESTORE_BACKUP_FAILED';
    err.status = 503;
    throw err;
  }

  // Journal restore started (durable)
  try {
    changeJournal.record({
      operation: 'RESTORE_STARTED',
      source: 'restore',
      actorType: 'SYSTEM',
      entity: 'db_restore',
      entityId: snapshot.snapshot_id,
      before: null,
      after: { target: String(targetUrl).replace(/:\/\/[^@]+@/, '://***@'), snapshotId: snapshot.snapshot_id, checksum: snapshot.checksum, preBackupId: preBackup.fileId },
      success: true,
      metadata: { snapshotId: snapshot.snapshot_id, preBackupId: preBackup.fileId },
    });
    await changeJournal.flush();
  } catch {}

  // Perform actual restore via backupService (data-only, TRUNCATE + insert) on SAME target pool
  let restored;
  try {
    restored = await backupService.restoreSnapshot(snapshot, targetPool);
  } finally {
    if (tempPool) await tempPool.end().catch(() => {});
  }

  try {
    changeJournal.record({
      operation: 'RESTORE_COMPLETED',
      source: 'restore',
      actorType: 'SYSTEM',
      entity: 'db_restore',
      entityId: snapshot.snapshot_id,
      after: { restored, snapshotId: snapshot.snapshot_id },
      success: true,
      metadata: { snapshotId: snapshot.snapshot_id, preBackupId: preBackup.fileId },
    });
    await changeJournal.flush();
  } catch {}

  return { restored, preBackup };
}

module.exports = { safeRestore, isProdTarget };
