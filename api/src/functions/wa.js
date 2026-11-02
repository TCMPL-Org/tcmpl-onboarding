'use strict';
const { app } = require('@azure/functions');
const handlers = require('../lib/handlers');
const { getUser } = require('../lib/auth');

// Signed-in HR actions:
//   POST /api/wa/start  { offer + candidate details + facts }  -> register candidate, send opening template
//   POST /api/wa/send   { candidateId, text }                   -> manual reply from the inbox
app.http('wa', {
  methods: ['POST'],
  authLevel: 'anonymous', // access is enforced by Static Web Apps sign-in + getUser()
  route: 'wa/{action}',
  handler: async (request) => {
    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: 'invalid_json' } }; }
    const user = getUser(request.headers);
    if (request.params.action === 'start') return handlers.waStart({ body, user });
    if (request.params.action === 'send') return handlers.waSend({ body, user });
    return { status: 404, jsonBody: { error: 'unknown_action' } };
  }
});
