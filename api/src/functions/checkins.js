'use strict';
const { app } = require('@azure/functions');
const handlers = require('../lib/handlers');
const { getUser } = require('../lib/auth');

// Journey check-ins (signed-in HR):
//   POST /api/checkins/setup    { client }                     -> the client's setup (TCMPL default if none) + defaults
//   POST /api/checkins/save     { client, setup }              -> save the setup
//   POST /api/checkins/send     { candidateId, key }           -> send one check-in now (WhatsApp and/or email)
//   POST /api/checkins/answer   { candidateId, key, value }    -> HR records an answer (e.g. given on a call)
//   POST /api/checkins/contacts { candidateId, manager, buddy } -> this candidate's manager / buddy email
app.http('checkins', {
  methods: ['POST'],
  authLevel: 'anonymous', // access is enforced by Static Web Apps sign-in + getUser()
  route: 'checkins/{action}',
  handler: async (request) => {
    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: 'invalid_json' } }; }
    return handlers.checkinAction({ action: request.params.action, body, user: getUser(request.headers) });
  }
});
