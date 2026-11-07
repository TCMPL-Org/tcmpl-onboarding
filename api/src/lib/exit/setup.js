'use strict';
// Exit setup per client: exit_setup/<client>. A client with nothing saved uses the TCMPL default.
// Everything saved is cleaned field by field, so the screens can never store unexpected data.

const D = require('./defaults');

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v).slice(0, max) : '');
const num = (v, min, max, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : dflt; };
const bool = v => v === true || v === 'true' || v === 'yes' || v === 1;
const oneOf = (v, list, dflt) => (list.includes(v) ? v : dflt);
const slug = (v, max = 40) => str(v, max).replace(/[^\w-]/g, '');
const cleanClient = v => String(v || '').replace(/[^\w-]/g, '').slice(0, 60);

function list(arr, max, fn) {
  const out = [], seen = new Set();
  for (const x of (Array.isArray(arr) ? arr : []).slice(0, max)) {
    if (!x || typeof x !== 'object') continue;
    const c = fn(x, out.length);
    if (!c) continue;
    const key = c.id || c.key;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(c);
  }
  return out;
}

function cleanSetup(s) {
  const d = D.tcmplDefault();
  s = s && typeof s === 'object' ? s : {};
  const out = {};
  out.types = list(s.types || d.types, 40, (t, i) => {
    const name = str(t.name, 80); if (!name) return null;
    return {
      id: slug(t.id) || 't' + (i + 1), name, cat: oneOf(t.cat, D.CATEGORIES, 'Voluntary'),
      raise: (Array.isArray(t.raise) ? t.raise : str(t.raise, 60).split(/[,;]/)).map(x => String(x).trim()).filter(x => D.RAISERS.includes(x)).join(', ') || 'HR',
      notice: oneOf(t.notice, D.NOTICE, 'Serve notice'), letters: str(t.letters, 300), interview: bool(t.interview), alumni: bool(t.alumni),
      announce: oneOf(t.announce, D.ANNOUNCE, 'None'), ta: oneOf(t.ta, D.TELL_TA, 'After manager confirms')
    };
  });
  out.noticeRules = list(s.noticeRules || d.noticeRules, 60, (r, i) => ({ id: slug(r.id) || 'n' + (i + 1), level: str(r.level, 20) || 'Any', dept: str(r.dept, 60) || 'Any', prob: num(r.prob, 0, 365, 30), conf: num(r.conf, 0, 365, 60) }));
  out.probationMonths = num(s.probationMonths !== undefined ? s.probationMonths : d.probationMonths, 0, 36, 6);
  const ns = s.noticeStart || d.noticeStart;
  out.noticeStart = {
    company: oneOf(ns.company, Object.keys(D.START), 'formal'), allowCase: ns.allowCase !== undefined ? bool(ns.allowCase) : true,
    seg: list(ns.seg, 30, (x, i) => ({ id: slug(x.id) || 's' + (i + 1), level: str(x.level, 20) || 'Any', dept: str(x.dept, 60) || 'Any', start: oneOf(x.start, Object.keys(D.START), 'formal') }))
  };
  out.approvals = list(s.approvals || d.approvals, 80, (a, i) => {
    const action = str(a.action, 60); if (!action) return null;
    return { id: slug(a.id) || 'a' + (i + 1), action, level: str(a.level, 20) || 'Any', dept: str(a.dept, 60) || 'Any', type: str(a.type, 40) || 'Any', over: num(a.over, 0, 1e9, 0),
      chain: str(a.chain, 200) || 'Manager', mode: oneOf(a.mode, ['Sequential', 'Parallel'], 'Sequential'), sla: num(a.sla, 1, 720, 48), delegate: str(a.delegate, 80) };
  });
  out.owners = list(s.owners || d.owners, 30, (o, i) => {
    const area = str(o.area, 60); if (!area) return null;
    return { id: slug(o.id) || 'o' + (i + 1), area, owner: str(o.owner, 80), contact: str(o.contact, 300), channel: oneOf(o.channel, D.CHANNELS, 'email'), sla: num(o.sla, 1, 720, 48), items: str(o.items, 300) };
  });
  out.people = list(s.people || d.people, 30, (p, i) => {
    const role = str(p.role, 60); if (!role) return null;
    return { id: slug(p.id) || 'p' + (i + 1), role, contact: str(p.contact, 300) };
  });
  const c = Object.assign({}, d.contacts, s.contacts);
  out.contacts = {};
  for (const k of Object.keys(d.contacts)) out.contacts[k] = str(c[k], k === 'company' ? 120 : 400);
  const f = Object.assign({}, d.fnf, s.fnf);
  out.fnf = { approver: str(f.approver, 60) || 'Client HR', wageDays: num(f.wageDays, 0, 60, 2), gratYears: num(f.gratYears, 0, 10, 5), gratDays: num(f.gratDays, 0, 90, 30) };
  out.interview = { threshold: num((s.interview || d.interview).threshold, 1, 50, 5) };
  const al = Object.assign({}, d.alumni, s.alumni);
  out.alumni = { on: al.on !== undefined ? bool(al.on) : true, exclude: str(al.exclude, 120) };
  const stages = D.STAGES.map(x => x[0]);
  out.steps = list(s.steps || d.steps, 60, (x, i) => {
    const title = str(x.title, 120); if (!title) return null;
    return {
      key: slug(x.key) || 'step' + (i + 1), stage: oneOf(x.stage, stages, 'raised'), title, to: oneOf(x.to, D.RECIPIENTS, 'employee'),
      channel: oneOf(x.channel, D.CHANNELS, 'both'), anchor: oneOf(x.anchor, Object.keys(D.ANCHORS), 'formal'), day: num(x.day, -120, 365, 0),
      time: /^\d{1,2}:\d{2}$/.test(String(x.time || '')) ? String(x.time) : '11:00', when: oneOf(x.when, Object.keys(D.WHEN), 'all'), on: x.on !== false, text: str(x.text, 1500)
    };
  });
  if (!out.types.length) out.types = d.types;
  return out;
}

async function load(store, client) {
  const id = cleanClient(client) || 'default';
  const rec = store ? await store.get('exit_setup', id).catch(() => null) : null;
  if (rec && rec.data && rec.data.setup) return { client: id, setup: cleanSetup(rec.data.setup), isDefault: false, updated: rec.data.updated || '' };
  return { client: id, setup: D.tcmplDefault(), isDefault: true, updated: '' };
}

async function save(store, client, setup, user) {
  const id = cleanClient(client);
  if (!id) return { status: 400, body: { error: 'client_required' } };
  const clean = cleanSetup(setup);
  const data = { client: id, setup: clean, updated: new Date().toISOString() };
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 900000) return { status: 413, body: { error: 'too_large' } };
  await store.put('exit_setup', id, data, user);
  return { status: 200, body: { client: id, setup: clean, isDefault: false, updated: data.updated } };
}

async function reset(store, client, user) {
  const id = cleanClient(client);
  if (!id) return { status: 400, body: { error: 'client_required' } };
  await store.remove('exit_setup', id, user);
  return { status: 200, body: { client: id, setup: D.tcmplDefault(), isDefault: true } };
}

// Lists the screens need for dropdowns.
function options() {
  return { stages: D.STAGES, categories: D.CATEGORIES, notice: D.NOTICE, announce: D.ANNOUNCE, ta: D.TELL_TA, replace: D.REPLACE, raisers: D.RAISERS,
    start: D.START, channels: D.CHANNELS, recipients: D.RECIPIENTS, anchors: D.ANCHORS, when: D.WHEN };
}

module.exports = { cleanSetup, load, save, reset, options, cleanClient, str };
