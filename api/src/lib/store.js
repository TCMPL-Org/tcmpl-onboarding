'use strict';
// Data store for the onboarding agent.
//
// Production: Azure Cosmos DB for NoSQL (connection string in the app setting
// COSMOS_CONNECTION_STRING). The database and containers are created on first use.
//   database  "onboarding"
//   container "records"  partition key /pk  (pk = "<tenant>|<collection>")
//   container "audit"    partition key /tenant  (who changed what, when)
// Every record carries tenant, client, createdBy/updatedBy and timestamps so the
// same structure serves many TCMPL clients and, later, WhatsApp conversations.
//
// Local development only: set DEV_MEMORY_STORE=1 to use an in-memory store.

const crypto = require('node:crypto');

const COLLECTIONS = new Set(['structures', 'templates', 'plans', 'offers', 'clients', 'master', 'employees', 'fx', 'candidates', 'messages', 'letters', 'documents', 'content', 'facts', 'journeys',
  // Module switches per client, and the Exit module's own collections (written only through /api/exit/...)
  'modules', 'exit_cases', 'exit_messages', 'exit_approvals', 'exit_clearances', 'exit_settlements', 'exit_interviews', 'exit_alumni', 'exit_setup', 'exit_documents']);
const ID_RE = /^[A-Za-z0-9_.:-]{1,200}$/;

function tenant() { return process.env.TENANT_ID || 'tcmpl'; }
function validCol(col) { return COLLECTIONS.has(col); }
function validId(id) { return typeof id === 'string' && ID_RE.test(id); }

function toRecord(item) {
  return { id: item.docId, data: item.data, meta: { updatedAt: item.updatedAt, updatedBy: item.updatedBy } };
}

/* ---------------- Cosmos DB ---------------- */
let cosmosReady = null;
function cosmos() {
  if (cosmosReady) return cosmosReady;
  cosmosReady = (async () => {
    const { CosmosClient } = require('@azure/cosmos');
    const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
    const { database } = await client.databases.createIfNotExists({ id: process.env.COSMOS_DATABASE || 'onboarding' });
    const { container: records } = await database.containers.createIfNotExists({ id: 'records', partitionKey: { paths: ['/pk'] } });
    const { container: audit } = await database.containers.createIfNotExists({ id: 'audit', partitionKey: { paths: ['/tenant'] } });
    return { records, audit };
  })();
  cosmosReady.catch(() => { cosmosReady = null; });
  return cosmosReady;
}

const cosmosStore = {
  kind: 'cosmos',
  async list(col) {
    const { records } = await cosmos();
    const pk = `${tenant()}|${col}`;
    const { resources } = await records.items
      .query({ query: 'SELECT * FROM c WHERE c.pk = @pk', parameters: [{ name: '@pk', value: pk }] }, { partitionKey: pk })
      .fetchAll();
    return resources.map(toRecord);
  },
  async get(col, id) {
    const { records } = await cosmos();
    const pk = `${tenant()}|${col}`;
    try {
      const { resource } = await records.item(id, pk).read();
      return resource ? toRecord(resource) : null;
    } catch (e) {
      if (e && e.code === 404) return null;
      throw e;
    }
  },
  async put(col, id, data, user) {
    const { records, audit } = await cosmos();
    const pk = `${tenant()}|${col}`;
    const now = new Date().toISOString();
    let createdAt = now, createdBy = user.name;
    try {
      const { resource } = await records.item(id, pk).read();
      if (resource) { createdAt = resource.createdAt || now; createdBy = resource.createdBy || user.name; }
    } catch (e) { if (!(e && e.code === 404)) throw e; }
    const item = {
      id, pk, docId: id, tenant: tenant(), col,
      client: (data && typeof data.client === 'string') ? data.client : null,
      data, createdAt, createdBy, updatedAt: now, updatedBy: user.name
    };
    await records.items.upsert(item);
    await audit.items.create({ id: crypto.randomUUID(), tenant: tenant(), col, docId: id, action: 'save', by: user.name, at: now });
    return toRecord(item);
  },
  async remove(col, id, user) {
    const { records, audit } = await cosmos();
    const pk = `${tenant()}|${col}`;
    try { await records.item(id, pk).delete(); }
    catch (e) { if (!(e && e.code === 404)) throw e; }
    await audit.items.create({ id: crypto.randomUUID(), tenant: tenant(), col, docId: id, action: 'delete', by: user.name, at: new Date().toISOString() });
  }
};

/* ---------------- In-memory (local development only) ---------------- */
const mem = new Map();
const memoryStore = {
  kind: 'memory',
  async list(col) { return [...mem.values()].filter(x => x.col === col).map(toRecord); },
  async get(col, id) { const x = mem.get(`${col}|${id}`); return x ? toRecord(x) : null; },
  async put(col, id, data, user) {
    const now = new Date().toISOString();
    const item = { docId: id, col, data, updatedAt: now, updatedBy: user.name };
    mem.set(`${col}|${id}`, item);
    return toRecord(item);
  },
  async remove(col, id) { mem.delete(`${col}|${id}`); }
};

function getStore() {
  if (process.env.COSMOS_CONNECTION_STRING) return cosmosStore;
  if (process.env.DEV_MEMORY_STORE === '1') return memoryStore;
  return null;
}

module.exports = { getStore, validCol, validId, COLLECTIONS };
