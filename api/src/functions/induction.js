'use strict';
const { app } = require('@azure/functions');
const handlers = require('../lib/handlers');
const { guard } = require('../lib/access');

// Signed-in HR actions for induction:
//   POST /api/induction/send    { candidateId, itemId }             -> send one milestone now
//   POST /api/induction/upload  { client, filename, mime, data }    -> store a deck / policy PDF (base64)
//   GET  /api/induction/file?id=                                    -> open an uploaded file
app.http('induction', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous', // signed-in users on the app's user list only (lib/access.js)
  route: 'induction/{action}',
  handler: async (request) => {
    if (request.method === 'GET' && request.params.action === 'file') {
      const g = await guard(request, null);
      return g.response || handlers.contentFile({ id: request.query.get('id'), user: g.user });
    }
    if (request.method !== 'POST') return { status: 405, jsonBody: { error: 'method_not_allowed' } };
    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: 'invalid_json' } }; }
    const g = await guard(request, body);
    if (g.response) return g.response;
    return handlers.inductionAction({ action: request.params.action, body, user: g.user });
  }
});

// Scheduler: GitHub Actions calls this every 15 minutes with header x-cron-key: <CRON_SECRET>.
app.http('cronTick', {
  methods: ['POST'],
  authLevel: 'anonymous', // open route; protected by the CRON_SECRET header
  route: 'cron/tick',
  handler: async (request) => handlers.cronTick({ key: request.headers.get('x-cron-key') })
});
