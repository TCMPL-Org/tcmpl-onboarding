'use strict';
const { app } = require('@azure/functions');
const passwords = require('../lib/passwords');

// Email + password sign-in (open routes: they are how people get in):
//   POST /api/auth/login         { email, password }  -> sets the tc_session cookie
//   POST /api/auth/logout                             -> clears it
//   POST /api/auth/forgot        { email }            -> emails a reset link if the account exists (always answers ok)
//   POST /api/auth/link-info     { token }            -> whose invite / reset link this is
//   POST /api/auth/set-password  { token, password }  -> sets the password and signs in
app.http('auth', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/{action}',
  handler: async (request) => {
    const body = await request.json().catch(() => ({}));
    return passwords.httpAction({ action: request.params.action, body: body && typeof body === 'object' ? body : {}, request });
  }
});
