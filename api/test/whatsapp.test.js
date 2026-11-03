'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.DEV_MEMORY_STORE = '1';
delete process.env.COSMOS_CONNECTION_STRING;
const wa = require('../src/lib/whatsapp');
const handlers = require('../src/lib/handlers');
const { getStore } = require('../src/lib/store');

const user = { id: 'u1', name: 'hr@example.com' };
const sent = [];
function mockFetch() {
  global.fetch = async (url, opts) => {
    const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : {};
    if (String(url).includes('/media')) return { ok: true, status: 200, json: async () => ({ id: 'media-1' }) };
    if (String(url).includes('graph.facebook.com')) {
      sent.push(body);
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.' + sent.length }] }) };
    }
    // Azure OpenAI
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply: 'AI: we cannot change your CTC; the hiring team will call you.', handover: true, handoverReason: 'Counter offer', callback: '', riskSignals: ['Counter or competing offer mentioned'] }) } }] }) };
  };
}
function setEnv() {
  Object.assign(process.env, {
    WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '123', WHATSAPP_APP_SECRET: 'secret', WHATSAPP_VERIFY_TOKEN: 'verify-me',
    AZURE_OPENAI_ENDPOINT: 'https://x.openai.azure.com', AZURE_OPENAI_API_KEY: 'k', AZURE_OPENAI_DEPLOYMENT: 'chat'
  });
}
function sign(raw) { return 'sha256=' + crypto.createHmac('sha256', 'secret').update(raw).digest('hex'); }
function inbound(from, id, text) {
  return JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { contacts: [{ wa_id: from, profile: { name: 'Ritika' } }], messages: [{ from, id, timestamp: '1', type: 'text', text: { body: text } }] } }] }] });
}

test('phone numbers are normalised for India', () => {
  assert.equal(wa.normalizePhone('+91 98100 00000'), '919810000000');
  assert.equal(wa.normalizePhone('09810000000'), '919810000000');
  assert.equal(wa.normalizePhone('9810000000'), '919810000000');
  assert.equal(wa.normalizePhone('12345'), '');
});

test('webhook subscription check needs the verify token', () => {
  setEnv();
  const q = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': 'abc' });
  assert.deepEqual(handlers.waVerify(q), { status: 200, body: 'abc' });
  q.set('hub.verify_token', 'wrong');
  assert.equal(handlers.waVerify(q).status, 403);
});

test('webhook rejects unsigned or forged posts', async () => {
  setEnv();
  const raw = inbound('919810000000', 'wamid.x', 'hi');
  assert.equal((await handlers.waWebhook(raw, undefined)).status, 401);
  assert.equal((await handlers.waWebhook(raw, 'sha256=' + '0'.repeat(64))).status, 401);
});

test('release -> template sent; candidate reply -> AI answer on WhatsApp, risk + handover recorded', async () => {
  setEnv(); mockFetch(); sent.length = 0;
  const start = await handlers.waStart({ user, body: { name: 'Ritika Sharma', mobile: '+91 98100 00000', role: 'Senior Executive', client: 'northpeak', clientLabel: 'Northpeak', company: 'Northpeak Logistics', agentName: 'Asha', facts: 'salaryDate: 7th of every month', faq: '', letterPdfBase64: Buffer.from('%PDF-1.4 fake offer letter content '.repeat(10)).toString('base64'), letterFile: 'Offer_Letter_Ritika.pdf' } });
  assert.equal(start.status, 200);
  assert.equal(start.jsonBody.sent, true);
  assert.equal(sent[0].type, 'template');
  assert.equal(sent[0].to, '919810000000');

  const raw = inbound('919810000000', 'wamid.in1', 'I got another offer, can you match it?');
  assert.equal((await handlers.waWebhook(raw, sign(raw))).status, 200);
  assert.equal(sent[1].type, 'text');
  assert.match(sent[1].text.body, /cannot change your CTC/);
  assert.equal(sent[2].type, 'document');
  assert.equal(sent[2].document.id, 'media-1');
  assert.equal(sent[2].document.filename, 'Offer_Letter_Ritika.pdf');

  // Meta retries the same message: handled once only
  await handlers.waWebhook(raw, sign(raw));
  assert.equal(sent.length, 3);

  // A second message does not resend the letter
  const raw2 = inbound('919810000000', 'wamid.in2', 'thanks');
  await handlers.waWebhook(raw2, sign(raw2));
  assert.equal(sent.filter(x => x.type === 'document').length, 1);

  const store = getStore();
  const cand = (await store.get('candidates', 'wa-919810000000')).data;
  assert.equal(cand.riskScore, 40);
  assert.equal(cand.handovers.length, 2); // mock AI flags a handover on both messages
  const msgs = (await store.list('messages')).map(r => r.data).filter(m => m.candidateId === 'wa-919810000000');
  assert.equal(msgs.filter(m => m.direction === 'in').length, 2);
  assert.equal(msgs.filter(m => m.direction === 'out').length, 4); // template, reply, letter, reply
});

