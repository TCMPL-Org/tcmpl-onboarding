'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEV_MEMORY_STORE = '1';
delete process.env.COSMOS_CONNECTION_STRING;
const ocr = require('../src/lib/ocr');
const documents = require('../src/lib/documents');
const { getStore } = require('../src/lib/store');
const { Jimp } = require('jimp');

// A checksum-valid test Aadhaar number (not a real person's).
const base11 = '23456789012';
const AADHAAR = base11 + ocr.verhoeffDigit(base11);
const spaced = `${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)}`;

function word(content, x, y, w = 80, h = 24, confidence = 0.97) {
  return { content, confidence, polygon: [x, y, x + w, y, x + w, y + h, x, y + h] };
}
function aadhaarResult() {
  return {
    modelId: 'prebuilt-idDocument',
    content: `Government of India\nJeet Pawar\nDOB: 12/03/1995\nMALE\n${spaced}\nमेरा आधार, मेरी पहचान`,
    pages: [{
      pageNumber: 1, width: 600, height: 400, unit: 'pixel',
      lines: [{ content: 'Government of India' }, { content: 'Jeet Pawar' }, { content: 'DOB: 12/03/1995' }, { content: 'MALE' }, { content: spaced }],
      words: [word('Jeet', 200, 100), word('Pawar', 290, 100), word(AADHAAR.slice(0, 4), 150, 300), word(AADHAAR.slice(4, 8), 240, 300), word(AADHAAR.slice(8), 330, 300)],
      barcodes: [{ kind: 'QRCode', polygon: [480, 120, 580, 120, 580, 220, 480, 220] }]
    }],
    documents: [{ fields: { FirstName: { valueString: 'JEET', confidence: 0.95 }, LastName: { valueString: 'PAWAR', confidence: 0.95 }, DateOfBirth: { valueDate: '1995-03-12', confidence: 0.96 }, Sex: { valueString: 'M', confidence: 0.9 } } }]
  };
}
function panResult(pan = 'ABCPP1234Q', name = 'JEET PAWAR') {
  return {
    content: `INCOME TAX DEPARTMENT\nGOVT. OF INDIA\nPermanent Account Number Card\n${pan}\nName\n${name}\nFather's Name\nRAMESH PAWAR\nDate of Birth\n12/03/1995`,
    pages: [{ width: 600, height: 400, unit: 'pixel', lines: ['INCOME TAX DEPARTMENT', 'Permanent Account Number Card', pan, 'Name', name, "Father's Name", 'RAMESH PAWAR', 'Date of Birth', '12/03/1995'].map(content => ({ content })), words: [word(pan, 100, 100)] }]
  };
}
function bankResult() {
  return {
    content: 'HDFC BANK LTD\nIFSC: HDFC0001234\nA/C No. 50100123456789\nJEET PAWAR\nPay',
    pages: [{ width: 800, height: 350, unit: 'pixel', lines: ['HDFC BANK LTD', 'IFSC: HDFC0001234', 'A/C No. 50100123456789', 'Name: JEET PAWAR', 'Pay'].map(content => ({ content })), words: [word('HDFC0001234', 10, 10), word('50100123456789', 10, 40)] }]
  };
}

test('validators', () => {
  assert.ok(ocr.validAadhaar(AADHAAR));
  assert.ok(!ocr.validAadhaar(AADHAAR.slice(0, 11) + ((+AADHAAR[11] + 1) % 10)));
  assert.ok(!ocr.validAadhaar('1' + AADHAAR.slice(1)));
  assert.ok(ocr.isPersonPan('ABCPP1234Q'));
  assert.ok(!ocr.isPersonPan('ABCCP1234Q'));
  assert.ok(ocr.validIfsc('HDFC0001234') && !ocr.validIfsc('HDFC1001234'));
  assert.equal(ocr.toIsoDate('DOB: 12/03/1995'), '1995-03-12');
  assert.equal(ocr.toIsoDate('12 Mar 1995'), '1995-03-12');
  assert.equal(ocr.namesMatch('JEET PAWAR', 'Jeet R Pawar'), true);
  assert.equal(ocr.namesMatch('Jeet Pawar', 'Amit Shah'), false);
});

