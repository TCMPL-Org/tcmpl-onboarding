'use strict';
// The agent reads the candidate's own offer letter when they ask about their offer.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.DEV_MEMORY_STORE = '1';
delete process.env.COSMOS_CONNECTION_STRING;
const agent = require('../src/lib/agent');
const handlers = require('../src/lib/handlers');
const { getStore } = require('../src/lib/store');

const LETTER = `Offer cum Appointment Letter
6. Termination
6.1 During the probation period, either party is free to terminate this employment by giving notice for a period of one month's.
7.8 Non-Compete: During the employment period, you will not work for any company in competition with the Company.
Annexure 1
GROSS BENEFITS
COMPONENT NAME | NATURE OF COMPONENT | MONTHLY REMUNERATION | YEARLY REMUNERATION
Basic | Fixed | 39,060 | 4,68,720
HRA | Fixed | 19,530 | 2,34,360
CONTRIBUTION
Employer PF | 1,800 | 21,600
CTC | Total | 79999.00 | 9,59,988`;
const OTHER_LETTER = 'Annexure 1\nBasic | Fixed | 88,888 | 10,66,656';

const realFetch = global.fetch;
let prompts = [], answers = [];
function aiEnv() { Object.assign(process.env, { AZURE_OPENAI_ENDPOINT: 'https://x.openai.azure.com', AZURE_OPENAI_API_KEY: 'k', AZURE_OPENAI_DEPLOYMENT: 'chat' }); }
function stubAI() {
  prompts = [];
  global.fetch = async (url, opts) => {
    const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : {};
    if (String(url).includes('openai.azure.com')) {
      prompts.push(body.messages[1].content);
      const a = answers.shift() || { reply: 'ok', handover: false };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(a) } }] }) };
    }
    if (String(url).includes('/media')) return { ok: true, status: 200, json: async () => ({ id: 'media-1' }) };
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.' + Math.random() }] }) };
  };
}
test.after(() => { global.fetch = realFetch; });

const cand = { name: 'Ritika Sharma', company: 'Northpeak', facts: 'reportTime: 9:30 am\noffer: role Senior Executive; joining 1 Dec 2026; CTC ₹9,59,988', faq: 'PF nomination: Form 2 names who gets your PF.' };

test('offer questions are recognised in English, Hindi and Hinglish', () => {
  for (const q of ['What is my basic salary?', 'why is take home less than CTC', 'what is the notice period?', 'Explain clause 7.8', 'meri salary kitni hai', 'PF kitna katega?', 'annexure 1 samjhao', 'is ESIC deducted', 'can I be transferred?'])
    assert.ok(agent.isOfferQuestion(q), q);
  for (const q of ['hi', 'what time should I reach?', 'I have uploaded my PAN', 'where is the office'])
    assert.ok(!agent.isOfferQuestion(q), q);
});

