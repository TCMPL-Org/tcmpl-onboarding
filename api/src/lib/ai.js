'use strict';
// Azure OpenAI chat call that returns a JSON object.
// App settings: AZURE_OPENAI_ENDPOINT (https://<name>.openai.azure.com),
// AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT (the deployment name you chose),
// optional AZURE_OPENAI_API_VERSION.

const MAX_PROMPT = 24000;

function aiConfigured() {
  return Boolean(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_DEPLOYMENT);
}

async function completeJson(prompt) {
  if (!aiConfigured()) { const e = new Error('AI is not configured'); e.code = 'not_configured'; throw e; }
  if (typeof prompt !== 'string' || !prompt.trim()) { const e = new Error('Empty prompt'); e.code = 'bad_request'; throw e; }
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, '');
  const version = process.env.AZURE_OPENAI_API_VERSION || '2024-10-21';
  const url = `${endpoint}/openai/deployments/${encodeURIComponent(process.env.AZURE_OPENAI_DEPLOYMENT)}/chat/completions?api-version=${version}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'api-key': process.env.AZURE_OPENAI_API_KEY },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: 'You are a careful HR onboarding assistant. Follow the instructions in the user message exactly and reply with one JSON object only.' },
        { role: 'user', content: prompt.slice(0, MAX_PROMPT) }
      ],
      temperature: 0.3,
      max_tokens: 400,
      response_format: { type: 'json_object' }
    }),
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) {
    const e = new Error(`Azure OpenAI returned ${res.status}`);
    e.code = res.status === 429 ? 'rate_limited' : 'upstream_error';
    throw e;
  }
  const body = await res.json();
  const text = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
  try { return JSON.parse(text); }
  catch { const e = new Error('AI reply was not JSON'); e.code = 'upstream_error'; throw e; }
}

module.exports = { aiConfigured, completeJson };
