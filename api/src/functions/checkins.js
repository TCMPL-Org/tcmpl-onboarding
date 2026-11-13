'use strict';
const { app } = require('@azure/functions');
const handlers = require('../lib/handlers');
const { guard } = require('../lib/access');

// Journey check-ins (signed-in HR):
//   POST /api/checkins/setup    { client }                     -> the client's setup (TCMPL default if none) + defaults
//   POST /api/checkins/save     { client, setup }              -> save the setup
//   POST /api/checkins/send     { candidateId, key }           -> send one check-in now (WhatsApp and/or email)
//   POST /api/checkins/answer   { candidateId, key, value }    -> HR records an answer (e.g. given on a call)
//   POST /api/checkins/contacts { candidateId, manager, buddy } -> this candidate's manager / buddy email
app.http('checkins', {
  methods: ['POST'],
  authLevel: 'anonymous', // signed-in users on the app's user list only (lib/access.js)
  route: 'checkins/{action}',
  handler: async (request) => {
    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: 'invalid_json' } }; }
    const g = await guard(request, body);
    if (g.response) return g.response;
    return handlers.checkinAction({ action: request.params.action, body, user: g.user });
  }
});
