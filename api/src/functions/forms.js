'use strict';
const { app } = require('@azure/functions');
const handlers = require('../lib/handlers');
const { guard } = require('../lib/access');

// Signed-in HR actions for joining forms:
//   POST /api/forms/details  { candidateId }                         -> ask the form questions on WhatsApp
//   POST /api/forms/save     { candidateId, vals, states, approve? } -> save HR corrections / approval
//   POST /api/forms/send     { candidateId, files:[{filename, pdfBase64}] } -> send PDFs to confirm on WhatsApp
app.http('forms', {
  methods: ['POST'],
  authLevel: 'anonymous', // signed-in users on the app's user list only (lib/access.js)
  route: 'forms/{action}',
  handler: async (request) => {
    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: 'invalid_json' } }; }
    const g = await guard(request, body);
    if (g.response) return g.response;
    return handlers.formsAction({ action: request.params.action, body, user: g.user });
  }
});
