/**
 * Request ID / Correlation middleware
 * Generates a unique request_id per HTTP request and makes it available via
 * req.requestId. Also sets X-Request-Id response header for tracing.
 * For background jobs/migrations a system correlation ID is generated similarly.
 */
const crypto = require('node:crypto');

function generateRequestId() {
  // UUID v4 - crypto.randomUUID is available in Node 19+, fallback otherwise
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

function requestIdMiddleware(req, _res, next) {
  const incoming = req.get('X-Request-Id') || req.get('X-Correlation-Id');
  const id = incoming && /^[a-zA-Z0-9-_]{8,128}$/.test(incoming) ? incoming : generateRequestId();
  req.requestId = id;
  req.correlationId = id;
  // expose via header for clients
  req._requestId = id;
  next();
}

function systemCorrelationId(context = 'system') {
  return `${context}-${generateRequestId()}`;
}

module.exports = { requestIdMiddleware, generateRequestId, systemCorrelationId };
