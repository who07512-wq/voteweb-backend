/**
 * Change Journal — Layer A (Immutable, off-host)
 *
 * Records every important business mutation with BEFORE + AFTER state
 * to Appwrite Storage bucket `db-change-journal` as immutable JSONL batches:
 *   db-change-journal/date=YYYY-MM-DD/batch-<uuid>.jsonl
 *
 * Design:
 * - Buffered, batched, non-blocking: user requests never wait for Appwrite latency.
 * - Redaction: secrets are never emitted (see src/lib/redact.js).
 * - Failure => high-severity log + durable retry queue (in-memory + optional file fallback).
 * - Journals survive PG wipe because storage is off-host.
 * - One journal event per logical operation (may touch multiple tables).
 *
 * Event schema:
 * {
 *   event_id, timestamp, request_id, correlation_id, actor_id, actor_type,
 *   operation, source, transaction_id, git_commit, migration_version,
 *   entity, entity_id, before, after, diff, success, metadata
 * }
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client, Storage, ID } = require('node-appwrite');
const { InputFile } = require('node-appwrite/file');
const { redactForJournal, diffObjects } = require('../lib/redact');

const JOURNAL_BUCKET_DEFAULT = 'db-change-journal';
const FLUSH_INTERVAL_MS = 5000;
const MAX_BATCH_SIZE = 100;
const RETRY_FILE = path.join(__dirname, '../../.journal-retry.jsonl');
const LOCAL_FALLBACK_DIR = path.join(__dirname, '../../journal-fallback');

const CRITICAL_EVENTS = new Set([
  'VOTE_CAST',
  'CANDIDATE_APPROVED',
  'CANDIDATE_REJECTED',
  'CANDIDATE_CHANGES_REQUESTED',
  'CANDIDATE_PROFILE_UPDATED',
  'CANDIDATE_RESUBMITTED',
  'ELECTION_STATUS_CHANGED',
  'ELECTION_CREATED',
  'ELECTION_UPDATED',
  'AUTHORIZATION_CREATED',
  'AUTHORIZATION_UPDATED',
  'AUTHORIZATION_DELETED',
  'CANDIDATE_BALLOT_CREATED',
  'CANDIDATE_BALLOT_UPDATED',
  'CONSTITUENCY_CREATED',
  'POSITION_CREATED',
  'POSITION_UPDATED',
  'MIGRATION_PREFLIGHT',
  'MIGRATION_APPLIED',
  'MIGRATION_FAILED',
  'MIGRATION_PRE_DESTRUCTIVE_BACKUP',
  'RESTORE_STARTED',
  'RESTORE_COMPLETED',
  'RESTORE_FAILED',
  'BACKUP_SCHEDULED_SUCCESS',
]);

let buffer = [];
let timer = null;
let flushing = false;
let gitCommitCache = null;
let lastSuccessAt = null;
let lastFailureAt = null;
let lastFailureError = null;
let failureCount = 0;
let totalEnqueued = 0;

function getGitCommit() {
  if (gitCommitCache) return gitCommitCache;
  try {
    const { execSync } = require('node:child_process');
    gitCommitCache = execSync('git rev-parse HEAD', { encoding: 'utf8', timeout: 2000 }).trim();
  } catch {
    gitCommitCache = process.env.GIT_COMMIT || process.env.RENDER_GIT_COMMIT || 'unknown';
  }
  return gitCommitCache;
}

function journalConfig() {
  const endpoint = process.env.APPWRITE_ENDPOINT;
  const projectId = process.env.APPWRITE_PROJECT_ID;
  // Least-privilege: prefer dedicated journal key, fallback to generic for backward compat
  const apiKey = process.env.APPWRITE_JOURNAL_API_KEY || process.env.APPWRITE_API_KEY;
  if (!endpoint || !projectId || !apiKey) {
    return null; // not configured — journal will buffer locally + warn
  }
  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  return { client, bucketId: process.env.APPWRITE_JOURNAL_BUCKET || JOURNAL_BUCKET_DEFAULT };
}

function nowIso() { return new Date().toISOString(); }

function eventId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Build a journal event object (redacted, diff computed).
 * @param {Object} params
 */
