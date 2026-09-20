/**
 * Redaction + allow-list helpers for the change journal.
 * Never emit secrets off-host.
 */

/** Fields that must never be serialized to the journal. */
const DENY_FIELDS = new Set([
  'password_hash',
  'password',
  'mfa_secret_encrypted',
  'mfa_secret',
  'totp_secret',
  'totp_secret_encrypted',
  'totp_key',
  'session_hash',
  'binding_hash',
  'binding_token_hash',
  'otp_hash',
  'otp',
  'otp_code',
  'challenge_hash',
  'mfa_challenge',
  'otp_challenge',
  'aadhar_number',
  'aadhar',
  'national_id',
  'ssn',
  'session_hash',
  'challenge_hash',
  'api_key',
  'apiKey',
  'appwrite_api_key',
  'backup_api_key',
  'journal_api_key',
  'secret',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'cookie',
  'cookies',
  'authorization',
  'encryption_key',
  'totp_encryption_key',
  'otp_secret',
  'session_secret',
  'clerk_secret_key',
  'brevo_api_key',
]);

const REDACTED_MARKER = '[REDACTED]';

/**
 * Whether a key should be redacted (case-insensitive substring match).
 */
function isDeniedKey(key) {
  if (!key) return false;
  const k = String(key).toLowerCase();
  for (const d of DENY_FIELDS) {
    if (k === d || k.includes(d)) return true;
  }
  // Heuristic: any *_hash that is auth-related
  if (k.endsWith('_hash') && (k.includes('session') || k.includes('otp') || k.includes('mfa') || k.includes('token'))) return true;
  // aadhar variants
  if (k.includes('aadhar') || k.includes('adhar')) return true;
  return false;
}

/**
 * Deep redaction: returns a new object with denied fields replaced.
 * If an object is null/primitive returns as-is.
 */
function redactObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(redactObject);
  if (typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isDeniedKey(k)) {
      out[k] = REDACTED_MARKER;
    } else if (v !== null && typeof v === 'object') {
      out[k] = redactObject(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Compute a shallow field-level diff between before and after (redacted).
 * @returns {Object} { added, removed, changed }
 */
function diffObjects(before, after) {
  const b = before || {};
  const a = after || {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const diff = {};
  for (const k of keys) {
    if (isDeniedKey(k)) continue;
    const bv = b[k];
    const av = a[k];
    const bvStr = bv === undefined ? undefined : JSON.stringify(bv);
    const avStr = av === undefined ? undefined : JSON.stringify(av);
    if (bvStr !== avStr) {
      diff[k] = { before: bv === undefined ? null : bv, after: av === undefined ? null : av };
    }
  }
  return diff;
}

/**
 * Allow-list projection for known entities - only emit fields that are safe and useful for recovery.
 * If no allow-list exists for an entity, fall back to redactObject (deny-based).
 */
const ALLOW_LISTS = {
  students: ['id', 'external_id', 'name', 'email', 'official_email', 'current_login_email', 'department', 'year_or_semester', 'section', 'role', 'is_active', 'voting_eligible', 'created_at', 'updated_at'],
  candidate_applications: ['id', 'student_id', 'full_name', 'enrollment_number', 'department', 'year', 'semester', 'section', 'position_id', 'contesting_position', 'email', 'phone', 'profile_photo_url', 'bio', 'manifesto', 'age', 'date_of_birth', 'gender', 'category', 'election_id', 'status', 'rejection_reason', 'changes_requested_reason', 'reviewed_by', 'reviewed_at', 'submitted_at', 'created_at', 'updated_at'],
  candidates: ['id', 'position_id', 'name', 'description', 'image_url', 'display_order', 'is_active', 'created_at'],
  elections: ['id', 'name', 'description', 'status', 'start_time', 'end_time', 'category', 'results_published_at', 'results_published_by', 'created_at', 'updated_at'],
  constituencies: ['id', 'election_id', 'department', 'year', 'section', 'name', 'is_active', 'created_at'],
  positions: ['id', 'constituency_id', 'name', 'description', 'display_order', 'max_selections', 'gender', 'is_active', 'created_at'],
  votes: ['id', 'student_id', 'election_id', 'constituency_id', 'position_id', 'candidate_id', 'voted_at'],
  vote_receipts: ['id', 'vote_id', 'election_id', 'student_id', 'receipt_hash', 'created_at'],
  voter_authorizations: ['id', 'student_id', 'election_id', 'is_authorized', 'authorized_at', 'expires_at'],
  announcements: ['id', 'title', 'content', 'is_published', 'created_at'],
  // audit_logs themselves are not journaled recursively to avoid loop
};

function projectAllowListed(entity, row) {
  if (!row || typeof row !== 'object') return redactObject(row);
  const allow = ALLOW_LISTS[entity];
  if (!allow) return redactObject(row);
  const out = {};
  for (const k of allow) {
    if (k in row) {
      const v = row[k];
      out[k] = isDeniedKey(k) ? REDACTED_MARKER : v;
    }
  }
  // Also include any non-allow fields that aren't denied? No - strict allow.
  return out;
}

function redactForJournal(entity, row) {
  if (!row) return null;
  // Prefer allow-list if defined
  if (ALLOW_LISTS[entity]) return projectAllowListed(entity, row);
  return redactObject(row);
}

module.exports = { redactObject, redactForJournal, diffObjects, isDeniedKey, REDACTED_MARKER, ALLOW_LISTS, DENY_FIELDS };
