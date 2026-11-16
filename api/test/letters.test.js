'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const JSZip = require('jszip');

process.env.DEV_MEMORY_STORE = '1';
delete process.env.COSMOS_CONNECTION_STRING;
delete process.env.STORAGE_CONNECTION_STRING;
delete process.env.GRAPH_TENANT_ID;
const merge = require('../src/lib/docx-merge');
const letters = require('../src/lib/letters');
const handlers = require('../src/lib/handlers');
const pdfLock = require('../src/lib/pdf-lock');

const admin = { email: 'boss@tc.com', role: 'admin', clients: ['*'] };
const hr = { email: 'priya@client.com', role: 'hr', clients: ['northpeak'] };
const other = { email: 'ravi@other.com', role: 'hr', clients: ['acme'] };

/* A small HROne-style template: merge fields (some split over runs), a repeating salary table, an empty table,
   a formula, a picture field, a typed «marker», and fields in the footer. */
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const fld = (name, shown = `«${name}»`) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> MERGEFIELD ${name.slice(0, 4)}</w:instrText></w:r><w:r><w:instrText xml:space="preserve">${name.slice(4)} \\* MERGEFORMAT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>${shown}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
const p = inner => `<w:p>${inner}</w:p>`;
const t = s => `<w:r><w:t xml:space="preserve">${s}</w:t></w:r>`;
const row = cells => `<w:tr>${cells.map(c => `<w:tc>${p(c)}</w:tc>`).join('')}</w:tr>`;
const table = (title, name, cols) => `<w:tbl>${row([t(title)])}${row([fld('TableStart:' + name) + fld(cols[0]), ...cols.slice(1, -1).map(c => fld(c)), fld(cols[cols.length - 1]) + fld('TableEnd:' + name)])}</w:tbl>`;
async function template() {
  const body = [
    p(fld('TableStart:Candidate') + t('Date: ') + fld('CURRENT_DATE')),
    p(t('Dear ') + fld('CANDIDATE_NAME') + t(', you join ') + fld('COMPANY') + t(' as ') + fld('DESIGNATION', '«DESIGNATION»') + t('.')),
    p(t('Monthly CTC: ') + '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>=</w:instrText></w:r>' + fld('CTC') + '<w:r><w:instrText>/12 \\# "#,##0"</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>'),
    p(t('I, «CAN') + t('DIDATE_NAME», accept.')),
    table('GROSS', 'Gross', ['GROSS_COMPONENT_NAME', 'GROSS_COMPONENT_NATURE', 'GROSS_COMPONENT_AMOUNT', 'YEARLY_GROSS_COMPONENT_AMOUNT']),
    table('OTHER', 'Other', ['OTHER_COMPONENT_NAME', 'OTHER_COMPONENT_AMOUNT']),
    p(fld('Image:ACTION_USER_SIGNATURE')),
    p(fld('ACTION_SIGNATORY_NAME') + fld('TableEnd:Candidate'))
  ].join('');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  zip.file('word/footer1.xml', `<?xml version="1.0" encoding="UTF-8"?><w:ftr ${W}>${p(t('Regd. Office: ') + fld('COMPANY_ADDRESS'))}</w:ftr>`);
  zip.file('word/settings.xml', `<?xml version="1.0" encoding="UTF-8"?><w:settings ${W}><w:mailMerge><w:mainDocumentType w:val="formLetters"/></w:mailMerge></w:settings>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}
function png(w = 40, h = 10) {
  const crc = b => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const textOf = async buf => {
  const z = await JSZip.loadAsync(buf);
  const doc = await z.file('word/document.xml').async('string');
  return { doc, plain: doc.replace(/<w:instrText[^>]*>[^<]*<\/w:instrText>/g, '').replace(/<[^>]+>/g, ''), zip: z };
};

test('scan finds fields (split over runs and typed), repeating tables, pictures and footer fields', async () => {
  const s = await merge.scan(await template());
  const names = s.fields.map(f => f.name);
  for (const n of ['CURRENT_DATE', 'CANDIDATE_NAME', 'COMPANY', 'DESIGNATION', 'CTC', 'ACTION_SIGNATORY_NAME', 'COMPANY_ADDRESS']) assert.ok(names.includes(n), n);
  assert.ok(!names.some(n => /^Table|COMPONENT/.test(n)), 'markers and table fields are not listed as single fields');
  assert.equal(s.fields.find(f => f.name === 'CANDIDATE_NAME').count, 2, 'one field and one typed «marker»');
  assert.deepEqual(s.fields.find(f => f.name === 'COMPANY_ADDRESS').parts, ['footer']);
  assert.deepEqual(s.regions.map(r => r.name), ['Gross', 'Other']);
  assert.deepEqual(s.regions[0].fields, ['GROSS_COMPONENT_NAME', 'GROSS_COMPONENT_NATURE', 'GROSS_COMPONENT_AMOUNT', 'YEARLY_GROSS_COMPONENT_AMOUNT']);
  assert.deepEqual(s.images, ['ACTION_USER_SIGNATURE']);
});

test('fill: values, repeated rows, empty table removed, formula worked out, typed markers, picture, mail merge switched off', async () => {
  const fields = { CURRENT_DATE: '16 November 2026', CANDIDATE_NAME: 'Ritika <Sharma> & Co', COMPANY: 'Northpeak', DESIGNATION: 'Senior Executive', CTC: '9,59,988', ACTION_SIGNATORY_NAME: 'Asha Rao', COMPANY_ADDRESS: 'Mumbai' };
  const tables = { gross: [{ GROSS_COMPONENT_NAME: 'Basic', GROSS_COMPONENT_NATURE: 'Fixed', GROSS_COMPONENT_AMOUNT: '39,060', YEARLY_GROSS_COMPONENT_AMOUNT: '4,68,720' }, { GROSS_COMPONENT_NAME: 'HRA', GROSS_COMPONENT_NATURE: 'Fixed', GROSS_COMPONENT_AMOUNT: '19,530', YEARLY_GROSS_COMPONENT_AMOUNT: '2,34,360' }] };
  const r = await merge.fill(await template(), { fields, tables, images: { ACTION_USER_SIGNATURE: { data: png() } } });
  assert.deepEqual(r.missing, []);
  const { doc, plain, zip } = await textOf(r.buffer);
  assert.ok(plain.includes('Dear Ritika &lt;Sharma&gt; &amp; Co, you join Northpeak as Senior Executive.'), 'values are escaped and keep the text around them');
  assert.ok(plain.includes('Monthly CTC: 79,999'), 'formula =CTC/12 with #,##0');
  assert.ok(plain.includes('I, Ritika &lt;Sharma&gt; &amp; Co, accept.'), 'typed «marker» split over two runs');
  assert.ok(plain.includes('Basic') && plain.includes('HRA') && plain.includes('2,34,360'));
  assert.ok(!plain.includes('OTHER'), 'a table with no rows is removed');
  assert.ok(!/MERGEFIELD|«|TableStart/.test(doc), 'no fields or markers left');
  assert.ok(/<w:b\/><\/w:rPr><w:t xml:space="preserve">Northpeak/.test(doc), 'the value keeps the field\'s formatting');
  assert.ok(doc.includes('<w:drawing>') && Object.keys(zip.files).some(n => /^word\/media\/.*\.png$/.test(n)), 'signature picture added');
  assert.ok((await zip.file('word/_rels/document.xml.rels').async('string')).includes('relationships/image'));
  assert.ok((await zip.file('[Content_Types].xml').async('string')).includes('Extension="png"'));
  assert.ok(!(await zip.file('word/settings.xml').async('string')).includes('mailMerge'));
  assert.ok((await zip.file('word/footer1.xml').async('string')).includes('Mumbai'));
});

test('fill preview: blanks highlighted and listed, signature shown as a note', async () => {
  const r = await merge.fill(await template(), { fields: { COMPANY: 'Northpeak' }, preview: true, imageNotes: { ACTION_USER_SIGNATURE: 'signature added on approval' } });
  const { doc } = await textOf(r.buffer);
  assert.ok(r.missing.includes('CANDIDATE_NAME') && r.missing.includes('CTC'));
  assert.ok(doc.includes('<w:highlight w:val="yellow"/>') && doc.includes('«CANDIDATE_NAME»'));
  assert.ok(doc.includes('[signature added on approval]'));
});

test('letters API: admin uploads and sets up; HR previews; final letter needs every value and a signatory', async () => {
  const docx = (await template()).toString('base64');
  let r = await letters.handle('upload', { name: 'Northpeak offer', client: 'northpeak', fileName: 'offer.docx', base64: docx }, hr);
  assert.equal(r.status, 403, 'HR cannot upload templates');
  r = await letters.handle('upload', { name: 'Northpeak offer', client: 'northpeak', fileName: 'offer.docx', base64: Buffer.from('not a word file at all, just some text here to be long enough').toString('base64') }, admin);
  assert.equal(r.status, 400);
  r = await letters.handle('upload', { name: 'Northpeak offer', client: 'northpeak', fileName: 'offer.docx', base64: docx }, admin);
  assert.equal(r.status, 200);
  const id = r.body.id;
  assert.equal(r.body.v, 1);
  r = await letters.handle('save', { id, map: { CANDIDATE_NAME: { src: 'cand.name' }, BAD: { src: 'x; drop' } }, images: { ACTION_USER_SIGNATURE: { src: 'signature' } } }, admin);
  assert.equal(r.status, 200);

  // Other clients' HR cannot see it; this client's HR can.
  let list = await handlers.data({ method: 'GET', col: 'lettertpl', user: other });
  assert.equal(list.jsonBody.items.length, 0);
  list = await handlers.data({ method: 'GET', col: 'lettertpl', user: hr });
  assert.equal(list.jsonBody.items.length, 1);
  assert.deepEqual(Object.keys(list.jsonBody.items[0].data.map), ['CANDIDATE_NAME'], 'unsafe sources dropped');
  r = await handlers.data({ method: 'PUT', col: 'lettertpl', id, body: { name: 'x' }, user: admin });
  assert.equal(r.status, 403, 'templates change only through /api/letters');
  r = await handlers.data({ method: 'GET', col: 'letterfiles', user: admin });
  assert.equal(r.status, 403, 'stored files are never listed');
  assert.equal((await letters.handle('render', { id, fields: {} }, other)).status, 404);

  const fields = { CURRENT_DATE: '16 November 2026', CANDIDATE_NAME: 'Ritika Sharma', COMPANY: 'Northpeak', DESIGNATION: 'Executive', CTC: '960000', ACTION_SIGNATORY_NAME: 'Asha Rao', COMPANY_ADDRESS: 'Mumbai' };
  r = await letters.handle('render', { id, client: 'northpeak', fields: { COMPANY: 'Northpeak' } }, hr);
  assert.equal(r.status, 200);
  assert.ok(r.body.missing.includes('CANDIDATE_NAME'));
  assert.ok(!(await textOf(Buffer.from(r.body.docxBase64, 'base64'))).doc.includes('<w:drawing>'), 'no signature in previews');

  r = await letters.handle('render', { id, client: 'northpeak', final: true, fields: { COMPANY: 'Northpeak' } }, hr);
  assert.equal(r.status, 409);
  r = await letters.handle('render', { id, client: 'northpeak', final: true, fields }, hr);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'signatory_required');

  r = await letters.handle('signatory-save', { client: 'northpeak', name: 'Asha Rao', designation: 'HR Head', base64: png().toString('base64') }, hr);
  assert.equal(r.status, 403, 'HR cannot add signatures');
  r = await letters.handle('signatory-save', { client: 'northpeak', name: 'Asha Rao', designation: 'HR Head', base64: png().toString('base64') }, admin);
  assert.equal(r.status, 200);
  const sid = r.body.id;
  r = await letters.handle('render', { id, client: 'northpeak', final: true, fields, signatoryId: sid, fileName: 'Offer_Letter_Ritika', candidate: { name: 'Ritika Sharma', mobile: '919810000000' } }, hr);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.pdf, false, 'without Microsoft 365 the Word file goes');
  assert.equal(r.body.fileName, 'Offer_Letter_Ritika.docx');
  assert.match(r.body.note, /Microsoft 365/);
  assert.ok((await textOf(Buffer.from(r.body.base64, 'base64'))).doc.includes('<w:drawing>'), 'approved letter is signed');
  const log = await handlers.data({ method: 'GET', col: 'letterlog', user: admin });
  assert.equal(log.jsonBody.items.length, 1);
  assert.equal(log.jsonBody.items[0].data.by, 'priya@client.com');
  assert.equal(log.jsonBody.items[0].data.mobile, '••••••••0000');
  assert.equal((await handlers.data({ method: 'GET', col: 'letterlog', user: hr })).status, 403);

  // A new version keeps the set-up.
  r = await letters.handle('upload', { id, fileName: 'offer-v2.docx', base64: docx }, admin);
  assert.equal(r.body.v, 2);
  r = await letters.handle('file', { id }, hr);
  assert.equal(r.body.fileName, 'offer-v2.docx');
  list = await handlers.data({ method: 'GET', col: 'lettertpl', id, user: admin });
  assert.equal(list.jsonBody.data.versions.length, 2);
  assert.ok(list.jsonBody.data.map.CANDIDATE_NAME);
});

test('PDF password protection: AES-128, opens only with the password', async () => {
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const d = await PDFDocument.create();
  const page = d.addPage([300, 200]);
  page.drawText('Offer letter for Ritika', { x: 20, y: 100, size: 14, font: await d.embedFont(StandardFonts.Helvetica) });
  d.setTitle('Offer letter');
  const plain = Buffer.from(await d.save());
  const locked = await pdfLock.lock(plain, '12012026');
  const s = locked.toString('latin1');
  assert.match(s, /\/Encrypt \d+ 0 R/);
  assert.match(s, /\/CFM \/AESV2/);
  assert.ok(!s.includes('Offer letter'), 'title no longer readable');
  await assert.rejects(PDFDocument.load(locked), /encrypt/i, 'readers need the password');
  assert.equal((await pdfLock.lock(plain, '')).length, plain.length, 'no password: unchanged');
});

test('named journeys: shared, so only admins and all-client HR change them', async () => {
  const body = { name: 'Nurses', steps: { offer: { when: 'O+0', ch: 'wa' } }, custom: [], docs: ['aadhaar'] };
  let r = await handlers.data({ method: 'PUT', col: 'flows', id: 'fl-nurses01', body, user: hr });
  assert.equal(r.status, 403);
  r = await handlers.data({ method: 'PUT', col: 'flows', id: 'fl-nurses01', body, user: admin });
  assert.equal(r.status, 200);
  r = await handlers.data({ method: 'GET', col: 'flows', user: hr });
  assert.equal(r.jsonBody.items.length, 1, 'every signed-in user can read them');
  r = await handlers.data({ method: 'PUT', col: 'flows', id: 'fl-nurses01', body, user: { email: 'all@tc.com', role: 'hr', clients: ['*'] } });
  assert.equal(r.status, 200);
});
