'use strict';
const { app } = require('@azure/functions');
const { guard } = require('../lib/access');
const exit = require('../lib/exit'); // also registers the Exit module with the shared app (WhatsApp, scheduler, links)

// Exit module (signed-in HR), POST /api/exit/<action>:
//   setup | setup-save | setup-reset        { client, setup? }     -> the client's exit rules (TCMPL default if none)
//   preview | raise                         { client, case }       -> work out / create an exit case
//   import                                  { client, rows }       -> HRMS rows (any column names)
//   cases                                   { client, all? }       -> case list
//   case | cancel | alert-close             { id, reason?, index? }
app.http('exit', {
  methods: ['POST'],
  authLevel: 'anonymous', // signed-in users on the app's user list only (lib/access.js)
  route: 'exit/{action}',
  handler: async (request) => {
    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: 'invalid_json' } }; }
    const g = await guard(request, body);
    if (g.response) return g.response;
    return exit.action({ action: request.params.action, body, user: g.user });
  }
});
