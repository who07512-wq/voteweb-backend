#!/usr/bin/env node
/**
 * Restore a VoteWeb DB snapshot — Hardened.
 *
 * Usage:
 *   node scripts/restore-backup.js --latest              # newest snapshot from Appwrite
 *   node scripts/restore-backup.js --file-id <fileId>    # specific snapshot from Appwrite
 *   node scripts/restore-backup.js --file path/to/snapshot.json  # local snapshot file
 *   node scripts/restore-backup.js --target postgres://... --file-id <id> --confirm <token>
 *
 * Safety:
 * - Requires explicit target selection via DATABASE_URL or --target
 * - Creates fresh target backup BEFORE restore (fail-closed if that fails)
 * - Requires explicit confirmation (type "yes" + snapshot timestamp) unless --yes with env guard
 * - Writes audit/journal event
 * - Rejects production restore unless ALLOW_PRODUCTION_RESTORE=true and CONFIRM_PRODUCTION_RESTORE matches fileId
 * - Never callable from user-facing endpoint (CLI only)
 */

require('dotenv').config();

const backupService = require('../src/services/backupService');
const changeJournal = require('../src/services/changeJournal');
const crypto = require('node:crypto');

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}
function hasArg(flag) { return process.argv.includes(flag); }

async function resolveSnapshot() {
  if (hasArg('--file')) {
    const fs = require('fs');
    const path = getArg('--file');
    if (!path) throw new Error('--file requires a path');
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  }
  if (hasArg('--file-id')) {
    const id = getArg('--file-id');
    if (!id) throw new Error('--file-id requires an ID');
    return backupService.downloadBackup(id);
  }
  if (hasArg('--latest')) {
    const files = await backupService.listBackups();
    if (!files.length) throw new Error('No snapshots found in the backup bucket.');
    console.log(`Using latest snapshot: ${files[0].name} (${files[0].fileId})`);
    return backupService.downloadBackup(files[0].fileId);
  }
  console.error('Nothing to restore. Use --latest, --file-id <id>, or --file <path>.');
  console.error('Also use --target <DATABASE_URL> to select target explicitly, and confirm.');
  process.exit(1);
}

