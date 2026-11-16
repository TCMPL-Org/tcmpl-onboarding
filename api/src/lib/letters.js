'use strict';
// Word offer letter templates: upload, placeholder set-up, signatories and making the letter.
//
//   lettertpl/<id>     name, client ('*' = all clients), versions [{ v, at, by, fileName, size, scan }], current,
//                      map { FIELD: { src, value?, label? } }, tables { Table: { cols, items } },
//                      images { NAME: { src: 'signature' | 'picture' | 'blank', has? } }, dateFmt
//   signatories/<id>   client, name, designation, hasImage
//   letterlog/<id>     who approved which letter with which signature, and when
//   files (Blob Storage "letter-kit/...", or the letterfiles collection when Blob Storage is not set up):
//                      the Word file of each version, pictures, signature images. Never sent to the browser
//                      except the Word template itself (to admins and HR who can see the client).
//
// POST /api/letters/{action}
//   status                         { graph, storage }
//   upload    (admin)  { id?, name, client, fileName, base64 }     new template, or a new version of id
//   save      (admin)  { id, name, client, map, tables, images, dateFmt }
//   delete    (admin)  { id }
//   file               { id, v? }                                  -> { base64, fileName } the Word template
//   picture   (admin)  { id, field, base64 | remove }              picture for an «Image:FIELD» (e.g. logo)
//   signatory-save   (admin) { id?, client, name, designation, base64? }
//   signatory-delete (admin) { id }
//   render             { id, client, fields, tables, signatoryId?, final?, password?, candidate? }
//       preview -> { docxBase64, missing }   (no signature; blanks highlighted)
//       final   -> { base64, mime, fileName, protected, pdf }      (409 { error:'missing', missing } when incomplete)

const crypto = require('crypto');
const { getStore } = require('./store');
const blob = require('./blob');
const access = require('./access');
const merge = require('./docx-merge');
const graph = require('./graph');
const pdfLock = require('./pdf-lock');

const MAX_DOCX = 5 * 1024 * 1024, MAX_PIC = 1024 * 1024;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const res = (status, body) => ({ status, body });
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const isAdmin = u => !u.role || u.role === 'admin';
const newId = p => p + '-' + crypto.randomBytes(5).toString('hex');
const okId = id => typeof id === 'string' && /^[a-z]{2}-[0-9a-f]{6,20}$/.test(id);
const cleanClient = c => (c === '*' ? '*' : str(c, 60).replace(/[^\w.:-]/g, ''));
const canSee = (u, client) => client === '*' || access.allClients(u) || access.canClient(u, client);

function b64(v, max) {
  if (typeof v !== 'string' || !v) return null;
  const s = v.replace(/^data:[^,]*,/, '');
  if (s.length > Math.ceil(max * 4 / 3) + 8 || !/^[A-Za-z0-9+/=\r\n]+$/.test(s)) return null;
  return Buffer.from(s, 'base64');
}

/* ---------- files ---------- */
const fileKey = k => k.replace(/[^\w.-]/g, '.');
async function putFile(store, key, buffer, mime, user) {
  if (blob.storageConfigured()) return blob.putFile('letter-kit/' + key, buffer, mime);
  if (buffer.length > 1200000) throw Object.assign(new Error('file_too_large_without_storage'), { code: 'file_too_large_without_storage' });
  await store.put('letterfiles', fileKey(key), { b64: buffer.toString('base64'), mime }, user);
  return key;
}
async function getFile(store, key) {
  if (blob.storageConfigured()) { try { return (await blob.getFile('letter-kit/' + key)).buffer; } catch { /* older copy in the database */ } }
  const r = await store.get('letterfiles', fileKey(key));
  return r && r.data && r.data.b64 ? Buffer.from(r.data.b64, 'base64') : null;
}
async function delFile(store, key) {
  if (blob.storageConfigured()) await blob.deleteFile('letter-kit/' + key).catch(() => {});
  await store.remove('letterfiles', fileKey(key), { name: 'letters' }).catch(() => {});
}

