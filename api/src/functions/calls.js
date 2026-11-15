'use strict';
const { app } = require('@azure/functions');
const { guard } = require('../lib/access');
const calls = require('../lib/calls');

// POST /api/calls/start   { candidateId, purpose, note?, force? }  signed-in HR: the AI voice agent calls the candidate
// POST /api/calls/result  (voice agent, header x-call-key = CALL_AGENT_SECRET)  outcome, answers, transcript
app.http('calls', {
  methods: ['POST'],
  authLevel: 'anonymous', // start: users on the app's user list (lib/access.js); result: shared secret
  route: 'calls/{action}',
  handler: async (request) => {
    const body = await request.json().catch(() => ({}));
    const action = request.params.action;
    if (action === 'result') {
      const r = await calls.result(body, request.headers.get('x-call-key'));
      return { status: r.status, jsonBody: r.body };
    }
    const g = await guard(request, body);
    if (g.response) return g.response;
    if (action === 'start') {
      const r = await calls.start(body, g.user);
      return { status: r.status, jsonBody: r.body };
    }
    return { status: 404, jsonBody: { error: 'unknown_action' } };
  }
});
