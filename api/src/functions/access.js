'use strict';
const { app } = require('@azure/functions');
const access = require('../lib/access');

// Users and sign-in check:
//   POST /api/access/me           -> who is signed in, allowed or not, role and clients (any signed-in person)
//   POST /api/access/users        -> all users (admins)
//   POST /api/access/user-save    { email, name, role: admin|hr, clients: ['*'] | [ids], active }  (admins)
//   POST /api/access/user-remove  { email }  (admins)
app.http('access', {
  methods: ['POST'],
  authLevel: 'anonymous', // Static Web Apps sign-in; the user list is checked in lib/access.js
  route: 'access/{action}',
  handler: async (request) => {
    const body = await request.json().catch(() => ({}));
    return access.httpAction({ action: request.params.action, body, request });
  }
});