/* ---------- set-up ---------- */
const SRC_RE = /^[a-z]+(\.[A-Za-z0-9_]+)?$/;
function cleanMap(m) {
  const out = {};
  for (const [k, v] of Object.entries(m && typeof m === 'object' ? m : {}).slice(0, 300)) {
    if (!/^[A-Za-z][\w:]{0,80}$/.test(k) || !v || typeof v !== 'object') continue;
    const src = str(v.src, 60);
    if (!SRC_RE.test(src)) continue;
    out[k] = { src, value: str(v.value, 2000), label: str(v.label, 120), required: v.required !== false };
  }
  return out;
}
function cleanTables(t) {
  const out = {};
  for (const [name, v] of Object.entries(t && typeof t === 'object' ? t : {}).slice(0, 20)) {
    if (!/^[A-Za-z][\w]{0,60}$/.test(name) || !v || typeof v !== 'object') continue;
    const cols = {};
    for (const [f, role] of Object.entries(v.cols || {}).slice(0, 20)) if (/^[A-Za-z][\w]{0,80}$/.test(f) && ['name', 'nature', 'monthly', 'yearly', 'blank'].includes(role)) cols[f] = role;
    const items = (Array.isArray(v.items) ? v.items : []).slice(0, 40).map(x => ({ key: str(x && x.key, 30).replace(/[^\w]/g, ''), nature: str(x && x.nature, 40), label: str(x && x.label, 80) })).filter(x => x.key);
    out[name] = { cols, items };
  }
  return out;
}
function cleanImages(m, prev) {
  const out = {};
  for (const [k, v] of Object.entries(m && typeof m === 'object' ? m : {}).slice(0, 20)) {
    if (!/^[A-Za-z][\w]{0,80}$/.test(k) || !v) continue;
    const src = ['signature', 'picture', 'blank'].includes(v.src) ? v.src : 'blank';
    out[k] = { src, has: Boolean(prev && prev[k] && prev[k].has) };
  }
  return out;
}

async function upload(store, p, user) {
  if (!isAdmin(user)) return res(403, { error: 'admin_only' });
  const buf = b64(p.base64, MAX_DOCX);
  if (!buf) return res(400, { error: 'word_file_required', detail: 'Upload a .docx file of up to 5 MB.' });
  let scan;
  try { scan = await merge.scan(buf); } catch (e) { return res(400, { error: e.code || 'not_a_docx', detail: 'This is not a Word (.docx) file that can be read. Save it in Word as .docx and try again.' }); }
  const id = p.id ? str(p.id, 30) : newId('lt');
  if (!okId(id)) return res(400, { error: 'bad_id' });
  const prev = p.id ? await store.get('lettertpl', id) : null;
  if (p.id && !prev) return res(404, { error: 'not_found' });
  const d = prev ? Object.assign({}, prev.data) : { name: str(p.name, 120) || 'Offer letter', client: cleanClient(p.client || '*'), versions: [], map: {}, tables: {}, images: {}, dateFmt: 'd MMMM yyyy' };
  const v = (d.versions.reduce((a, x) => Math.max(a, x.v), 0) || 0) + 1;
  await putFile(store, `tpl/${id}/v${v}.docx`, buf, DOCX_MIME, user);
  d.versions = [{ v, at: new Date().toISOString(), by: user.email || user.name || '', fileName: str(p.fileName, 150) || 'template.docx', size: buf.length, scan }].concat(d.versions).slice(0, 20);
  d.current = v;
  d.updated = new Date().toISOString();
  await store.put('lettertpl', id, d, user);
  return res(200, { id, v, scan });
}

async function save(store, p, user) {
  if (!isAdmin(user)) return res(403, { error: 'admin_only' });
  const rec = okId(p.id) ? await store.get('lettertpl', p.id) : null;
  if (!rec) return res(404, { error: 'not_found' });
  const d = Object.assign({}, rec.data);
  if (p.name !== undefined) d.name = str(p.name, 120) || d.name;
  if (p.client !== undefined) d.client = cleanClient(p.client) || d.client;
  if (p.map !== undefined) d.map = cleanMap(p.map);
  if (p.tables !== undefined) d.tables = cleanTables(p.tables);
  if (p.images !== undefined) d.images = cleanImages(p.images, d.images);
  if (p.dateFmt !== undefined) d.dateFmt = ['d MMMM yyyy', 'dd/MM/yyyy', 'dd-MMM-yyyy', 'dd.MM.yyyy', 'MMMM d, yyyy'].includes(p.dateFmt) ? p.dateFmt : 'd MMMM yyyy';
  if (p.active !== undefined) d.active = p.active !== false;
  d.updated = new Date().toISOString();
  await store.put('lettertpl', p.id, d, user);
  return res(200, { ok: true });
}

async function remove(store, p, user) {
  if (!isAdmin(user)) return res(403, { error: 'admin_only' });
  const rec = okId(p.id) ? await store.get('lettertpl', p.id) : null;
  if (!rec) return res(404, { error: 'not_found' });
  for (const x of rec.data.versions || []) await delFile(store, `tpl/${p.id}/v${x.v}.docx`);
  for (const k of Object.keys(rec.data.images || {})) await delFile(store, `pic/${p.id}/${k}`);
  await store.remove('lettertpl', p.id, user);
  return res(200, { ok: true });
}

