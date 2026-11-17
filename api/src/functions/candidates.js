'use strict';
const { app } = require('@azure/functions');
const { guard } = require('../lib/access');
const candidates = require('../lib/candidates');

// POST /api/candidates/{action}  signed-in users (lib/access.js); delete: admins only (lib/candidates.js).
app.http('candidates', {
  methods: ['POST'],
  authLevel: 'anonymous', // every request is checked by guard()
  route: 'candidates/{action}',
  handler: async (request) => {
    const body = await request.json().catch(() => ({}));
    const g = await guard(request, body);
    if (g.response) return g.response;
    const r = await candidates.handle(request.params.action, body, g.user);
    return { status: r.status, jsonBody: r.body };
  }
});
