'use strict';
// Reads the signed-in user that Azure Static Web Apps passes to the API.
// SWA only forwards requests from signed-in users (see staticwebapp.config.json),
// and sets the x-ms-client-principal header itself; browsers cannot forge it.

function getUser(headers) {
  const raw = headers && (typeof headers.get === 'function' ? headers.get('x-ms-client-principal') : headers['x-ms-client-principal']);
  if (!raw) return null;
  try {
    const p = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    if (!p || !p.userId) return null;
    return {
      id: p.userId,
      name: p.userDetails || p.userId,
      provider: p.identityProvider || '',
      roles: Array.isArray(p.userRoles) ? p.userRoles : []
    };
  } catch {
    return null;
  }
}

module.exports = { getUser };