async function file(store, p, user) {
  const rec = okId(p.id) ? await store.get('lettertpl', p.id) : null;
  if (!rec || !canSee(user, rec.data.client)) return res(404, { error: 'not_found' });
  const v = +p.v || rec.data.current;
  const ver = (rec.data.versions || []).find(x => x.v === v);
  const buf = ver && await getFile(store, `tpl/${p.id}/v${v}.docx`);
  if (!buf) return res(404, { error: 'file_not_found' });
  return res(200, { base64: buf.toString('base64'), fileName: ver.fileName });
}

async function picture(store, p, user) {
  if (!isAdmin(user)) return res(403, { error: 'admin_only' });
  const rec = okId(p.id) ? await store.get('lettertpl', p.id) : null;
  const field = str(p.field, 80);
  if (!rec || !/^[A-Za-z][\w]{0,80}$/.test(field)) return res(404, { error: 'not_found' });
  const d = Object.assign({}, rec.data, { images: Object.assign({}, rec.data.images) });
  if (p.remove) { await delFile(store, `pic/${p.id}/${field}`); d.images[field] = { src: 'blank', has: false }; }
  else {
    const buf = b64(p.base64, MAX_PIC);
    const size = buf && merge.imageSize(buf);
    if (!size) return res(400, { error: 'picture_required', detail: 'Upload a PNG or JPEG of up to 1 MB.' });
    await putFile(store, `pic/${p.id}/${field}`, buf, 'image/' + size.type, user);
    d.images[field] = { src: 'picture', has: true };
  }
  d.updated = new Date().toISOString();
  await store.put('lettertpl', p.id, d, user);
  return res(200, { ok: true });
}

async function signatorySave(store, p, user) {
  if (!isAdmin(user)) return res(403, { error: 'admin_only' });
  const id = p.id ? str(p.id, 30) : newId('sg');
  if (!okId(id)) return res(400, { error: 'bad_id' });
  const prev = p.id ? await store.get('signatories', id) : null;
  if (p.id && !prev) return res(404, { error: 'not_found' });
  const name = str(p.name, 120).trim(), designation = str(p.designation, 120).trim();
  if (!name) return res(400, { error: 'name_required' });
  const d = Object.assign({}, prev ? prev.data : {}, { client: cleanClient(p.client || (prev && prev.data.client) || '*'), name, designation, updated: new Date().toISOString() });
  if (p.base64) {
    const buf = b64(p.base64, MAX_PIC);
    const size = buf && merge.imageSize(buf);
    if (!size) return res(400, { error: 'picture_required', detail: 'Upload the signature as a PNG or JPEG of up to 1 MB.' });
    await putFile(store, `sig/${id}`, buf, 'image/' + size.type, user);
    d.hasImage = true;
    d.imageAt = d.updated;
  }
  await store.put('signatories', id, d, user);
  return res(200, { id });
}

async function signatoryDelete(store, p, user) {
  if (!isAdmin(user)) return res(403, { error: 'admin_only' });
  if (!okId(p.id)) return res(404, { error: 'not_found' });
  await delFile(store, `sig/${p.id}`);
  await store.remove('signatories', p.id, user);
  return res(200, { ok: true });
}

/* ---------- making the letter ---------- */
function cleanValues(o) {
  const out = {};
  for (const [k, v] of Object.entries(o && typeof o === 'object' ? o : {}).slice(0, 400)) if (/^[A-Za-z][\w]{0,80}$/.test(k) && v !== undefined && v !== null) out[k] = str(v, 3000);
  return out;
}
function cleanRows(t) {
  const out = {};
  for (const [k, rows] of Object.entries(t && typeof t === 'object' ? t : {}).slice(0, 20)) if (/^[A-Za-z][\w]{0,60}$/.test(k) && Array.isArray(rows)) out[k] = rows.slice(0, 60).map(cleanValues);
  return out;
}

