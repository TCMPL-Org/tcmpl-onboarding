'use strict';
const { app } = require('@azure/functions');
const { guard } = require('../lib/access');
const letters = require('../lib/letters');

// POST /api/letters/{action}  signed-in users (lib/access.js); setting up templates and signatories: admins.
// Word offer letter templates, signatories, and making the filled letter (see lib/letters.js).
app.http('letters', {
  methods: ['POST'],
  authLevel: 'anonymous', // every request is checked by guard()
  route: 'letters/{action}',
  handler: async (request) => {
    const body = await request.json().catch(() => ({}));
    const g = await guard(request, body);
    if (g.response) return g.response;
    const r = await letters.handle(request.params.action, body, g.user);
    return { status: r.status, jsonBody: r.body };
  }
});