test('classify and extract Aadhaar, PAN, bank', () => {
  assert.equal(ocr.classify(aadhaarResult()), 'aadhaar');
  assert.equal(ocr.classify(panResult()), 'pan');
  assert.equal(ocr.classify(bankResult()), 'bank');
  assert.equal(ocr.classify({ content: 'Hello world' }), 'other');
  const a = ocr.extract('aadhaar', aadhaarResult());
  assert.deepEqual([a.fields.name, a.fields.dob, a.fields.gender, a.fields.aadhaarLast4], ['Jeet Pawar', '1995-03-12', 'Male', AADHAAR.slice(-4)]);
  assert.ok(a.checks.every(c => c.ok));
  assert.ok(!JSON.stringify(a.fields).includes(AADHAAR.slice(0, 8)), 'fields never hold the full number');
  const p = ocr.extract('pan', panResult());
  assert.deepEqual([p.fields.pan, p.fields.name, p.fields.father, p.fields.dob], ['ABCPP1234Q', 'Jeet Pawar', 'Ramesh Pawar', '1995-03-12']);
  const b = ocr.extract('bank', bankResult());
  assert.deepEqual([b.fields.ifsc, b.secret.account, b.fields.accountLast4, b.fields.holder], ['HDFC0001234', '50100123456789', '6789', 'Jeet Pawar']);
  assert.equal(ocr.crossChecks('pan', p.fields, { name: 'Jeet Pawar', dob: '1995-03-12' }).every(c => c.ok), true);
  assert.equal(ocr.crossChecks('pan', ocr.extract('pan', panResult('ABCPP1234Q', 'AMIT SHAH')).fields, { name: 'Jeet Pawar' })[0].ok, false);
});

test('mask regions cover the first 8 digits and the QR code only', () => {
  const r = ocr.maskRegions(aadhaarResult(), AADHAAR);
  assert.equal(r.filter(x => x.kind === 'digits').length, 2);
  assert.equal(r.filter(x => x.kind === 'qr').length, 1);
});

test('masking blacks out the regions in the photo', async () => {
  const { maskImage } = require('../src/lib/mask');
  const img = new Jimp({ width: 600, height: 400, color: 0xffffffff });
  const out = await maskImage(await img.getBuffer('image/png'), ocr.maskRegions(aadhaarResult(), AADHAAR));
  const m = await Jimp.read(out.buffer);
  const dark = (x, y) => (m.getPixelColor(x, y) >>> 24) < 40;
  assert.ok(dark(190, 312), 'first group masked');
  assert.ok(dark(280, 312), 'second group masked');
  assert.ok(!dark(370, 312), 'last 4 digits stay visible');
  assert.ok(dark(530, 170), 'QR masked');
  await assert.rejects(maskImage(await img.getBuffer('image/png'), [{ polygon: [0, 0, 10, 0, 10, 10, 0, 10], width: 400, height: 600, unit: 'pixel' }]), e => e.code === 'masking_unsafe');
});