test('unknown numbers get a polite reply and a handover', async () => {
  setEnv(); mockFetch(); sent.length = 0;
  const raw = inbound('919999999999', 'wamid.unknown', 'hello');
  await handlers.waWebhook(raw, sign(raw));
  assert.match(sent[0].text.body, /couldn't find your offer/);
});

test('HR can reply manually; browser cannot write messages directly', async () => {
  setEnv(); mockFetch(); sent.length = 0;
  const r = await handlers.waSend({ user, body: { candidateId: 'wa-919810000000', text: 'Hi Ritika, Arjun will call you at 4 pm.' } });
  assert.equal(r.status, 200);
  assert.equal(sent[0].text.body, 'Hi Ritika, Arjun will call you at 4 pm.');
  const w = await handlers.data({ method: 'PUT', col: 'messages', id: 'x1', body: { text: 'fake' }, user });
  assert.equal(w.status, 403);
});

test('release without WhatsApp keys still registers the candidate', async () => {
  delete process.env.WHATSAPP_TOKEN;
  const r = await handlers.waStart({ user, body: { name: 'Amit', mobile: '9810000001' } });
  assert.equal(r.status, 200);
  assert.equal(r.jsonBody.sent, false);
  assert.equal(r.jsonBody.reason, 'whatsapp_not_configured');
});

test('HR sends a prepared touchpoint: buttons + offer letter, letter first', async () => {
  setEnv(); mockFetch(); sent.length = 0;
  const r = await handlers.waPush({ user, body: { candidateId: 'wa-919810000000', touchpoint: 'Documents and KYC', items: [
    { type: 'text', text: 'Next, I need a few documents.\n• PAN\n• Aadhaar', buttons: ['Send Aadhaar photo', "I'll use the link"] },
    { type: 'letter', filename: 'Offer_Letter_Ritika.pdf', pdfBase64: Buffer.from('%PDF-1.4 regenerated '.repeat(10)).toString('base64') }
  ] } });
  assert.equal(r.status, 200);
  assert.equal(r.jsonBody.sent, 2);
  assert.equal(sent[0].type, 'interactive');
  assert.equal(sent[0].interactive.action.buttons.length, 2);
  assert.equal(sent[0].interactive.action.buttons[0].reply.title, 'Send Aadhaar photo');
  assert.equal(sent[1].type, 'document');
  const cand = (await getStore().get('candidates', 'wa-919810000000')).data;
  assert.equal(cand.stage, 'Documents and KYC');
});

test('sending after the 24-hour window explains the problem', async () => {
  setEnv(); sent.length = 0;
  global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Re-engagement message', code: 131047 } }) });
  const r = await handlers.waPush({ user, body: { candidateId: 'wa-919810000000', items: [{ type: 'text', text: 'Reminder' }] } });
  assert.equal(r.status, 409);
  assert.equal(r.jsonBody.error, 'window_closed');
});

test('push needs a registered candidate', async () => {
  setEnv(); mockFetch();
  const r = await handlers.waPush({ user, body: { candidateId: 'wa-910000000000', items: [{ type: 'text', text: 'Hi' }] } });
  assert.equal(r.status, 404);
});