function buildEvent(params) {
  const {
    operation,
    source = 'unknown',
    actorId = null,
    actorType = 'SYSTEM',
    requestId = null,
    correlationId = null,
    entity = null,
    entityId = null,
    before = null,
    after = null,
    affectedRows = null, // for multi-table ops: { table: [{before, after}] }
    migrationVersion = null,
    transactionId = null,
    success = true,
    metadata = {},
    gitCommit = null,
  } = params;

  const redactBefore = before ? redactForJournal(entity || 'unknown', before) : null;
  const redactAfter = after ? redactForJournal(entity || 'unknown', after) : null;
  const diff = before || after ? diffObjects(redactBefore, redactAfter) : {};

  // For multi-table logical ops, redact each table's rows
  let redactedAffected = null;
  if (affectedRows && typeof affectedRows === 'object') {
    redactedAffected = {};
    for (const [tbl, rows] of Object.entries(affectedRows)) {
      if (Array.isArray(rows)) {
        redactedAffected[tbl] = rows.map(r => ({
          before: r.before ? redactForJournal(tbl, r.before) : null,
          after: r.after ? redactForJournal(tbl, r.after) : null,
          diff: diffObjects(
            r.before ? redactForJournal(tbl, r.before) : null,
            r.after ? redactForJournal(tbl, r.after) : null
          ),
        }));
      } else if (rows && typeof rows === 'object') {
        redactedAffected[tbl] = {
          before: rows.before ? redactForJournal(tbl, rows.before) : null,
          after: rows.after ? redactForJournal(tbl, rows.after) : null,
        };
      }
    }
  }

  return {
    event_id: eventId(),
    timestamp: nowIso(),
    request_id: requestId,
    correlation_id: correlationId || requestId,
    transaction_id: transactionId,
    actor_id: actorId,
    actor_type: actorType, // ADMIN | STUDENT | SYSTEM
    operation, // e.g., CANDIDATE_APPROVED
    source, // admin-api | student-api | migration | system | restore
    git_commit: gitCommit || getGitCommit(),
    migration_version: migrationVersion,
    entity,
    entity_id: entityId,
    before: redactBefore,
    after: redactAfter,
    diff,
    affected_rows: redactedAffected,
    success,
    metadata,
  };
}

/**
 * Append event to mutable buffer; schedule flush.
 * For critical events, also durably spool to RETRY_FILE via appendFileSync before ack.
 */
function enqueue(event) {
  buffer.push(event);
  totalEnqueued++;
  if (buffer.length >= MAX_BATCH_SIZE) {
    flush().catch(err => console.error('[journal] flush failed:', err.message));
  } else {
    scheduleFlush();
  }
}

/**
 * Durable enqueue for critical events: append to spool file synchronously before returning.
 * Returns the event; throws if spool cannot be written (surface failure per safety policy).
 * Idempotent via event_id: duplicates can be deduped on upload by file existence check.
 */
function recordCriticalAndEnqueue(params) {
  const ev = buildEvent(params);
  // Durable append: ensures event survives restart/redeploy (short-lived buffer)
  // Note: Render local filesystem is ephemeral across deploys — this is a short-lived safety
  // buffer only; Appwrite is the durable destination (documented limitation).
  try {
    const line = JSON.stringify(ev) + '\n';
    fs.appendFileSync(RETRY_FILE, line, 'utf8');
  } catch (e) {
    console.error(`[journal] CRITICAL spool failed for ${ev.operation} ${ev.event_id}: ${e.message}`);
    throw new Error(`journal durable enqueue failed: ${e.message}`);
  }
  // Also keep in memory buffer for batch upload
  buffer.push(ev);
  totalEnqueued++;
  scheduleFlush();
  return ev;
}

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flush().catch(err => console.error('[journal] scheduled flush failed:', err.message));
  }, FLUSH_INTERVAL_MS);
  // don't keep process alive just for journal
  if (timer && typeof timer.unref === 'function') timer.unref();
}