test('WhatsApp flow: consent, Aadhaar, confirm, PAN, fix, bank, review', async () => {
  const store = getStore();
  const sent = [], saved = [];
  const photo = await new Jimp({ width: 600, height: 400, color: 0xffffffff }).getBuffer('image/jpeg');
  const results = { a1: aadhaarResult(), p1: panResult(), b1: bankResult(), x1: { content: 'random selfie' } };
  const d = documents._deps;
  Object.assign(d.wa, {
    downloadMedia: async id => ({ buffer: photo, mime: 'image/jpeg', id }),
    sendText: async (to, text) => { sent.push(text); return { id: 'w' }; },
    sendButtons: async (to, text, b) => { sent.push(text + ' [' + b.join('|') + ']'); return { id: 'w' }; }
  });
  let nextResult = null;
  d.docintel.analyzeWithFallback = async () => results[nextResult];
  d.blob.putFile = async (path, buf, type) => { saved.push({ path, type, size: buf.length }); return path; };

  const id = 'wa-917000000001';
  const cand = { phone: '917000000001', name: 'Jeet Pawar', company: 'TCMPL' };
  await store.put('candidates', id, cand, { name: 'test' });
  const img = (mid) => ({ type: 'image', media: { id: mid, mime: 'image/jpeg' } });

  // A photo before consent is held and consent is asked.
  let r = await documents.onInbound(store, id, cand, img('a1'));
  assert.ok(r.handled && /I agree/.test(r.replies[0].buttons.join()));
  assert.equal(saved.length, 0, 'nothing read or stored before consent');

  // Consent → the held Aadhaar is read and masked.
  nextResult = 'a1';
  r = await documents.onInbound(store, id, cand, { type: 'button', text: 'I agree' });
  assert.ok(cand.docs.consentAt);
  assert.match(r.replies[1].text, /Name: Jeet Pawar/);
  assert.match(r.replies[1].text, new RegExp('ending ' + AADHAAR.slice(-4)));
  assert.equal(saved.length, 1);
  assert.match(saved[0].path, /^wa-917000000001\/aadhaar-\d+\.jpg$/);
  const arec = await store.get('documents', id + '.aadhaar');
  assert.ok(!JSON.stringify(arec.data).includes(AADHAAR), 'full Aadhaar never stored');

  r = await documents.onInbound(store, id, cand, { type: 'interactive', text: 'Yes, correct' });
  assert.equal(cand.docs.items.aadhaar.status, 'confirmed');
  assert.equal(cand.kyc.name, 'Jeet Pawar');
  assert.match(r.replies[1].text, /PAN card/);

  // Wrong document → asked again, nothing stored.
  nextResult = 'x1';
  r = await documents.onInbound(store, id, cand, img('x1'));
  assert.match(r.replies[0].text, /doesn't look like your PAN card/);
  assert.equal(saved.length, 1);

  // PAN → Fix → correction goes to HR review.
  nextResult = 'p1';
  r = await documents.onInbound(store, id, cand, img('p1'));
  assert.match(r.replies[0].text, /PAN: ABCPP1234Q/);
  await documents.onInbound(store, id, cand, { type: 'interactive', text: 'Fix something' });
  r = await documents.onInbound(store, id, cand, { type: 'text', text: "Father's name is Ramesh K Pawar" });
  assert.equal(cand.docs.items.pan.status, 'needs_review');
  assert.equal((await store.get('documents', id + '.pan')).data.candidateCorrection, "Father's name is Ramesh K Pawar");
  assert.match(r.replies[1].text, /cancelled cheque/);

  // Bank → confirm → done.
  nextResult = 'b1';
  await documents.onInbound(store, id, cand, img('b1'));
  r = await documents.onInbound(store, id, cand, { type: 'interactive', text: 'Yes, correct' });
  assert.equal(cand.docs.items.bank.status, 'confirmed');
  assert.equal(cand.kyc.bank.ifsc, 'HDFC0001234');
  assert.match(r.replies[1].text, /That's everything/);
  assert.equal(cand.stage, 'Documents submitted');

  // Ordinary questions still go to the agent.
  assert.equal((await documents.onInbound(store, id, cand, { type: 'text', text: 'What time do I report?' })).handled, false);

  // HR corrects and approves the PAN; the data API never shows the full account number.
  await store.put('candidates', id, cand, { name: 'test' });
  const rv = await documents.review(store, { candidateId: id, type: 'pan', action: 'approve', fields: { father: 'Ramesh K Pawar' } }, { name: 'hr@x' });
  assert.equal(rv.body.status, 'confirmed');
  assert.equal((await store.get('candidates', id)).data.kyc.father, 'Ramesh K Pawar');
  const handlers = require('../src/lib/handlers');
  const list = await handlers.data({ method: 'GET', col: 'documents', user: { name: 'hr@x' } });
  assert.ok(!JSON.stringify(list.jsonBody).includes('50100123456789'));
  assert.equal((await handlers.data({ method: 'PUT', col: 'documents', id: 'x', body: {}, user: { name: 'hr@x' } })).status, 403);
});

test('Aadhaar PDF is refused with a clear message', async () => {
  const store = getStore();
  const cand = { phone: '917000000002', docs: { consentAt: '2026-11-04T00:00:00Z', awaiting: 'aadhaar', items: {} } };
  const r = await documents.onInbound(store, 'wa-917000000002', cand, { type: 'document', media: { id: 'p', mime: 'application/pdf', filename: 'eaadhaar.pdf' } });
  assert.match(r.replies[0].text, /photo or screenshot/);
});
