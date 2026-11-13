'use strict';
const { app } = require('@azure/functions');
const { guard } = require('../lib/access');
const modules = require('../lib/modules');

// Per-client module switches (signed-in HR):
//   POST /api/modules/get   { client }        -> { modules: { onboarding, exit }, loaded: [...] }
//   POST /api/modules/save  { client, exit }  -> switch Exit on or off for the client
app.http('modules', {
  methods: ['POST'],
  authLevel: 'anonymous', // signed-in users on the app's user list only (lib/access.js)
  route: 'modules/{action}',
  handler: async (request) => {
    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: 'invalid_json' } }; }
    const g = await guard(request, body);
    if (g.response) return g.response;
    return modules.httpAction({ action: request.params.action, body, user: g.user });
  }
});
