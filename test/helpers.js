/**
 * Test client helper for VoteWeb API integration tests.
 * Manages cookies (session + CSRF) and session binding token.
 */

const { randomBytes } = require('node:crypto');

class TestClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
    this.bindingToken = null;
  }

  _parseCookies(setCookieHeaders = []) {
    for (const header of setCookieHeaders) {
      const parts = header.split(';')[0];
      const eq = parts.indexOf('=');
      if (eq === -1) continue;
      const name = parts.slice(0, eq);
      const value = parts.slice(eq + 1);
      if (value === '') {
        this.cookies.delete(name); // expiry
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  _cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  get csrfCookie() {
    return this.cookies.get('cv_csrf') || null;
  }

  /**
   * Perform a request. State-changing methods require CSRF header
   * (double-submit) and, after login, the session binding token.
   */
  async request(method, path, { body, csrf = true, binding = true, headers = {} } = {}) {
    // Always fetch a fresh CSRF token when one is missing so state-changing calls work
    if (csrf && !this.csrfCookie) {
      await this.request('GET', '/api/v1/auth/csrf', { csrf: false });
    }

    const h = { ...headers };
    const cookie = this._cookieHeader();
    if (cookie) h.Cookie = cookie;

    if (csrf && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      h['X-CSRF-Token'] = this.csrfCookie;
    }

    if (binding && this.bindingToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !h['X-Session-Binding']) {
      h['X-Session-Binding'] = this.bindingToken;
    }

    let payload;
    if (body !== undefined) {
      h['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: h,
      body: payload,
      redirect: 'manual',
    });

    this._parseCookies(res.headers.getSetCookie ? res.headers.getSetCookie() : []);

    let json = null;
    const text = await res.text();
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    return { status: res.status, json, headers: res.headers };
  }

  async login(identifier, password) {
    const res = await this.request('POST', '/api/v1/auth/login', {
      body: { userIdentifier: identifier, password },
    });
    if (res.json?.data?.bindingToken) {
      this.bindingToken = res.json.data.bindingToken;
    }
    return res;
  }

  async logout() {
    const res = await this.request('POST', '/api/v1/auth/logout');
    this.bindingToken = null;
    return res;
  }
}

function randomId(prefix) {
  return `${prefix}${randomBytes(6).toString('hex')}`;
}

module.exports = { TestClient, randomId };