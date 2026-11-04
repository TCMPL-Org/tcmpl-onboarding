'use strict';
// Azure AI Document Intelligence (REST, API 2024-11-30).
// App settings:
//   DOCINTEL_ENDPOINT  e.g. https://tcmpl-onboarding-docintel.cognitiveservices.azure.com/
//   DOCINTEL_KEY       KEY 1 from the resource's "Keys and Endpoint" page

const API = '2024-11-30';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function docintelConfigured() {
  return Boolean(process.env.DOCINTEL_ENDPOINT && process.env.DOCINTEL_KEY);
}

function base() {
  const raw = String(process.env.DOCINTEL_ENDPOINT || '').trim();
  try { return new URL(raw).origin; } catch { return raw.replace(/\/+$/, ''); }
}

function fail(message, code, status) {
  const e = new Error(message);
  e.code = code || 'docintel_error';
  e.status = status;
  return e;
}

// Runs one model on a file and returns its analyzeResult.
// model: prebuilt-idDocument | prebuilt-read | prebuilt-layout
// features: optional add-ons, e.g. ['barcodes']
async function analyze(model, buffer, { features = [], timeoutMs = 30000 } = {}) {
  if (!docintelConfigured()) throw fail('Document Intelligence is not configured', 'docintel_not_configured');
  const key = process.env.DOCINTEL_KEY;
  const q = `api-version=${API}` + (features.length ? `&features=${features.join(',')}` : '');
  const url = `${base()}/documentintelligence/documentModels/${encodeURIComponent(model)}:analyze?${q}`;
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ base64Source: Buffer.from(buffer).toString('base64') }),
      signal: AbortSignal.timeout(20000)
    });
    if (res.status !== 429) break;
    await sleep(Math.min(8000, 1000 * (Number(res.headers.get('retry-after')) || 2)));
  }
  if (res.status !== 202) {
    const body = await res.json().catch(() => ({}));
    const err = (body && body.error) || {};
    const inner = (err.innererror && err.innererror.code) || '';
    throw fail(err.message || `Document Intelligence returned ${res.status}`, res.status === 429 ? 'rate_limited' : (inner || err.code || 'docintel_error'), res.status);
  }
  const op = res.headers.get('operation-location');
  if (!op) throw fail('Document Intelligence gave no operation to poll');
  const until = Date.now() + timeoutMs;
  let wait = 1500;
  while (Date.now() < until) {
    await sleep(wait);
    const r = await fetch(op, { headers: { 'Ocp-Apim-Subscription-Key': key }, signal: AbortSignal.timeout(15000) });
    if (r.status === 429) { wait = 2500; continue; }
    const body = await r.json().catch(() => ({}));
    if (body.status === 'succeeded') return body.analyzeResult || {};
    if (body.status === 'failed') throw fail((body.error && body.error.message) || 'Document Intelligence could not read the file');
    wait = 1200;
  }
  throw fail('Document Intelligence took too long', 'docintel_timeout');
}

// Tries with add-on features first, then without if the model refuses them.
async function analyzeWithFallback(model, buffer, features) {
  if (!features || !features.length) return analyze(model, buffer);
  try { return await analyze(model, buffer, { features }); }
  catch (e) { if (e.status === 400) return analyze(model, buffer); throw e; }
}

module.exports = { docintelConfigured, analyze, analyzeWithFallback };
