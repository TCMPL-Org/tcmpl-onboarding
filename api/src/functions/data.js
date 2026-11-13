'use strict';
const { app } = require('@azure/functions');
const handlers = require('../lib/handlers');
const { guard } = require('../lib/access');

// GET    /api/data/{col}        -> list records
// GET    /api/data/{col}/{id}   -> one record
// PUT    /api/data/{col}/{id}   -> create or replace
// DELETE /api/data/{col}/{id}   -> delete
app.http('data', {
  methods: ['GET', 'PUT', 'DELETE'],
  authLevel: 'anonymous', // signed-in users on the app's user list only (lib/access.js)
  route: 'data/{col}/{id?}',
  handler: async (request) => {
    let body = null;
    if (request.method === 'PUT') {
      try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: 'invalid_json' } }; }
    }
    const g = await guard(request, null);
    if (g.response) return g.response;
    return handlers.data({
      method: request.method,
      col: request.params.col,
      id: request.params.id,
      body,
      user: g.user
    });
  }
});
