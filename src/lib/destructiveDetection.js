/**
 * Destructive Migration Detection
 * Robust heuristic — no fragile single regex — classifies SQL files as
 * destructive or safe. Ambiguous => destructive (fail closed).
 *
 * Detects:
 *  - DELETE (except where narrowly scoped with WHERE on id/email etc? But spec says broad UPDATE/DELETE without safe scoping is destructive — we treat any DELETE/TRUNCATE as destructive unless explicitly allowlisted)
 *  - TRUNCATE
 *  - DROP TABLE / DROP SCHEMA / DROP DATABASE / DROP INDEX (schema destructive)
 *  - ALTER TABLE ... DROP
 *  - PL/pgSQL DO $$ blocks executing dynamic DELETE/TRUNCATE/DROP
 *  - CASCADE combined with destructive DDL/DML
 *  - Broad UPDATE/DELETE without WHERE
 *  - reset/rebuild operations (TRUNCATE + RESTART IDENTITY, DO $$ loop dropping tables)
 */

function isDestructiveSql(sql, fileName = '') {
  if (!sql || typeof sql !== 'string') return false;
  const raw = sql;
  const lower = sql.toLowerCase();
  const reasons = [];

  // Normalize comments removal for detection but keep original for context
  const stripped = lower
    .replace(/--[^\n]*\n/g, '\n') // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ' '); // block comments

  // 1. File name heuristic: test/cleanup/remove/cleanup/test_simulation/ etc => destructive
  if (/test|simulation|delete_me|cleanup|remove_all|recreate|reset|wipe/i.test(fileName)) {
    // But not all of those are necessarily destructive (recreate could be INSERT). Still flag for review
    // We don't auto-flag filename alone — we combine with content, but we add signal
    if (/(cleanup|remove_all|recreate|reset|delete_me)/i.test(fileName)) {
      reasons.push(`suspicious filename pattern: ${fileName}`);
    }
  }

  // 2. Direct destructive keywords
  const patterns = [
    { re: /\bdelete\s+from\b/i, msg: 'DELETE FROM' },
    { re: /\btruncate\b/i, msg: 'TRUNCATE' },
    { re: /\bdrop\s+table\b/i, msg: 'DROP TABLE' },
    { re: /\bdrop\s+schema\b/i, msg: 'DROP SCHEMA' },
    { re: /\bdrop\s+database\b/i, msg: 'DROP DATABASE' },
    { re: /\balter\s+table\b[^;]*\bdrop\b/i, msg: 'ALTER TABLE ... DROP' },
    { re: /\bdo\s*\$\$/i, msg: 'PL/pgSQL DO $$ block' },
    { re: /\bexecute\s+format\s*\(/i, msg: 'EXECUTE dynamic SQL' },
    { re: /\bcascade\b/i, msg: 'CASCADE' },
  ];

  for (const { re, msg } of patterns) {
    if (re.test(raw)) {
      // For DELETE FROM, ensure it's not just a comment? We already stripped but raw also matches
      // We consider any DELETE FROM destructive in migration context (even scoped) — spec says be strict
      // Exception: DELETE with very narrow WHERE on migrations table? That's bookkeeping, not destructive. Ignore.
      if (msg === 'DELETE FROM' && /\bdelete\s+from\s+migrations\b/i.test(raw) && !/\bdelete\s+from\s+(?!migrations)\w+/i.test(raw.replace(/\bdelete\s+from\s+migrations\b/gi, ''))) {
        continue; // only deleting from migrations tracking table is not destructive
      }
      reasons.push(msg);
    }
  }

  // 3. Broad UPDATE/DELETE without WHERE — check per statement
  // Split by semicolon naively, but good enough for heuristic
  const statements = stripped.split(';');
  for (const stmt of statements) {
    const s = stmt.trim();
    if (!s) continue;
    if (/\bdelete\s+from\s+\w+/.test(s) && !/\bwhere\b/.test(s)) {
      reasons.push('DELETE without WHERE (broad)');
    }
    if (/\bupdate\s+\w+\s+set\b/.test(s) && !/\bwhere\b/.test(s)) {
      // Broad UPDATE: flag unless it's migrations table
      if (!/update\s+migrations/.test(s)) {
        reasons.push('broad UPDATE without WHERE');
      }
    }
    if (/\btruncate\s+/i.test(s)) {
      reasons.push('TRUNCATE statement');
    }
  }

  // 4. Dynamic EXECUTE inside DO $$ that contains destructive keywords
  if (/\bdo\s*\$\$/i.test(raw) && /execute\s+/i.test(raw)) {
    if (/(delete|truncate|drop|update)/i.test(raw)) {
      reasons.push('DO $$ with dynamic destructive EXECUTE');
    }
  }

  // 5. Reset/rebuild operation: DROP + CREATE or TRUNCATE RESTART IDENTITY
  if (/restart\s+identity/i.test(lower) || /drop\s+table.*cascade/i.test(lower)) {
    reasons.push('reset/rebuild operation');
  }

  // 6. Special: migrations/056_remove_all_elections.sql pattern — DELETE from many tables in DO loop
  if (/foreach.*in\s+array/i.test(lower) && /delete\s+from/.test(lower)) {
    reasons.push('loop DELETE over multiple tables');
  }

  const isDestructive = reasons.length > 0;
  return { isDestructive, reasons: [...new Set(reasons)] };
}

function classifyFile(fileName, sql) {
  const result = isDestructiveSql(sql, fileName);
  return {
    file: fileName,
    ...result,
    requiresBackup: result.isDestructive,
    // For production gate: destructive => blocked unless verified backup + ALLOW_DESTRUCTIVE_MIGRATIONS=true
  };
}

function filterDestructive(filesWithSql) {
  // filesWithSql: [{ file, sql }]
  const results = filesWithSql.map(({ file, sql }) => classifyFile(file, sql));
  const destructive = results.filter(r => r.isDestructive);
  const safe = results.filter(r => !r.isDestructive);
  return { destructive, safe, all: results };
}

module.exports = { isDestructiveSql, classifyFile, filterDestructive };
