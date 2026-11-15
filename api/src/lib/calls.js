'use strict';
// Phone calls by the AI voice agent (LiveKit Cloud + Plivo + Sarvam).
//
// The app starts a call by creating a LiveKit room and dispatching the voice agent into it with the call
// details as metadata; the agent dials the candidate through the Plivo trunk. When the call ends the agent
// posts the outcome to /api/calls/result (header x-call-key = CALL_AGENT_SECRET).
//
//   calls/<callId>  -> purpose, status, answers, flags, transcript
//
// Azure settings:
//   LIVEKIT_URL           wss://<project>.livekit.cloud
//   LIVEKIT_API_KEY / LIVEKIT_API_SECRET
//   LIVEKIT_AGENT_NAME    default tcmpl-onboarding-caller
//   CALL_AGENT_SECRET     shared with the voice agent
//   CALL_HOURS            allowed calling hours in IST, default "9-20"

const crypto = require('node:crypto');
const { getStore } = require('./store');
const wa = require('./whatsapp');
const modules = require('./modules');
const notify = require('./notify');

const SYSTEM = { name: 'voice-agent' };
const PURPOSES = {
  confirm: 'Offer confirmation call',
  noreply: 'Follow-up call (no WhatsApp reply)',
  eve: 'Day-before-joining call',
  close: '90-day closing call',
  general: 'Call from HR'
};
const STATUS = { answered: 'answered', no_answer: 'not answered', busy: 'busy', declined: 'declined', failed: 'could not connect', dialing: 'dialing' };

function callsConfigured() {
  return Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET && process.env.CALL_AGENT_SECRET);
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function newId() { return 'call-' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex'); }

function niceDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  return `${+m[3]} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+m[2] - 1]} ${m[1]}`;
}

// The calling hours (IST) for automatic and HR-started calls.
function withinHours(now = Date.now()) {
  const [from, to] = String(process.env.CALL_HOURS || '9-20').split('-').map(Number);
  const h = new Date(now + 330 * 60000).getUTCHours();
  return h >= (Number.isFinite(from) ? from : 9) && h < (Number.isFinite(to) ? to : 20);
}

