'use strict';
// OAuth token manager. Zoho access tokens live ~1 hour; we refresh proactively
// at 50 minutes. Single-flight: concurrent callers share one refresh promise
// (Zoho rate-limits token refreshes — never refresh per-request).

const { env } = require('./config');

const REFRESH_AT_MS = 50 * 60 * 1000;

let _token = null;        // { accessToken, fetchedAt }
let _inflight = null;     // Promise while a refresh is running

async function _refresh() {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: env.clientId,
    client_secret: env.clientSecret,
    refresh_token: env.refreshToken,
  });

  const res = await fetch(`${env.accountsUrl}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    // Common causes: wrong data centre (accounts.zoho.com vs .in),
    // revoked refresh token, wrong client credentials.
    const detail = json.error || `HTTP ${res.status}`;
    throw new Error(`[zoho/auth] token refresh failed: ${detail}`);
  }

  _token = { accessToken: json.access_token, fetchedAt: Date.now() };
  console.log('[zoho/auth] access token refreshed');
  return _token.accessToken;
}

async function getAccessToken({ force = false } = {}) {
  const fresh = _token && Date.now() - _token.fetchedAt < REFRESH_AT_MS;
  if (fresh && !force) return _token.accessToken;

  if (!_inflight) {
    _inflight = _refresh().finally(() => { _inflight = null; });
  }
  return _inflight;
}

// For /api/zoho/health
function tokenStatus() {
  return {
    hasToken: Boolean(_token),
    ageMs: _token ? Date.now() - _token.fetchedAt : null,
  };
}

module.exports = { getAccessToken, tokenStatus };
