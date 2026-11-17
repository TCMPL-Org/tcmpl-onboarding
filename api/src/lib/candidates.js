'use strict';
// Deleting a candidate (admins only): everything the tool holds about them, in one go. Cannot be undone.
//   candidates/<id>, their messages, documents (records and stored files), offer letter, calls, offers.
// What stays: one line in `deletions` (who, when, client, last 4 digits of the mobile, how much was removed).
// Messages already delivered to the candidate's WhatsApp or email stay on their phone / mailbox.
//
// POST /api/candidates/delete { candidateId, confirmName }   confirmName must match the candidate's name

const crypto = require('crypto');
const { getStore } = require('./store');
const access = require('./access');
const blob = require('./blob');

const res = (status, body) => ({ status, body });
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

async function removeAll(store, col, match, user) {
  let n = 0;
  for (const r of await store.list(col)) if (match(r)) { await store.remove(col, r.id, user); n++; }
  return n;
}

async function deleteCandidate(store, p, user) {
  if (user.role && user.role !== 'admin') return res(403, { error: 'admin_only', detail: 'Only admins can delete candidates.' });
  const id = String(p.candidateId || '');
  if (!/^[\w.:-]{1,200}$/.test(id)) return res(400, { error: 'bad_id' });
  const rec = await store.get('candidates', id);
  if (!rec) return res(404, { error: 'not_found' });
  const c = rec.data || {};
  const client = (c.profile && c.profile.client) || c.client || 'default';
  if (!access.canClient(user, client)) return res(404, { error: 'not_found' });
  const name = c.name || (c.profile && c.profile.name) || '';
  if (!name || norm(p.confirmName) !== norm(name)) return res(409, { error: 'name_mismatch', detail: `Type the candidate's name exactly (${name || 'no name on file'}) to confirm.` });

  const counts = {};
  // Documents: the stored files first, then the records.
  let files = 0;
  for (const d of await store.list('documents')) {
    if (!d.data || d.data.candidateId !== id) continue;
    if (d.data.blobPath && blob.storageConfigured()) { await blob.deleteFile(d.data.blobPath).catch(() => {}); files++; }
    await store.remove('documents', d.id, user); counts.documents = (counts.documents || 0) + 1;
  }
  counts.files = files;
  counts.messages = await removeAll(store, 'messages', r => r.data && r.data.candidateId === id, user);
  counts.calls = await removeAll(store, 'calls', r => r.data && r.data.candidateId === id, user);
  if (await store.get('letters', id)) { await store.remove('letters', id, user); counts.letter = 1; }
  const offerIds = new Set([c.offerId].concat((c.history || []).map(h => h && h.offerId)).filter(Boolean));
  counts.offers = 0;
  for (const oid of offerIds) if (/^[\w.:-]{1,200}$/.test(oid) && await store.get('offers', oid)) { await store.remove('offers', oid, user); counts.offers++; }
  await store.remove('candidates', id, user);

  const digits = String(c.phone || '').replace(/\D/g, '');
  await store.put('deletions', 'del-' + crypto.randomBytes(5).toString('hex'), {
    at: new Date().toISOString(), by: user.email || user.name || '', client, mobileLast4: digits.slice(-4), counts
  }, user).catch(e => console.error('deletions', e && e.message));
  return res(200, { ok: true, counts });
}

async function handle(action, p, user) {
  const store = getStore();
  if (!store) return res(503, { error: 'database_not_configured' });
  try {
    if (action === 'delete') return await deleteCandidate(store, p && typeof p === 'object' ? p : {}, user);
    return res(404, { error: 'unknown_action' });
  } catch (e) {
    console.error('candidates', action, e && e.message);
    return res(500, { error: 'delete_failed', detail: 'Something went wrong; part of the data may remain. Please try again.' });
  }
}

module.exports = { handle };
