'use strict';
const { app } = require('@azure/functions');
const handlers = require('../lib/handlers');
const { getUser } = require('../lib/auth');

// Signed-in HR actions for induction:
//   POST /api/induction/send    { candidateId, itemId }             -> send one milestone now
//   POST /api/induction/upload  { client, filename, mime, data }    -> store a deck / policy PDF (base64)
//   GET  /api/induction/file?id=                                    -> open an uploaded file
app.http('induction', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous', // access is enforced by Static Web Apps sign-in + getUser()
  route: 'induction/{action}',
  handler: async (request) => {
    const user = getUser(request.headers);
    if (request.method === 'GET' && request.params.action === 'file') return handlers.contentFile({ id: request.query.get('id'), user });
    if (request.method !== 'POST') return { status: 405, jsonBody: { error: 'method_not_allowed' } };
    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: 'invalid_json' } }; }
    return handlers.inductionAction({ action: request.params.action, body, user });
  }
});

// Scheduler: GitHub Actions calls this every 15 minutes with header x-cron-key: <CRON_SECRET>.
app.http('cronTick', {
  methods: ['POST'],
  authLevel: 'anonymous', // open route; protected by the CRON_SECRET header
  route: 'cron/tick',
  handler: async (request) => handlers.cronTick({ key: request.headers.get('x-cron-key') })
});