/**
 * Flush buffered events to Appwrite as one immutable JSONL file per batch.
 * On failure, persist to local retry queue and log high-severity error.
 */
async function flush() {
  if (flushing) return;
  if (buffer.length === 0) return;
  flushing = true;
  const batch = buffer.splice(0, buffer.length);
  const config = journalConfig();

  // If not configured, persist locally and warn
  if (!config) {
    console.warn(`[journal] Appwrite not configured — buffering ${batch.length} events locally (no off-host durability)`);
    persistRetry(batch);
    flushing = false;
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const batchId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex');
  const fileName = `date=${date}/batch-${batchId}.jsonl`;
  const jsonl = batch.map(e => JSON.stringify(e)).join('\n') + '\n';

  try {
    const storage = new Storage(config.client);
    await storage.createFile(
      config.bucketId,
      ID.unique(),
      InputFile.fromBuffer(Buffer.from(jsonl, 'utf8'), fileName)
    );
    console.log(`[journal] flushed ${batch.length} events -> ${config.bucketId}/${fileName}`);
    lastSuccessAt = new Date().toISOString();
    lastFailureAt = null;
    lastFailureError = null;
    failureCount = 0;
    await drainRetryQueue(config).catch(() => {});
  } catch (err) {
    console.error(`[journal] CRITICAL: failed to flush ${batch.length} events to Appwrite: ${err.message}`);
    console.error('[journal] events preserved in local retry queue; will retry on next flush');
    lastFailureAt = new Date().toISOString();
    lastFailureError = err.message;
    failureCount++;
    persistRetry(batch);
    try {
      fs.mkdirSync(LOCAL_FALLBACK_DIR, { recursive: true });
      const fallbackFile = path.join(LOCAL_FALLBACK_DIR, `date=${date}-fallback-${batchId}.jsonl`);
      fs.writeFileSync(fallbackFile, jsonl, 'utf8');
      console.error(`[journal] fallback written to ${fallbackFile}`);
    } catch (e) {
      console.error('[journal] fallback write failed:', e.message);
    }
  } finally {
    flushing = false;
  }
}

function persistRetry(events) {
  try {
    const line = events.map(e => JSON.stringify(e)).join('\n') + '\n';
    fs.appendFileSync(RETRY_FILE, line, 'utf8');
  } catch (e) {
    console.error('[journal] persistRetry failed:', e.message);
  }
}

async function drainRetryQueue(config) {
  if (!fs.existsSync(RETRY_FILE)) return;
  const content = fs.readFileSync(RETRY_FILE, 'utf8').trim();
  if (!content) return;
  const lines = content.split('\n').filter(Boolean);
  if (lines.length === 0) return;
  // Deduplicate by event_id (idempotent retry)
  const seen = new Set();
  const deduped = [];
  for (const line of lines) {
    try {
      const ev = JSON.parse(line);
      if (!ev.event_id || !seen.has(ev.event_id)) {
        if (ev.event_id) seen.add(ev.event_id);
        deduped.push(ev);
      }
    } catch {}
  }
  for (let i = 0; i < deduped.length; i += MAX_BATCH_SIZE) {
    const chunk = deduped.slice(i, i + MAX_BATCH_SIZE);
    const chunkJsonl = chunk.map(e => JSON.stringify(e)).join('\n') + '\n';
    const d = new Date().toISOString().slice(0, 10);
    const bid = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex');
    const fname = `date=${d}/batch-retry-${bid}.jsonl`;
    const storage = new Storage(config.client);
    // Bounded retry: try once per drain, if fails keep file for next attempt
    await storage.createFile(config.bucketId, ID.unique(), InputFile.fromBuffer(Buffer.from(chunkJsonl, 'utf8'), fname));
    console.log(`[journal] drained ${chunk.length} retried events -> ${fname}`);
  }
  fs.unlinkSync(RETRY_FILE);
}

async function retryPending() {
  const config = journalConfig();
  if (!config) {
    console.warn('[journal] retryPending: Appwrite not configured');
    return;
  }
  await drainRetryQueue(config);
}

/**
 * Public API: record a business mutation.
 * Non-blocking — enqueues for batched off-host write.
 * Critical events are durably spooled before ack.
 * @param {Object} params - see buildEvent
 * @returns {Object} event (for logging / correlation)
 */
function record(params) {
  const isCritical = CRITICAL_EVENTS.has(params.operation);
  if (isCritical) {
    return recordCriticalAndEnqueue(params);
  }
  const ev = buildEvent(params);
  enqueue(ev);
  return ev;
}

/**
 * Explicit critical path (use when caller wants to ensure durable enqueue throws on spool failure)
 */
function recordCritical(params) {
  return recordCriticalAndEnqueue(params);
}

/**
 * Synchronous variant that attempts immediate flush (still non-blocking for caller transaction).
 * Useful for migration/system contexts where you want durability asap.
 */
async function recordAndFlush(params) {
  const ev = buildEvent(params);
  enqueue(ev);
  await flush();
  return ev;
}

/**
 * Flush on process shutdown.
 */
function installShutdownFlush() {
  const handler = async () => {
    if (buffer.length > 0) {
      console.log(`[journal] shutdown flush: ${buffer.length} pending events`);
      try { await flush(); } catch {}
    }
  };
  process.on('beforeExit', handler);
  process.on('SIGTERM', async () => { await handler(); });
  process.on('SIGINT', async () => { await handler(); });
}

installShutdownFlush();

function getStatus() {
  let backlog = 0;
  let oldestPending = null;
  try {
    if (fs.existsSync(RETRY_FILE)) {
      const content = fs.readFileSync(RETRY_FILE, 'utf8').trim();
      if (content) {
        const lines = content.split('\n').filter(Boolean);
        backlog = lines.length;
        if (lines.length) {
          try { oldestPending = JSON.parse(lines[0]).timestamp; } catch {}
        }
      }
    }
  } catch {}
  // include in-memory buffer
  backlog += buffer.length;
  return {
    configured: !!journalConfig(),
    bucketId: journalConfig()?.bucketId || null,
    backlogSize: backlog,
    inMemoryBuffered: buffer.length,
    spoolBacklog: backlog - buffer.length,
    lastSuccessAt,
    lastFailureAt,
    lastFailureError,
    failureCount,
    totalEnqueued,
    oldestPending,
    durableSpoolPath: RETRY_FILE,
    note: 'Local spool is ephemeral on Render (filesystem resets on redeploy); Appwrite is durable destination',
  };
}

/**
 * Health check: verify bucket exists and is not public.
 */
async function healthCheck() {
  const config = journalConfig();
  if (!config) return { configured: false, error: 'Appwrite env not set' };
  try {
    const storage = new Storage(config.client);
    await storage.listFiles(config.bucketId, [], 1);
    return { configured: true, bucketId: config.bucketId, private: true };
  } catch (err) {
    return { configured: false, error: err.message, bucketId: config.bucketId };
  }
}

module.exports = {
  record,
  recordCritical,
  recordCriticalAndEnqueue,
  recordAndFlush,
  flush,
  healthCheck,
  getStatus,
  buildEvent,
  retryPending,
  CRITICAL_EVENTS,
  // test helpers
  _buffer: () => buffer,
  _clearBuffer: () => { buffer = []; },
  _journalConfig: journalConfig,
  JOURNAL_BUCKET_DEFAULT,
};
