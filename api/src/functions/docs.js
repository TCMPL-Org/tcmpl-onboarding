'use strict';
const { app } = require('@azure/functions');
const handlers = require('../lib/handlers');
const { guard } = require('../lib/access');

// Signed-in HR actions on candidate documents:
//   POST /api/docs/request            { candidateId }                         -> ask on WhatsApp (consent first)
//   POST /api/docs/review             { candidateId, type, action, fields? }  -> approve / correct / reject
//   GET  /api/docs/file?candidateId=&type=                                    -> open the stored file
app.http('docs', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous', // signed-in users on the app's user list only (lib/access.js)
  route: 'docs/{action}',
  handler: async (request) => {
    const action = request.params.action;
    if (request.method === 'GET' && action === 'file') {
      const g = await guard(request, { candidateId: request.query.get('candidateId') || '' });
      if (g.response) return g.response;
      const user = g.user;
      return handlers.docsFile({ candidateId: request.query.get('candidateId'), type: request.query.get('type'), user });
    }
    if (request.method !== 'POST') return { status: 405, jsonBody: { error: 'method_not_allowed' } };
    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: 'invalid_json' } }; }
    const g = await guard(request, body);
    if (g.response) return g.response;
    const user = g.user;
    if (action === 'request') return handlers.docsRequest({ body, user });
    if (action === 'review') return handlers.docsReview({ body, user });
    return { status: 404, jsonBody: { error: 'unknown_action' } };
  }
});
