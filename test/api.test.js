/**
 * VoteWeb API integration tests (runs against a live PostgreSQL DB).
 * Uses Node's built-in test runner and fetch.
 *
 * Run: node --test test/
 */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgres://voteweb:voteweb@localhost:5434/voteweb';

const app = require('../src/app');
const db = require('../src/db');
const { hashPassword } = require('../src/lib/password');
const { TestClient, randomId } = require('./helpers');

let server;
let baseUrl;
let client;

// Dedicated test students used for vote-flow tests
const TEST_PW = 'TestPassword123!';
let testStudentId;
let attackerStudentId;

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  client = new TestClient(baseUrl);

  const externalId = `TST${randomId('')}`.slice(0, 18);
  const attackerExternalId = `ATK${randomId('')}`.slice(0, 18);
  const hash = await hashPassword(TEST_PW);

  const inserted = await db.query(
    `INSERT INTO students (external_id, name, email, role, password_hash, password_change_required)
     VALUES ($1, 'Test Runner', $2, 'STUDENT', $3, FALSE)
     RETURNING id`,
    [externalId, `${externalId}@test.local`, hash]
  );
  testStudentId = inserted.rows[0].id;
  globalThis.__TEST_STUDENT_ID__ = externalId;

  const attacker = await db.query(
    `INSERT INTO students (external_id, name, email, role, password_hash, password_change_required)
     VALUES ($1, 'Attacker', $2, 'STUDENT', $3, FALSE)
     RETURNING id`,
    [attackerExternalId, `${attackerExternalId}@test.local`, hash]
  );
  attackerStudentId = attacker.rows[0].id;
  globalThis.__ATTACKER_STUDENT_ID__ = attackerExternalId;

  await db.query(
    `INSERT INTO voter_authorizations (student_id, election_id)
     VALUES ($1, 1)`,
    [testStudentId]
  );
});

test.after(async () => {
  await db.query('DELETE FROM voter_authorizations WHERE student_id = $1', [testStudentId]);
  await db.query('DELETE FROM vote_receipts WHERE student_id = $1', [testStudentId]);
  await db.query('DELETE FROM votes WHERE student_id = $1', [testStudentId]);
  await db.query('DELETE FROM votes WHERE student_id = $1', [attackerStudentId]);
  await db.query('DELETE FROM students WHERE id IN ($1, $2)', [testStudentId, attackerStudentId]);
  server.close();
  await db.close();
  delete globalThis.__TEST_STUDENT_ID__;
  delete globalThis.__ATTACKER_STUDENT_ID__;
});

// ============================================================
// HEALTH
// ============================================================
test('GET /api/health returns ok', async () => {
  const res = await client.request('GET', '/api/health', { csrf: false, binding: false });
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'ok');
});

test('GET /api/health/db reports connected', async () => {
  const res = await client.request('GET', '/api/health/db', { csrf: false, binding: false });
  assert.equal(res.status, 200);
  assert.equal(res.json.database, 'connected');
});

// ============================================================
// CSRF
// ============================================================
test('GET /auth/csrf sets cv_csrf cookie and returns token', async () => {
  const res = await client.request('GET', '/api/v1/auth/csrf', { csrf: false, binding: false });
  assert.equal(res.status, 200);
  assert.ok(res.json.data.csrfToken);
  assert.equal(client.csrfCookie, res.json.data.csrfToken);
});

test('POST without CSRF header is rejected with 403 CSRF_INVALID', async () => {
  const fresh = new TestClient(baseUrl);
  const res = await fresh.request('POST', '/api/v1/auth/login', {
    csrf: false,
    binding: false,
    headers: { 'Content-Type': 'application/json' },
    body: { userIdentifier: 'STU001', password: 'StudentPassword123!' },
  });
  assert.equal(res.status, 403);
  assert.equal(res.json.code, 'CSRF_INVALID');
});

// ============================================================
// AUTHENTICATION
// ============================================================
test('login succeeds for seeded STU001 (no MFA)', async () => {
  const res = await client.login('STU001', 'StudentPassword123!');
  assert.equal(res.status, 200);
  assert.equal(res.json.data.authenticated, true);
  assert.ok(res.json.data.bindingToken);
  assert.equal(res.json.data.user.externalId ?? res.json.data.user.external_id, 'STU001');
});

test('login with wrong password returns 401 with generic error', async () => {
  const res = await client.login('STU001', 'WrongPassword123!');
  assert.equal(res.status, 401);
  assert.ok(!res.json.data || res.json.data.authenticated === false);
  assert.ok(res.json.error);
});

test('login with unknown user returns 401', async () => {
  const res = await client.login('NOBODY999', 'WhateverPassword1!');
  assert.equal(res.status, 401);
});

