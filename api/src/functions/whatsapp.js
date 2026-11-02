'use strict';
const { app } = require('@azure/functions');
const handlers = require('../lib/handlers');

// Meta WhatsApp webhook (public; every POST is checked against Meta's signature).
//   GET  /api/whatsapp  -> Meta's subscription check
//   POST /api/whatsapp  -> incoming candidate messages
app.http('whatsapp', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'whatsapp',
  handler: async (request) => {
    if (request.method === 'GET') {
      const r = handlers.waVerify(request.query);
      return { status: r.status, body: r.body, headers: { 'content-type': 'text/plain' } };
    }
    const raw = await request.text();
    const r = await handlers.waWebhook(raw, request.headers.get('x-hub-signature-256'));
    return { status: r.status, body: r.body, headers: { 'content-type': 'text/plain' } };
  }
});