async function render(store, p, user) {
  const rec = okId(p.id) ? await store.get('lettertpl', p.id) : null;
  if (!rec || !canSee(user, rec.data.client)) return res(404, { error: 'not_found' });
  const d = rec.data, v = d.current;
  const buf = await getFile(store, `tpl/${p.id}/v${v}.docx`);
  if (!buf) return res(404, { error: 'file_not_found' });
  const final = Boolean(p.final);
  const images = {}, imageNotes = {};
  let signer = null;
  const ver = (d.versions || []).find(x => x.v === v) || {};
  const wanted = (ver.scan && ver.scan.images) || Object.keys(d.images || {});
  for (const k of wanted) {
    const m = (d.images || {})[k] || { src: /SIGN/i.test(k) ? 'signature' : 'blank' };
    if (m.src === 'blank') { images[k] = null; continue; }
    if (m.src === 'picture') { const pic = await getFile(store, `pic/${p.id}/${k}`); if (pic) images[k] = { data: pic }; continue; }
    // The signature goes in only on the final (approved) letter.
    imageNotes[k] = 'signature added on approval';
    if (!final) continue;
    const sid = okId(p.signatoryId) ? p.signatoryId : '';
    const s = sid ? await store.get('signatories', sid) : null;
    if (!s || !canSee(user, s.data.client) || (s.data.client !== '*' && d.client !== '*' && s.data.client !== d.client && s.data.client !== p.client)) return res(409, { error: 'signatory_required', detail: 'Choose who signs this letter.' });
    const img = s.data.hasImage ? await getFile(store, `sig/${sid}`) : null;
    if (!img) return res(409, { error: 'signature_missing', detail: `No signature image for ${s.data.name}. An admin can add it in Offer letters.` });
    images[k] = { data: img };
    signer = { id: sid, name: s.data.name };
  }
  let out;
  try { out = await merge.fill(buf, { fields: cleanValues(p.fields), tables: cleanRows(p.tables), images, imageNotes, preview: !final }); }
  catch (e) { return res(400, { error: e.code || 'fill_failed', detail: e.message }); }
  if (!final) return res(200, { docxBase64: out.buffer.toString('base64'), missing: out.missing });
  if (out.missing.length) return res(409, { error: 'missing', missing: out.missing, detail: 'Fill in: ' + out.missing.join(', ') });

  const base = (str(p.fileName, 100) || 'Offer_Letter').replace(/[^\w.-]+/g, '_').replace(/\.(pdf|docx)$/i, '');
  let file = out.buffer, mime = DOCX_MIME, ext = 'docx', isPdf = false, locked = false, note = '';
  if (graph.graphConfigured()) {
    try {
      file = await graph.docxToPdf(out.buffer); mime = 'application/pdf'; ext = 'pdf'; isPdf = true;
      const pw = /^\d{8}$/.test(String(p.password || '')) ? String(p.password) : '';
      if (pw) { file = await pdfLock.lock(file, pw); locked = true; }
    } catch (e) { note = 'PDF conversion failed, so the Word file is used: ' + e.message; console.error('letter pdf', e && e.message); file = out.buffer; mime = DOCX_MIME; ext = 'docx'; isPdf = false; locked = false; }
  } else note = 'Microsoft 365 PDF conversion is not set up, so the letter goes as a Word file.';
  const at = new Date().toISOString();
  await store.put('letterlog', newId('lg'), {
    template: p.id, templateName: d.name, version: v, client: str(p.client, 60) || d.client, candidate: str(p.candidate && p.candidate.name, 120),
    mobile: (d => '•'.repeat(Math.max(0, d.length - 4)) + d.slice(-4))(str(p.candidate && p.candidate.mobile, 20).replace(/\D/g, '')), signatory: signer, by: user.email || user.name || '', at, pdf: isPdf, protected: locked
  }, user).catch(e => console.error('letterlog', e && e.message));
  return res(200, { base64: file.toString('base64'), mime, fileName: `${base}.${ext}`, pdf: isPdf, protected: locked, note });
}

async function handle(action, p, user) {
  const store = getStore();
  if (!store) return res(503, { error: 'database_not_configured' });
  p = p && typeof p === 'object' ? p : {};
  try {
    switch (action) {
      case 'status': return res(200, { graph: graph.graphConfigured(), storage: blob.storageConfigured(), admin: isAdmin(user) });
      case 'upload': return await upload(store, p, user);
      case 'save': return await save(store, p, user);
      case 'delete': return await remove(store, p, user);
      case 'file': return await file(store, p, user);
      case 'picture': return await picture(store, p, user);
      case 'signatory-save': return await signatorySave(store, p, user);
      case 'signatory-delete': return await signatoryDelete(store, p, user);
      case 'render': return await render(store, p, user);
      default: return res(404, { error: 'unknown_action' });
    }
  } catch (e) {
    console.error('letters', action, e && e.message);
    return res(e.code === 'file_too_large_without_storage' ? 413 : 500, { error: e.code || 'letters_failed', detail: e.code === 'file_too_large_without_storage' ? 'Set up Blob Storage (STORAGE_CONNECTION_STRING) to keep files over 1.2 MB.' : 'Something went wrong. Please try again.' });
  }
}

module.exports = { handle, DOCX_MIME };
