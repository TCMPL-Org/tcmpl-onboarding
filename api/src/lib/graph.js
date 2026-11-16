'use strict';
// Word -> PDF through Microsoft 365 (Microsoft Graph), so the offer letter PDF looks exactly like the Word file.
// The filled letter is uploaded to one folder in your Microsoft 365, converted, downloaded and deleted at once.
//
// App settings (an app registration in your Microsoft 365 tenant, application permission for files):
//   GRAPH_TENANT_ID       Directory (tenant) ID
//   GRAPH_CLIENT_ID       Application (client) ID
//   GRAPH_CLIENT_SECRET   a client secret of that app
//   GRAPH_DRIVE_ID        the document library (drive) to use, or
//   GRAPH_USER            a mailbox's OneDrive instead, e.g. hr-letters@talentcarriage.com
//   GRAPH_FOLDER          optional folder name (default: tcmpl-letter-conversion)

const crypto = require('crypto');

function graphConfigured() {
  const e = process.env;
  return Boolean(e.GRAPH_TENANT_ID && e.GRAPH_CLIENT_ID && e.GRAPH_CLIENT_SECRET && (e.GRAPH_DRIVE_ID || e.GRAPH_USER));
}

let cached = null;
async function token() {
  if (cached && cached.exp > Date.now() + 60000) return cached.value;
  const e = process.env;
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(e.GRAPH_TENANT_ID)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: e.GRAPH_CLIENT_ID, client_secret: e.GRAPH_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
    signal: AbortSignal.timeout(15000)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('graph_sign_in_failed: ' + (j.error_description || j.error || r.status).toString().split('\n')[0].slice(0, 200));
  cached = { value: j.access_token, exp: Date.now() + (+j.expires_in || 3000) * 1000 };
  return cached.value;
}

function driveBase() {
  const e = process.env;
  return e.GRAPH_DRIVE_ID ? `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(e.GRAPH_DRIVE_ID)}`
    : `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(e.GRAPH_USER)}/drive`;
}

async function call(method, url, opts = {}) {
  const t = await token();
  for (let i = 0; ; i++) {
    const r = await fetch(url, { method, headers: Object.assign({ authorization: 'Bearer ' + t }, opts.headers || {}), body: opts.body, redirect: 'follow', signal: AbortSignal.timeout(opts.timeout || 60000) });
    if ((r.status === 429 || r.status >= 500 || (opts.retry406 && r.status === 406)) && i < 3) {
      await new Promise(res => setTimeout(res, Math.min(8000, (+r.headers.get('retry-after') || 1.5 * (i + 1)) * 1000)));
      continue;
    }
    return r;
  }
}

async function docxToPdf(docx) {
  if (!graphConfigured()) throw new Error('graph_not_configured');
  if (docx.length > 4 * 1024 * 1024) throw new Error('letter_too_large');
  const folder = (process.env.GRAPH_FOLDER || 'tcmpl-letter-conversion').replace(/[^\w .-]/g, '');
  const name = `${crypto.randomUUID()}.docx`;
  const up = await call('PUT', `${driveBase()}/root:/${encodeURIComponent(folder)}/${name}:/content`, {
    headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, body: docx
  });
  const item = await up.json().catch(() => ({}));
  if (!up.ok || !item.id) throw new Error('graph_upload_failed: ' + ((item.error && item.error.code) || up.status));
  try {
    const r = await call('GET', `${driveBase()}/items/${encodeURIComponent(item.id)}/content?format=pdf`, { retry406: true, timeout: 90000 });
    if (!r.ok) throw new Error('graph_convert_failed: ' + r.status);
    const pdf = Buffer.from(await r.arrayBuffer());
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('graph_convert_failed: not a pdf');
    return pdf;
  } finally {
    // Remove the copy at once (permanently where the library allows it).
    const del = await call('POST', `${driveBase()}/items/${encodeURIComponent(item.id)}/permanentDelete`).catch(() => null);
    if (!del || !del.ok) await call('DELETE', `${driveBase()}/items/${encodeURIComponent(item.id)}`).catch(() => null);
  }
}

module.exports = { graphConfigured, docxToPdf };
