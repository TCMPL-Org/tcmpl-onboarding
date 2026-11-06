'use strict';
const { app } = require('@azure/functions');
const handlers = require('../lib/handlers');
const { getUser } = require('../lib/auth');

// Signed-in HR actions:
//   POST /api/notify/owner      { candidateId, k, task, owner|to, cc, subject, body, dueDate } -> email a Day-1 task to its owner
//   POST /api/notify/candidate  { candidateId, subject, body, cc, key }                       -> email the candidate
//   POST /api/notify/settings   { client, replyTo, cc }                                        -> client email settings
//   POST /api/notify/jump|run|realtime|reset { candidateId, day?, time? }                      -> Walkthrough clock
app.http('notify', {
  methods: ['POST'],
  authLevel: 'anonymous', // access is enforced by Static Web Apps sign-in + getUser()
  route: 'notify/{action}',
  handler: async (request) => {
    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: 'invalid_json' } }; }
    return handlers.notifyAction({ action: request.params.action, body, user: getUser(request.headers) });
  }
});

// One-click links in emails ("Mark as done", "Yes, it happened"). Open route: the link itself is signed.
app.http('confirm', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'confirm',
  handler: async (request) => handlers.confirmLink({ token: request.query.get('t') })
});
