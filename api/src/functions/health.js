'use strict';
const { app } = require('@azure/functions');
const handlers = require('../lib/handlers');

// GET /api/health  -> which backend features are switched on
app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async () => handlers.health()
});
