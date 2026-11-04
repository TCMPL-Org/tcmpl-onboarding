'use strict';
const { app } = require('@azure/functions');
const handlers = require('../lib/handlers');
const { getUser } = require('../lib/auth');

// Signed-in HR actions on candidate documents:
//   POST /api/docs/request            { candidateId }                         -> ask on WhatsApp (consent first)
//   POST /api/docs/review             { candidateId, type, action, fields? }  -> approve / correct / reject
//   GET  /api/docs/file?candidateId=&type=                                    -> open the stored file
app.http('docs', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous', // access is enforced by Static Web Apps sign-in + getUser()
  route: 'docs/{action}',
  handler: async (request) => {
    const user = getUser(request.headers);
    const action = request.params.action;
    if (request.method === 'GET' && action === 'file') {
      return handlers.docsFile({ candidateId: request.query.get('candidateId'), type: request.query.get('type'), user });
    }
    if (request.method !== 'POST') return { status: 405, jsonBody: { error: 'method_not_allowed' } };
    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: 'invalid_json' } }; }
    if (action === 'request') return handlers.docsRequest({ body, user });
    if (action === 'review') return handlers.docsReview({ body, user });
    return { status: 404, jsonBody: { error: 'unknown_action' } };
  }
});
