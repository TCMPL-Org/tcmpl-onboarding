'use strict';
const { app } = require('@azure/functions');
const handlers = require('../lib/handlers');
const { guard } = require('../lib/access');

// POST /api/ai  { prompt }  -> { result: <JSON object from Azure OpenAI> }
app.http('ai', {
  methods: ['POST'],
  authLevel: 'anonymous', // signed-in users on the app's user list only (lib/access.js)
  route: 'ai',
  handler: async (request) => {
    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: 'invalid_json' } }; }
    const g = await guard(request, body);
    if (g.response) return g.response;
    return handlers.ai({ body, user: g.user });
  }
});