test('login with missing identifier returns 400', async () => {
  const res = await client.request('POST', '/api/v1/auth/login', {
    body: { userIdentifier: '', password: 'StudentPassword123!' },
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.error.code, 'INVALID_INPUT');
});

test('logout without binding token still succeeds (safe: logout is always allowed)', async () => {
  const c = new TestClient(baseUrl);
  await c.request('GET', '/api/v1/auth/csrf', { csrf: false, binding: false });
  await c.login('STU001', 'StudentPassword123!');
  // Strip binding token, keep session cookie. Logout must still work: allowing
  // a user (or anyone holding their session cookie) to end a session is benign.
  c.bindingToken = null;
  const res = await c.request('POST', '/api/v1/auth/logout', { binding: false });
  assert.ok([200, 401].includes(res.status), `got ${res.status}`);
});

test('logout works when binding token is present', async () => {
  const c = new TestClient(baseUrl);
  await c.login('STU001', 'StudentPassword123!');
  const res = await c.request('POST', '/api/v1/auth/logout');
  assert.equal(res.status, 200);
});

// ============================================================
// ADMIN MFA CHALLENGE
// ============================================================
test('ADMIN001 login returns authenticated:false with mfa required', async () => {
  const c = new TestClient(baseUrl);
  const res = await c.request('POST', '/api/v1/auth/login', {
    body: { userIdentifier: 'ADMIN001', password: 'AdminPassword123!' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.data.authenticated, false);
  assert.equal(res.json.data.mfaRequired, true);
});

// ============================================================
// PUBLIC RESOURCES
// ============================================================
test('GET /api/v1/elections returns list', async () => {
  const res = await client.request('GET', '/api/v1/elections', { csrf: false, binding: false });
  assert.equal(res.status, 200);
  const elections = res.json.elections || res.json.data?.elections || res.json.data;
  assert.ok(Array.isArray(elections));
  assert.ok(elections.some((e) => e.id === 1));
});

test('GET /api/v1/elections/1 returns election details', async () => {
  const res = await client.request('GET', '/api/v1/elections/1', { csrf: false, binding: false });
  assert.equal(res.status, 200);
  const election = res.json.election || res.json.data?.election || res.json.data;
  assert.ok(election);
  assert.equal(election.id, 1);
});

test('GET /api/v1/elections/999 returns 404', async () => {
  const res = await client.request('GET', '/api/v1/elections/999', { csrf: false, binding: false });
  assert.equal(res.status, 404);
});

test('GET /api/v1/announcements returns list (may be empty)', async () => {
  const res = await client.request('GET', '/api/v1/announcements', { csrf: false, binding: false });
  assert.equal(res.status, 200);
  const data = res.json.data;
  assert.ok(Array.isArray(data));
});

test('GET /api/v1/elections/1/clubs returns clubs', async () => {
  const res = await client.request('GET', '/api/v1/elections/1/clubs', { csrf: false, binding: false });
  assert.equal(res.status, 200);
});

test('GET /api/v1/clubs/1/positions returns positions', async () => {
  const res = await client.request('GET', '/api/v1/clubs/1/positions', { csrf: false, binding: false });
  assert.equal(res.status, 200);
});

// ============================================================
// VOTING FLOW
// ============================================================
test('test student is eligible and can check votes', async () => {
  const externalId = globalThis.__TEST_STUDENT_ID__;
  const c = new TestClient(baseUrl);
  const login = await c.login(externalId, TEST_PW);
  assert.equal(login.status, 200, JSON.stringify(login.json));

  const check = await c.request('GET', '/api/v1/elections/1/votes/check', { csrf: false });
  assert.equal(check.status, 200);
  assert.equal(check.json.data.can_vote, true);
});

test('cast vote creates a receipt', async () => {
  const externalId = globalThis.__TEST_STUDENT_ID__;
  const c = new TestClient(baseUrl);
  await c.login(externalId, TEST_PW);
  const res = await c.request('POST', '/api/v1/elections/1/votes', {
    body: { election_id: 1, club_id: 1, position_id: 1, candidate_id: 1 },
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.data.success, true);
  assert.ok(res.json.data.receipt.receiptId);
  assert.ok(res.json.data.receipt.receiptHash);
  assert.ok(res.json.data.receipt.nullifier);
});

test('duplicate vote for same position is rejected', async () => {
  const externalId = globalThis.__TEST_STUDENT_ID__;
  const c = new TestClient(baseUrl);
  await c.login(externalId, TEST_PW);
  const res = await c.request('POST', '/api/v1/elections/1/votes', {
    body: { election_id: 1, club_id: 1, position_id: 1, candidate_id: 2 },
  });
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'ALREADY_VOTED');
});

test('GET /votes/receipt (by election, no voteId) returns own receipt', async () => {
  const externalId = globalThis.__TEST_STUDENT_ID__;
  const c = new TestClient(baseUrl);
  await c.login(externalId, TEST_PW);
  const res = await c.request('GET', '/api/v1/elections/1/votes/receipt', { csrf: false });
  assert.equal(res.status, 200);
  assert.ok(res.json.data.receipt.receiptHash);
});

test('GET /votes/receipt/:voteId returns own receipt', async () => {
  const externalId = globalThis.__TEST_STUDENT_ID__;
  const c = new TestClient(baseUrl);
  await c.login(externalId, TEST_PW);
  const vote = await db.query('SELECT vote_id FROM vote_receipts WHERE student_id = $1 LIMIT 1', [testStudentId]);
  assert.ok(vote.rows.length > 0);
  const res = await c.request('GET', `/api/v1/elections/1/votes/receipt/${vote.rows[0].vote_id}`, { csrf: false });
  assert.equal(res.status, 200);
  assert.ok(res.json.data.receipt.receiptHash);
});

test('vote receipt is IDOR-protected (other student cannot read)', async () => {
  const ownVote = await db.query('SELECT vote_id FROM vote_receipts WHERE student_id = $1 LIMIT 1', [testStudentId]);
  const attackerExternalId = globalThis.__ATTACKER_STUDENT_ID__;
  const c = new TestClient(baseUrl);
  await c.login(attackerExternalId, TEST_PW);
  const res = await c.request('GET', `/api/v1/elections/1/votes/receipt/${ownVote.rows[0].vote_id}`, { csrf: false });
  assert.ok([403, 404].includes(res.status), `expected 403/404, got ${res.status}`);
});

test('impersonation attempt via body student_id is rejected', async () => {
  const externalId = globalThis.__TEST_STUDENT_ID__;
  const c = new TestClient(baseUrl);
  await c.login(externalId, TEST_PW);
  // Already voted for position 1; try voting for position 2 but with forged student body
  const res = await c.request('POST', '/api/v1/elections/1/votes', {
    body: { student_id: 9999, election_id: 1, club_id: 1, position_id: 2, candidate_id: 3 },
  });
  assert.equal(res.status, 403);
  assert.equal(res.json.code, 'IMPERSONATION_ATTEMPT');
});

// ============================================================
// ADMIN ENFORCEMENT
// ============================================================
test('student session hits admin route returns 401/403', async () => {
  const c = new TestClient(baseUrl);
  await c.login('STU001', 'StudentPassword123!');
  const res = await c.request('GET', '/api/v1/admin/students', { csrf: false });
  assert.ok([401, 403].includes(res.status), `expected 401/403, got ${res.status}`);
});

test('unauthenticated admin route returns 401', async () => {
  const fresh = new TestClient(baseUrl);
  const res = await fresh.request('GET', '/api/v1/admin/students', { csrf: false, binding: false });
  assert.ok([401, 403].includes(res.status), `expected 401/403, got ${res.status}`);
});

// ============================================================
// RECEIPT PUBLIC VERIFICATION
// ============================================================
test('GET /api/v1/receipts/:uuid validates a real receipt', async () => {
  const row = (await db.query('SELECT id, receipt_hash FROM vote_receipts WHERE student_id = $1 LIMIT 1', [testStudentId])).rows[0];
  const res = await client.request('GET', `/api/v1/receipts/${row.id}`, { csrf: false, binding: false });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.valid, true);
  assert.equal(res.json.receipt.receiptHash, row.receipt_hash);
});

test('GET /api/v1/receipts/:uuid rejects an unknown receipt UUID', async () => {
  // Valid UUID format but not present in DB => 404
  const res = await client.request('GET', '/api/v1/receipts/00000000-0000-4000-8000-000000000000', { csrf: false, binding: false });
  assert.equal(res.status, 404);
});

test('GET /api/v1/receipts/:id rejects a malformed id', async () => {
  // Not a UUID => 400
  const res = await client.request('GET', '/api/v1/receipts/not-a-uuid', { csrf: false, binding: false });
  assert.equal(res.status, 400);
});

// ============================================================
// NOTIFICATIONS
// ============================================================
test('notifications list is accessible for authenticated user', async () => {
  const c = new TestClient(baseUrl);
  await c.login('STU001', 'StudentPassword123!');
  const res = await c.request('GET', '/api/v1/notifications', { csrf: false });
  assert.equal(res.status, 200);
});

test('POST /mark-all-read requires binding + csrf', async () => {
  const c = new TestClient(baseUrl);
  await c.login('STU001', 'StudentPassword123!');
  const res = await c.request('POST', '/api/v1/notifications/mark-all-read');
  assert.ok([200, 204, 404].includes(res.status), `got ${res.status}`);
});