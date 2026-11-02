'use strict';
// Azure OpenAI / Microsoft Foundry chat call that returns a JSON object.
// App settings: AZURE_OPENAI_ENDPOINT (e.g. https://<name>.openai.azure.com/ - any
// path after the host is ignored), AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT
// (the deployment name you chose), optional AZURE_OPENAI_API_VERSION.

const MAX_PROMPT = 24000;

function aiConfigured() {
  return Boolean(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_DEPLOYMENT);
}

function baseUrl() {
  const raw = process.env.AZURE_OPENAI_ENDPOINT.trim();
  try { return new URL(raw).origin; } catch { return raw.replace(/\/+$/, ''); }
}

async function call(url, payload) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'api-key': process.env.AZURE_OPENAI_API_KEY.trim() },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45000)
  });
}

async function completeJson(prompt) {
  if (!aiConfigured()) { const e = new Error('AI is not configured'); e.code = 'not_configured'; throw e; }
  if (typeof prompt !== 'string' || !prompt.trim()) { const e = new Error('Empty prompt'); e.code = 'bad_request'; throw e; }
  const version = process.env.AZURE_OPENAI_API_VERSION || '2024-10-21';
  const url = `${baseUrl()}/openai/deployments/${encodeURIComponent(process.env.AZURE_OPENAI_DEPLOYMENT.trim())}/chat/completions?api-version=${version}`;
  const messages = [
    { role: 'system', content: 'You are a careful HR onboarding assistant. Follow the instructions in the user message exactly and reply with one JSON object only.' },
    { role: 'user', content: prompt.slice(0, MAX_PROMPT) }
  ];
  // Newer models want max_completion_tokens and default temperature; older ones max_tokens.
  let res = await call(url, { messages, max_completion_tokens: 2000, response_format: { type: 'json_object' } });
  if (res.status === 400) {
    res = await call(url, { messages, max_tokens: 400, temperature: 0.3, response_format: { type: 'json_object' } });
  }
  if (!res.ok) {
    const e = new Error(`Azure OpenAI returned ${res.status}`);
    e.code = res.status === 429 ? 'rate_limited' : (res.status === 404 ? 'deployment_not_found' : (res.status === 401 ? 'bad_key' : 'upstream_error'));
    throw e;
  }
  const body = await res.json();
  const text = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
  try { return JSON.parse(text); }
  catch { const e = new Error('AI reply was not JSON'); e.code = 'upstream_error'; throw e; }
}

module.exports = { aiConfigured, completeJson };
