'use strict';
const { app } = require('@azure/functions');
const handlers = require('../lib/handlers');
const { getUser } = require('../lib/auth');

// POST /api/ai  { prompt }  -> { result: <JSON object from Azure OpenAI> }
app.http('ai', {
  methods: ['POST'],
  authLevel: 'anonymous', // access is enforced by Static Web Apps sign-in + getUser()
  route: 'ai',
  handler: async (request) => {
    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: 'invalid_json' } }; }
    return handlers.ai({ body, user: getUser(request.headers) });
  }
});
