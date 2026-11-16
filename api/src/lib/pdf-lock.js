'use strict';
// Password-protects a finished PDF (the offer letter Microsoft 365 made from the Word template).
// Standard security handler, revision 4, AES-128 (AESV2): opens in every PDF reader and asks for the password.
// The owner password is random and never stored; the open password is what the candidate is told
// (their date of birth as DDMMYYYY).

const crypto = require('crypto');
const { PDFDocument, PDFName, PDFNumber, PDFString, PDFHexString, PDFDict, PDFArray, PDFRawStream, PDFBool } = require('pdf-lib');

const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
const md5 = (...b) => crypto.createHash('md5').update(Buffer.concat(b)).digest();
const padPwd = p => { const b = Buffer.from(String(p || ''), 'latin1').subarray(0, 32); return Buffer.concat([b, PAD.subarray(0, 32 - b.length)]); };

// RC4 is only used to build the O and U keys (as the PDF standard requires); content is AES.
function rc4(key, data) {
  const s = [...Array(256).keys()];
  for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}
const xorKey = (key, i) => Buffer.from(key.map(b => b ^ i));

function keys(userPwd, ownerPwd, P, id0) {
  // Algorithm 3: O
  let h = md5(padPwd(ownerPwd));
  for (let i = 0; i < 50; i++) h = md5(h);
  const okey = h.subarray(0, 16);
  let O = rc4(okey, padPwd(userPwd));
  for (let i = 1; i <= 19; i++) O = rc4(xorKey(okey, i), O);
  // Algorithm 2: file key
  const p = Buffer.alloc(4); p.writeInt32LE(P);
  let k = md5(padPwd(userPwd), O, p, id0);
  for (let i = 0; i < 50; i++) k = md5(k.subarray(0, 16));
  const key = k.subarray(0, 16);
  // Algorithm 5: U
  let U = rc4(key, md5(PAD, id0));
  for (let i = 1; i <= 19; i++) U = rc4(xorKey(key, i), U);
  U = Buffer.concat([U, Buffer.alloc(16)]);
  return { O, U, key };
}

function objKey(key, num, gen) {
  const b = Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255]);
  return md5(key, b, Buffer.from('sAlT', 'latin1')).subarray(0, 16);
}
function aes(k, data) {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-128-cbc', k, iv);
  return Buffer.concat([iv, c.update(Buffer.from(data)), c.final()]);
}

function encryptValue(v, k) {
  if (v instanceof PDFString || v instanceof PDFHexString) return PDFHexString.of(aes(k, v.asBytes()).toString('hex'));
  if (v instanceof PDFArray) { for (let i = 0; i < v.size(); i++) v.set(i, encryptValue(v.get(i), k)); return v; }
  if (v instanceof PDFDict) { for (const [n, x] of v.entries()) v.set(n, encryptValue(x, k)); return v; }
  return v;
}

async function lock(pdf, password) {
  if (!password) return Buffer.from(pdf);
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const ctx = doc.context;
  if (ctx.trailerInfo.Encrypt) throw new Error('already_encrypted');
  const id0 = crypto.randomBytes(16);
  const P = -3904 | 4 | 16 | 2048 | 512 | 256; // print, copy, accessibility, high-quality print; no editing
  const { O, U, key } = keys(password, crypto.randomBytes(24).toString('base64'), P, id0);
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const k = objKey(key, ref.objectNumber, ref.generationNumber);
    if (obj instanceof PDFRawStream) {
      const type = obj.dict.get(PDFName.of('Type'));
      if (type === PDFName.of('XRef')) continue;
      encryptValue(obj.dict, k);
      obj.contents = aes(k, obj.contents);
      obj.dict.set(PDFName.of('Length'), PDFNumber.of(obj.contents.length));
    } else encryptValue(obj, k);
  }
  const enc = ctx.obj({
    Filter: 'Standard', V: 4, R: 4, Length: 128, P,
    CF: { StdCF: { CFM: 'AESV2', AuthEvent: 'DocOpen', Length: 16 } }, StmF: 'StdCF', StrF: 'StdCF',
    O: PDFHexString.of(O.toString('hex')), U: PDFHexString.of(U.toString('hex')), EncryptMetadata: PDFBool.True
  });
  ctx.trailerInfo.Encrypt = ctx.register(enc);
  const hex = PDFHexString.of(id0.toString('hex'));
  ctx.trailerInfo.ID = ctx.obj([hex, hex]);
  return Buffer.from(await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false }));
}

module.exports = { lock };
