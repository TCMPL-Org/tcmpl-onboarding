'use strict';
const { app } = require('@azure/functions');
const handlers = require('../lib/handlers');
const { guard } = require('../lib/access');

// Signed-in HR actions:
//   POST /api/wa/start  { offer + candidate details + facts }  -> register candidate, send opening template
//   POST /api/wa/send   { candidateId, text }                   -> manual reply from the inbox
//   POST /api/wa/push   { candidateId, touchpoint, items }      -> send a prepared journey touchpoint / offer letter
app.http('wa', {
  methods: ['POST'],
  authLevel: 'anonymous', // signed-in users on the app's user list only (lib/access.js)
  route: 'wa/{action}',
  handler: async (request) => {
    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: 'invalid_json' } }; }
    const g = await guard(request, body);
    if (g.response) return g.response;
    const user = g.user;
    if (request.params.action === 'start') return handlers.waStart({ body, user });
    if (request.params.action === 'send') return handlers.waSend({ body, user });
    if (request.params.action === 'push') return handlers.waPush({ body, user });
    return { status: 404, jsonBody: { error: 'unknown_action' } };
  }
});
