'use strict';
const { app } = require('@azure/functions');
const handlers = require('../lib/handlers');
const { getUser } = require('../lib/auth');

// GET    /api/data/{col}        -> list records
// GET    /api/data/{col}/{id}   -> one record
// PUT    /api/data/{col}/{id}   -> create or replace
// DELETE /api/data/{col}/{id}   -> delete
app.http('data', {
  methods: ['GET', 'PUT', 'DELETE'],
  authLevel: 'anonymous', // access is enforced by Static Web Apps sign-in + getUser()
  route: 'data/{col}/{id?}',
  handler: async (request) => {
    let body = null;
    if (request.method === 'PUT') {
      try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: 'invalid_json' } }; }
    }
    return handlers.data({
      method: request.method,
      col: request.params.col,
      id: request.params.id,
      body,
      user: getUser(request.headers)
    });
  }
});