/* ---------- LiveKit server API (Twirp over HTTPS, signed with the project's API key) ---------- */
function token(grants) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ iss: process.env.LIVEKIT_API_KEY, sub: 'tcmpl-onboarding-app', nbf: now - 10, exp: now + 600, video: grants });
  const sig = crypto.createHmac('sha256', process.env.LIVEKIT_API_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

async function twirp(service, method, payload, grants) {
  const base = String(process.env.LIVEKIT_URL).trim().replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/+$/, '');
  const res = await fetch(`${base}/twirp/livekit.${service}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token(grants)}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(body.msg || `LiveKit returned ${res.status}`); e.code = body.code || 'livekit_error'; throw e; }
  return body;
}

// The few facts the agent needs as separate fields ("address: …", "reporting: …" lines in the client facts).
function factLine(facts, re) {
  const m = new RegExp(`^\\s*(?:${re})[^:\\n]*:\\s*(.+)$`, 'im').exec(facts || '');
  return m ? m[1].trim().slice(0, 200) : '';
}

async function latestFacts(store, cand) {
  const client = cand.profile && cand.profile.client;
  const rec = client ? await store.get('facts', String(client)).catch(() => null) : null;
  const shared = (rec && rec.data && rec.data.facts) || '';
  return [shared, cand.facts || ''].filter(Boolean).join('\n').slice(0, 6000);
}

async function callSettings(store, client) {
  const rec = client ? await store.get('journeys', String(client)).catch(() => null) : null;
  return (rec && rec.data && rec.data.calls) || {};
}

/* ---------- start a call ---------- */
async function start(p, user, opts = {}) {
  const store = getStore();
  if (!store) return { status: 503, body: { error: 'database_not_configured' } };
  if (!callsConfigured()) return { status: 503, body: { error: 'calls_not_configured', detail: 'Add LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET and CALL_AGENT_SECRET in Azure.' } };
  const candidateId = str(p && p.candidateId, 40);
  if (!/^wa-\d{11,15}$/.test(candidateId)) return { status: 400, body: { error: 'candidate_required' } };
  const rec = await store.get('candidates', candidateId);
  if (!rec) return { status: 404, body: { error: 'candidate_not_found' } };
  const cand = rec.data;
  const client = (cand.profile && cand.profile.client) || cand.client || '';
  if (client && !(await modules.enabled(store, client, 'onboarding'))) return { status: 403, body: { error: 'onboarding_off' } };
  const purpose = PURPOSES[p.purpose] ? p.purpose : 'general';
  if (!p.force && !withinHours()) return { status: 409, body: { error: 'outside_hours', detail: `Calls go out between ${process.env.CALL_HOURS || '9-20'} h IST.` } };
  // No second call while one is still going on for this candidate.
  if (cand.lastCall && cand.lastCall.status === 'dialing' && Date.now() - Date.parse(cand.lastCall.at) < 12 * 60000) return { status: 409, body: { error: 'call_in_progress' } };

  const settings = await callSettings(store, client);
  const facts = await latestFacts(store, cand);
  const callId = newId();
  const room = `${callId}-${candidateId}`;
  const meta = {
    callId, candidateId, purpose, phone: '+' + wa.normalizePhone(cand.phone),
    first: cand.first || (cand.profile && cand.profile.first) || (cand.name || '').split(' ')[0],
    name: cand.name || '', company: cand.company || cand.clientLabel || '', role: cand.role || (cand.profile && cand.profile.role) || '',
    doj: niceDate(cand.doj || (cand.profile && cand.profile.doj)), agentName: cand.agentName || '',
    reportingTime: factLine(facts, 'reporting|report time|timing'), address: factLine(facts, 'address|office|location'),
    contact: factLine(facts, 'contact|poc|point of contact|meet'), documents: factLine(facts, 'documents|carry'),
    facts: facts.slice(0, 3000), note: str(p.note, 600),
    language: settings.language || 'auto', voice: settings.voice || '', maxSeconds: 600
  };

  try {
    await twirp('RoomService', 'CreateRoom', { name: room, empty_timeout: 120, departure_timeout: 20, max_participants: 4 }, { roomCreate: true });
    await twirp('AgentDispatchService', 'CreateDispatch', { agent_name: process.env.LIVEKIT_AGENT_NAME || 'tcmpl-onboarding-caller', room, metadata: JSON.stringify(meta) }, { roomAdmin: true, room });
  } catch (e) {
    return { status: 502, body: { error: 'call_start_failed', detail: e.message } };
  }

  const at = new Date().toISOString();
  const by = (user && user.name) || SYSTEM.name;
  await store.put('calls', callId, { callId, candidateId, client, purpose, title: PURPOSES[purpose], status: 'dialing', room, requestedBy: by, auto: Boolean(opts.auto), at }, user || SYSTEM);
  await store.put('candidates', candidateId, Object.assign({}, cand, { lastCall: { callId, purpose, status: 'dialing', at } }), user || SYSTEM);
  await store.put('messages', 'o-' + callId, { candidateId, direction: 'out', channel: 'call', kind: 'call', source: 'call', callId, text: `📞 ${PURPOSES[purpose]}: calling ${meta.phone}…`, by, at }, user || SYSTEM);
  return { status: 200, body: { callId, purpose } };
}

/* ---------- the voice agent reports back ---------- */
function keyOk(key) {
  const want = process.env.CALL_AGENT_SECRET || '';
  const a = Buffer.from(String(key || '')), b = Buffer.from(want);
  return Boolean(want) && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cleanMap(o, n) {
  const out = {};
  for (const [k, v] of Object.entries(o && typeof o === 'object' ? o : {}).slice(0, n)) out[String(k).slice(0, 60)] = String(v).slice(0, 300);
  return out;
}

async function result(body, key) {
  if (!keyOk(key)) return { status: 401, body: { error: 'bad_key' } };
  const store = getStore();
  if (!store) return { status: 503, body: { error: 'database_not_configured' } };
  const callId = str(body && body.callId, 60);
  if (!/^call-[a-z0-9]+$/.test(callId)) return { status: 400, body: { error: 'bad_call' } };
  const rec = await store.get('calls', callId);
  if (!rec) return { status: 404, body: { error: 'call_not_found' } };
  const call = Object.assign({}, rec.data);
  if (call.endedAt) return { status: 200, body: { ok: true, duplicate: true } };

  const status = STATUS[body.status] ? body.status : 'failed';
  const answers = cleanMap(body.answers, 20);
  const flags = (Array.isArray(body.flags) ? body.flags : []).map(f => String(f).slice(0, 300)).slice(0, 10);
  const callback = str(body.callback, 120);
  const transcript = (Array.isArray(body.transcript) ? body.transcript : []).slice(-200)
    .map(t => ({ role: t && t.role === 'candidate' ? 'candidate' : 'agent', text: String((t && t.text) || '').slice(0, 1000) })).filter(t => t.text);
  Object.assign(call, {
    status, sipStatus: str(body.sipStatus, 120), answeredAt: body.answeredAt || null, endedAt: body.endedAt || new Date().toISOString(),
    durationSec: Math.max(0, Math.min(3600, +body.durationSec || 0)), language: str(body.language, 10), answers, flags, callback, transcript
  });
  await store.put('calls', callId, call, SYSTEM);

  const crec = await store.get('candidates', call.candidateId);
  if (crec) {
    const cand = Object.assign({}, crec.data);
    const now = new Date().toISOString();
    cand.lastCall = { callId, purpose: call.purpose, status, at: call.at, endedAt: call.endedAt };
    cand.callAnswers = Object.assign({}, cand.callAnswers, answers);
    const handovers = Array.isArray(cand.handovers) ? cand.handovers.slice() : [];
    for (const f of flags) handovers.push({ why: `Call: ${f}`, at: now, open: true });
    if (callback) handovers.push({ why: `Call back requested on the ${call.title || 'call'}: ${callback}`, at: now, open: true });
    cand.handovers = handovers;
    await store.put('candidates', call.candidateId, cand, SYSTEM);
    try { await notify.alertHandovers(store, call.candidateId, cand) && await store.put('candidates', call.candidateId, cand, SYSTEM); } catch (e) { console.error('call alert failed', e && e.message); }
  }

  const mins = call.durationSec ? ` (${Math.floor(call.durationSec / 60)}:${String(call.durationSec % 60).padStart(2, '0')})` : '';
  const lines = [`📞 ${call.title || 'Call'}: ${STATUS[status]}${mins}${status !== 'answered' && call.sipStatus ? ` · ${call.sipStatus}` : ''}`];
  for (const [k, v] of Object.entries(answers)) lines.push(`• ${k.replace(/_/g, ' ')}: ${v}`);
  for (const f of flags) lines.push(`⚠ For HR: ${f}`);
  if (callback) lines.push(`↩ Call back: ${callback}`);
  await store.put('messages', 'o-' + callId, {
    candidateId: call.candidateId, direction: 'out', channel: 'call', kind: 'call', source: 'call', callId,
    text: lines.join('\n'), transcript: transcript.slice(0, 80), at: call.at, endedAt: call.endedAt
  }, SYSTEM);
  return { status: 200, body: { ok: true } };
}

module.exports = { start, result, callsConfigured, withinHours, PURPOSES, _token: token };
