'use strict';
const { app } = require('@azure/functions');
const handlers = require('../lib/handlers');
const { getUser } = require('../lib/auth');

// Signed-in HR actions for joining forms:
//   POST /api/forms/details  { candidateId }                         -> ask the form questions on WhatsApp
//   POST /api/forms/save     { candidateId, vals, states, approve? } -> save HR corrections / approval
//   POST /api/forms/send     { candidateId, files:[{filename, pdfBase64}] } -> send PDFs to confirm on WhatsApp
app.http('forms', {
  methods: ['POST'],
  authLevel: 'anonymous', // access is enforced by Static Web Apps sign-in + getUser()
  route: 'forms/{action}',
  handler: async (request) => {
    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: 'invalid_json' } }; }
    return handlers.formsAction({ action: request.params.action, body, user: getUser(request.headers) });
  }
});
