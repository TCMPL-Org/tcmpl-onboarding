'use strict';
const { app } = require('@azure/functions');
const { getUser } = require('../lib/auth');
const modules = require('../lib/modules');

// Per-client module switches (signed-in HR):
//   POST /api/modules/get   { client }        -> { modules: { onboarding, exit }, loaded: [...] }
//   POST /api/modules/save  { client, exit }  -> switch Exit on or off for the client
app.http('modules', {
  methods: ['POST'],
  authLevel: 'anonymous', // access is enforced by Static Web Apps sign-in + getUser()
  route: 'modules/{action}',
  handler: async (request) => {
    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: 'invalid_json' } }; }
    return modules.httpAction({ action: request.params.action, body, user: getUser(request.headers) });
  }
});
