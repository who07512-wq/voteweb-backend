/**
 * Backup Scheduler — Hardened
 *
 * Starts an interval timer that runs a DB snapshot + retention prune every
 * BACKUP_INTERVAL_HOURS (default 24). Complements mandatory pre-deploy snapshots
 * (which run in migrate.js BEFORE any destructive migration). Scheduler does NOT
 * replace pre-deploy safety.
 *
 * Behavior:
 * - No-op unless Appwrite env is configured (logs once + health warning).
 * - Failed run logs high-severity and retries next tick — never crashes API.
 * - First run delayed 30s after boot so migrations/health checks settle.
 * - Records success/failure to changeJournal and exposes metrics via monitoring/metrics.
 * - Retention configurable via BACKUP_RETENTION_COUNT (default 90) and
 *   BACKUP_RETENTION_PRE_DEPLOY (default 30).
 */

const backupService = require('../services/backupService');

const DEFAULT_INTERVAL_HOURS = 24;
const FIRST_RUN_DELAY_MS = 30 * 1000;

let timer = null;
let lastSuccess = null;
let lastFailure = null;
let consecutiveFailures = 0;

function intervalHours() {
  const n = parseInt(process.env.BACKUP_INTERVAL_HOURS, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL_HOURS;
}

function isConfigured() {
  return Boolean(
    process.env.APPWRITE_ENDPOINT &&
      process.env.APPWRITE_PROJECT_ID &&
      process.env.APPWRITE_API_KEY
  );
}

async function runOnce() {
  try {
    const result = await backupService.runBackup(null, { snapshotType: 'scheduled', verify: true });
    const keep = parseInt(process.env.BACKUP_RETENTION_COUNT, 10) || backupService.RETENTION_DEFAULT;
    const keepPre = parseInt(process.env.BACKUP_RETENTION_PRE_DEPLOY, 10) || backupService.RETENTION_PRE_DEPLOY_KEEP;
    const prune = await backupService.pruneBackups(keep, { keepPreDeploy: keepPre });
    lastSuccess = { at: new Date().toISOString(), fileId: result.fileId, bytes: result.bytes, rowCounts: result.rowCounts, checksum: result.checksum };
    lastFailure = null;
    consecutiveFailures = 0;
    console.log(
      `[backup] scheduled snapshot uploaded (${result.bytes} bytes, ` +
        `${Object.values(result.rowCounts).reduce((a, b) => a + b, 0)} rows, verified:${result.verified}); ` +
        `pruned ${prune.deleted}, kept ${prune.kept}`
    );
    try {
      const changeJournal = require('./changeJournal');
      changeJournal.record({
        operation: 'BACKUP_SCHEDULED_SUCCESS',
        source: 'system',
        actorType: 'SYSTEM',
        entity: 'db_backup',
        entityId: result.fileId,
        metadata: { bytes: result.bytes, rowCounts: result.rowCounts, checksum: result.checksum },
        success: true,
      });
    } catch {}
    return { success: true, result, prune };
  } catch (err) {
    consecutiveFailures++;
    lastFailure = { at: new Date().toISOString(), error: err.message, consecutiveFailures };
    console.error(`[backup] scheduled snapshot failed (${consecutiveFailures} consecutive): ${err.message}`);
    if (consecutiveFailures >= 3) {
      console.error('[backup] HIGH SEVERITY: 3+ consecutive scheduled backup failures — off-host durability degraded');
    }
    try {
      const changeJournal = require('./changeJournal');
      changeJournal.record({
        operation: 'BACKUP_SCHEDULED_FAILURE',
        source: 'system',
        actorType: 'SYSTEM',
        entity: 'db_backup',
        metadata: { error: err.message, consecutiveFailures },
        success: false,
      });
    } catch {}
    return { success: false, error: err.message };
  }
}

function getStatus() {
  return {
    configured: isConfigured(),
    intervalHours: intervalHours(),
    lastSuccess,
    lastFailure,
    consecutiveFailures,
    retention: {
      regular: parseInt(process.env.BACKUP_RETENTION_COUNT, 10) || backupService.RETENTION_DEFAULT,
      preDeploy: parseInt(process.env.BACKUP_RETENTION_PRE_DEPLOY, 10) || backupService.RETENTION_PRE_DEPLOY_KEEP,
    },
    journal: { retention: 'permanent (full term)' },
  };
}

function start() {
  if (timer) return;
  if (!isConfigured()) {
    console.warn('[backup] Appwrite env not configured — scheduled backups disabled (pre-deploy gate will ALSO block destructive migrations — fail closed)');
    return;
  }
  const hours = intervalHours();
  console.log(`[backup] scheduled every ${hours}h (first run in ${FIRST_RUN_DELAY_MS / 1000}s) — retention regular=${getStatus().retention.regular}, preDeploy=${getStatus().retention.preDeploy}, journal=permanent`);
  setTimeout(() => {
    runOnce();
    timer = setInterval(runOnce, hours * 60 * 60 * 1000);
    timer.unref?.();
  }, FIRST_RUN_DELAY_MS).unref?.();
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop, runOnce, getStatus };
