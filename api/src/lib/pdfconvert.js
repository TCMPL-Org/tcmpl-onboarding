'use strict';
// Word -> PDF for offer letters. Candidates only ever receive the PDF.
// Two ways, whichever is set up (the first one wins):
//   1. A converter in your own Azure: Gotenberg (LibreOffice) on Azure Container Apps.
//        GOTENBERG_URL       e.g. https://tcmpl-pdf.<region>.azurecontainerapps.io
//        GOTENBERG_USER, GOTENBERG_PASSWORD   the basic-auth login set on the container (recommended)
//   2. Microsoft 365 (Microsoft Graph), see graph.js: GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET,
//      GRAPH_DRIVE_ID or GRAPH_USER.

const graph = require('./graph');

const gotenbergConfigured = () => /^https:\/\//i.test(process.env.GOTENBERG_URL || '');
const pdfConfigured = () => gotenbergConfigured() || graph.graphConfigured();
const pdfService = () => (gotenbergConfigured() ? 'converter' : graph.graphConfigured() ? 'microsoft365' : '');

async function viaGotenberg(docx) {
  const e = process.env;
  const form = new FormData();
  form.append('files', new Blob([docx], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'letter.docx');
  const headers = {};
  if (e.GOTENBERG_USER) headers.authorization = 'Basic ' + Buffer.from(`${e.GOTENBERG_USER}:${e.GOTENBERG_PASSWORD || ''}`).toString('base64');
  const url = e.GOTENBERG_URL.replace(/\/+$/, '') + '/forms/libreoffice/convert';
  let last = '';
  for (let i = 0; i < 3; i++) {
    // The container may be asleep (scale to zero): the first call can take ~20 s.
    const r = await fetch(url, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(90000) }).catch(err => ({ ok: false, status: 0, err }));
    if (r.ok) {
      const pdf = Buffer.from(await r.arrayBuffer());
      if (pdf.subarray(0, 5).toString('latin1') === '%PDF-') return pdf;
      last = 'not a pdf';
    } else last = r.err ? r.err.message : String(r.status);
    if (r.status && r.status < 500 && r.status !== 429) break;
    await new Promise(res => setTimeout(res, 2000 * (i + 1)));
  }
  throw new Error('converter_failed: ' + last);
}

async function docxToPdf(docx) {
  if (gotenbergConfigured()) return viaGotenberg(docx);
  if (graph.graphConfigured()) return graph.docxToPdf(docx);
  throw new Error('pdf_not_set_up');
}

module.exports = { pdfConfigured, pdfService, docxToPdf };