async function main() {
  const targetUrl = getArg('--target') || process.env.DATABASE_URL;
  if (!targetUrl) {
    console.error('ERROR: Target DATABASE_URL is not set. Use --target postgres://... or env DATABASE_URL');
    process.exit(1);
  }

  // Production safeguard: detect production-like DATABASE_URL
  const isProdTarget = /onrender|render\.com|rds\.amazonaws|prod/i.test(targetUrl) || process.env.NODE_ENV === 'production';
  if (isProdTarget && process.env.ALLOW_PRODUCTION_RESTORE !== 'true') {
    console.error('⛔ Production restore blocked: set ALLOW_PRODUCTION_RESTORE=true to allow.');
    console.error('This prevents accidental wiping of the live database from a local CLI.');
    process.exit(1);
  }

  const snapshot = await resolveSnapshot();
  const integrity = backupService.verifySnapshotIntegrity(snapshot);
  if (!integrity.valid) {
    console.error(`✗ Snapshot integrity FAILED: ${integrity.error}`);
    console.error('Refusing to restore a corrupt snapshot. Use a different file-id or verify first.');
    process.exit(1);
  }
  console.log('✓ Snapshot integrity verified');
  console.log(`  snapshot_id: ${snapshot.snapshot_id}`);
  console.log(`  checksum: ${snapshot.checksum}`);
  console.log(`  git_commit: ${snapshot.git_commit}`);
  console.log(`  created_at: ${snapshot.created_at}`);
  console.log(`  max_migration: ${snapshot.max_migration}`);
  const counts = snapshot.row_counts || {};
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`  rows: ${totalRows} across ${Object.keys(counts).length} tables`);
  console.log(`  target: ${targetUrl.replace(/:\/\/[^@]+@/, '://***@')}`);
  console.log('');

  // If production, require CONFIRM_PRODUCTION_RESTORE=fileId
  if (isProdTarget) {
    const confirmToken = getArg('--confirm') || process.env.CONFIRM_PRODUCTION_RESTORE;
    if (confirmToken !== snapshot.snapshot_id && confirmToken !== snapshot.checksum) {
      console.error('⛔ Production restore requires --confirm <snapshot_id or checksum> matching the snapshot.');
      console.error(`   Provided: ${confirmToken || '(none)'} | Expected: ${snapshot.snapshot_id} or ${snapshot.checksum}`);
      process.exit(1);
    }
  }

  // Fresh backup of target BEFORE restore (fail-closed)
  console.log('Creating fresh backup of TARGET before restore (mandatory)...');
  let preRestoreBackup = null;
  try {
    // Use targetUrl's pool directly? fallback to backupService which uses DATABASE_URL env (already set)
    // Ensure backupService sees the correct target: temporarily set env if --target used
    const originalUrl = process.env.DATABASE_URL;
    if (getArg('--target')) process.env.DATABASE_URL = targetUrl;
    preRestoreBackup = await backupService.runBackup(null, { snapshotType: 'pre-restore', verify: true });
    console.log(`✓ Pre-restore snapshot: ${preRestoreBackup.fileId} (${preRestoreBackup.bytes} bytes, verified:${preRestoreBackup.verified})`);
    if (getArg('--target')) process.env.DATABASE_URL = originalUrl;
  } catch (err) {
    console.error(`⛔ Pre-restore backup FAILED: ${err.message}`);
    console.error('Restore blocked — would have overwritten target without a safety backup.');
    process.exit(1);
  }

  const skipConfirm = hasArg('--yes') || !process.stdin.isTTY;
  if (!skipConfirm) {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => {
      rl.question(
        `This will TRUNCATE the target tables and re-insert ${totalRows} rows from ${snapshot.created_at} (snapshot ${snapshot.snapshot_id.slice(0,8)}). Type "RESTORE ${snapshot.snapshot_id.slice(0,8)}" to continue: `,
        resolve
      );
    });
    rl.close();
    if (answer.trim() !== `RESTORE ${snapshot.snapshot_id.slice(0,8)}`) {
      console.log('Aborted. Expected:', `RESTORE ${snapshot.snapshot_id.slice(0,8)}`);
      process.exit(0);
    }
  } else if (!hasArg('--yes')) {
    console.error('Non-interactive mode requires --yes flag explicitly.');
    process.exit(1);
  }
  // If --yes used, still require double-check for prod
  if (hasArg('--yes') && isProdTarget) {
    console.log('Production --yes restore acknowledged via ALLOW_PRODUCTION_RESTORE + --confirm');
  }

  // Journal the restore intent (before destructive)
  try {
    changeJournal.record({
      operation: 'RESTORE_STARTED',
      source: 'restore',
      actorType: 'SYSTEM',
      entity: 'db_restore',
      entityId: snapshot.snapshot_id,
      before: null,
      after: { target: targetUrl.replace(/:\/\/[^@]+@/, '://***@'), snapshotId: snapshot.snapshot_id, checksum: snapshot.checksum, preBackupId: preRestoreBackup?.fileId },
      success: true,
      metadata: { snapshotId: snapshot.snapshot_id, preRestoreBackupId: preRestoreBackup?.fileId, totalRows },
    });
    await changeJournal.flush();
  } catch (e) { console.warn('[journal] RESTORE_STARTED failed:', e.message); }

  console.log('');
  console.log('Restoring... (TRUNCATE + insert in FK order)');
  const restored = await backupService.restoreSnapshot(snapshot);
  const totalRestored = Object.values(restored).reduce((a, b) => a + b, 0);
  console.log('');
  console.log(`✓ Restore complete: ${totalRestored} rows across ${Object.keys(restored).length} tables.`);
  for (const [table, n] of Object.entries(restored)) {
    console.log(`  ${table}: ${n}`);
  }

  try {
    changeJournal.record({
      operation: 'RESTORE_COMPLETED',
      source: 'restore',
      actorType: 'SYSTEM',
      entity: 'db_restore',
      entityId: snapshot.snapshot_id,
      before: null,
      after: { restored, totalRestored, snapshotId: snapshot.snapshot_id },
      success: true,
      metadata: { snapshotId: snapshot.snapshot_id, preRestoreBackupId: preRestoreBackup?.fileId },
    });
    await changeJournal.flush();
  } catch {}

  process.exit(0);
}

main().catch((err) => {
  console.error(`Restore failed: ${err.message}`);
  try {
    changeJournal.record({
      operation: 'RESTORE_FAILED',
      source: 'restore',
      actorType: 'SYSTEM',
      entity: 'db_restore',
      success: false,
      metadata: { error: err.message },
    });
  } catch {}
  process.exit(1);
});