test('an offer question is answered from the candidate\'s own letter, quoting it', async () => {
  aiEnv(); stubAI();
  answers = [{ reply: 'As per Annexure 1, your Basic is ₹39,060 a month (₹4,68,720 a year).', handover: false }];
  const out = await agent.reply(cand, [], 'What is my basic salary?', { letter: LETTER });
  assert.equal(out.source, 'ai-letter');
  assert.match(out.reply, /39,060/);
  assert.equal(prompts.length, 1);
  assert.ok(prompts[0].includes('Basic | Fixed | 39,060 | 4,68,720'), 'the full letter is in the prompt');
  assert.ok(prompts[0].includes('Today is '), 'the agent knows today\'s date');
  assert.match(prompts[0], /Only discuss this candidate's own offer/);
});

test('other questions do not open the letter', async () => {
  aiEnv(); stubAI();
  answers = [{ reply: 'Please reach by 9:30 am.', handover: false, needLetter: false }];
  const out = await agent.reply(cand, [], 'what time should I reach?', { letter: LETTER });
  assert.equal(out.source, 'ai');
  assert.ok(!prompts[0].includes('39,060'));
});

test('when the AI says the answer is in the letter, it reads it and answers again', async () => {
  aiEnv(); stubAI();
  answers = [{ reply: '', handover: false, needLetter: true }, { reply: 'Clause 7.8 says you will not work for a competitor while employed.', handover: false }];
  const out = await agent.reply(cand, [], 'Am I allowed to freelance for others while I work there', { letter: LETTER });
  assert.equal(prompts.length, 2);
  assert.ok(!prompts[0].includes('Non-Compete') && prompts[1].includes('Non-Compete'));
  assert.equal(out.source, 'ai-letter');
  assert.match(out.reply, /7\.8/);
});

test('an amount that is not in the letter is never sent: the question goes to HR', async () => {
  aiEnv(); stubAI();
  answers = [{ reply: 'Your take-home will be about ₹71,240 a month.', handover: false }];
  const out = await agent.reply(cand, [], 'What will my in hand salary be?', { letter: LETTER });
  assert.equal(out.handover, true);
  assert.doesNotMatch(out.reply, /71,240/);
  assert.match(out.handoverReason, /71240/);
  // Amounts written in the letter pass, however they are written (79999.00 -> 79,999).
  answers = [{ reply: 'Your monthly CTC is ₹79,999 and yearly ₹9,59,988.', handover: false }];
  const ok = await agent.reply(cand, [], 'what is my monthly ctc', { letter: LETTER });
  assert.equal(ok.handover, false);
});

test('no letter on file: offer questions go to HR as before', async () => {
  aiEnv(); stubAI();
  answers = [{ reply: '', handover: false, needLetter: true }];
  const out = await agent.reply(cand, [], 'What is my HRA?', { letter: '' });
  assert.equal(prompts.length, 1, 'nothing more to read');
  assert.equal(out.source, 'scripted', 'an empty AI reply falls back to the scripted answer');
  assert.equal(out.handover, true);
});

test('WhatsApp: each candidate\'s own letter text is kept at release and only theirs is read', async () => {
  Object.assign(process.env, { WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '123', WHATSAPP_APP_SECRET: 'secret', WHATSAPP_VERIFY_TOKEN: 'v' });
  aiEnv(); stubAI();
  const user = { id: 'u1', name: 'hr@example.com' };
  const pdf = Buffer.from('%PDF-1.4 fake offer letter content '.repeat(10)).toString('base64');
  for (const [mobile, name, text] of [['+91 98100 00001', 'Ritika Sharma', LETTER], ['+91 98100 00002', 'Arjun Rao', OTHER_LETTER]]) {
    const r = await handlers.waStart({ user, body: { name, mobile, role: 'Executive', client: 'northpeak', company: 'Northpeak', facts: 'x: y', profile: { name, client: 'northpeak' }, letterPdfBase64: pdf, letterFile: 'Offer.pdf', letterText: text } });
    assert.equal(r.status, 200);
  }
  const store = getStore();
  assert.match((await store.get('letters', 'wa-919810000001')).data.text, /39,060/);
  const listed = await handlers.data({ method: 'GET', col: 'letters', user: { email: 'a@b.c', role: 'admin', clients: ['*'] } });
  assert.equal(listed.status, 403, 'letters are never listed through the data API');

  prompts = [];
  answers = [{ reply: 'As per Annexure 1, your Basic is ₹39,060 a month.', handover: false }];
  const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { contacts: [{ wa_id: '919810000001', profile: { name: 'Ritika' } }], messages: [{ from: '919810000001', id: 'wamid.L1', timestamp: '1', type: 'text', text: { body: 'what is my basic salary?' } }] } }] }] });
  const sig = 'sha256=' + crypto.createHmac('sha256', 'secret').update(raw).digest('hex');
  assert.equal((await handlers.waWebhook(raw, sig)).status, 200);
  const p = prompts.find(x => x.includes('OFFER LETTER'));
  assert.ok(p, 'the letter was read');
  assert.ok(p.includes('39,060') && !p.includes('88,888'), 'only Ritika\'s own letter');
  const msgs = (await store.list('messages')).map(m => m.data).filter(m => m.candidateId === 'wa-919810000001' && m.direction === 'out');
  assert.ok(msgs.some(m => m.source === 'ai-letter' && /39,060/.test(m.text)));
});
