'use strict';
// Word (.docx) mail-merge templates, as made for HROne and other HR tools.
//
// A template uses Word merge fields (Insert > Quick Parts > Field > MergeField), shown in Word as «NAME».
//   «NAME»                     one value
//   «TableStart:X» … «TableEnd:X» around table rows: the rows repeat once per record of table X
//                              (salary components); around anything else they are just markers
//   «Image:NAME»               a picture (the signatory's signature)
//
// scan(buffer)  -> what the template needs: fields, repeating tables and their fields, pictures
// fill(buffer, { fields, tables, images, preview }) -> { buffer, missing }
//   fields  { NAME: 'text' }              values; a name not given is "missing"
//   tables  { X: [ { NAME: 'text' } ] }   rows for each repeating table; a table with no rows is removed
//   images  { NAME: { data: Buffer } }    PNG or JPEG
//   images  { NAME: null }                leave the picture out
//   preview true: missing values show as a yellow «NAME», pictures not given show [imageNotes[NAME] or picture: NAME]
// Everything else in the file (fonts, layout, headers, numbering) stays exactly as it was.

const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types'
};
const IMG_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const PART_RE = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;
const MAX_ENTRIES = 400, MAX_UNZIPPED = 40 * 1024 * 1024;

const parse = s => new DOMParser({ onError: () => {} }).parseFromString(s, 'text/xml');
const serialize = d => new XMLSerializer().serializeToString(d);
const isW = (n, local) => n && n.nodeType === 1 && n.namespaceURI === NS.w && n.localName === local;
const childrenW = (n, local) => { const out = []; for (let c = n.firstChild; c; c = c.nextSibling) if (isW(c, local)) out.push(c); return out; };
const textOf = n => { let s = ''; for (let c = n.firstChild; c; c = c.nextSibling) s += c.nodeType === 3 ? c.data : ''; return s; };

async function open(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 100 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw bad('not_a_docx');
  let zip;
  try { zip = await JSZip.loadAsync(buffer); } catch { throw bad('not_a_docx'); }
  const names = Object.keys(zip.files);
  if (names.length > MAX_ENTRIES) throw bad('docx_too_complex');
  let total = 0;
  for (const n of names) { const f = zip.files[n]; total += (f._data && f._data.uncompressedSize) || 0; }
  if (total > MAX_UNZIPPED) throw bad('docx_too_large');
  if (!zip.file('word/document.xml')) throw bad('not_a_docx');
  return zip;
}
function bad(code) { const e = new Error(code); e.code = code; return e; }

/* ---------- fields ---------- */
// MERGEFIELD instruction -> { name, fmt } ; anything else -> null
function mergeName(instr) {
  const m = /^\s*MERGEFIELD\s+(?:"([^"]+)"|(\S+))(.*)$/i.exec(String(instr || ''));
  if (!m) return null;
  const name = (m[1] || m[2] || '').trim();
  const fmt = (/\\\*\s*(Upper|Lower|Caps|FirstCap)\b/i.exec(m[3] || '') || [])[1] || '';
  return name ? { name, fmt: fmt.toLowerCase() } : null;
}

// Every field in a subtree, in document order: complex fields (fldChar begin/separate/end) and simple ones.
// Each: { instr, runs: [run elements, begin..end], result: [runs showing the value], depth, simple?: node }
function collect(root) {
  const out = [], stack = [];
  const addRun = (run, toResult) => {
    for (const f of stack) if (f.runs[f.runs.length - 1] !== run) f.runs.push(run);
    const top = stack[stack.length - 1];
    if (toResult && top && top.state === 'result' && top.result[top.result.length - 1] !== run) top.result.push(run);
  };
  const visit = node => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      if (isW(c, 'fldSimple')) {
        out.push({ instr: c.getAttributeNS(NS.w, 'instr') || c.getAttribute('w:instr') || '', runs: [c], result: childrenW(c, 'r'), depth: stack.length, simple: c });
        continue;
      }
      if (isW(c, 'r')) {
        let plain = false;
        for (let k = c.firstChild; k; k = k.nextSibling) {
          if (k.nodeType !== 1) continue;
          if (isW(k, 'fldChar')) {
            const t = k.getAttributeNS(NS.w, 'fldCharType') || k.getAttribute('w:fldCharType');
            if (t === 'begin') {
              const parent = stack[stack.length - 1] || null;
              const f = { instr: '', runs: [], result: [], depth: stack.length, state: 'instr', nested: [], parent, inInstr: Boolean(parent && parent.state === 'instr') };
              stack.push(f); addRun(c);
            } else if (t === 'separate') { addRun(c); if (stack.length) stack[stack.length - 1].state = 'result'; }
            else if (t === 'end') {
              addRun(c); const f = stack.pop();
              if (f) { out.push(f); if (f.parent && f.inInstr) { f.parent.nested.push(f); f.parent.instr += `\uE000${f.parent.nested.length - 1}\uE000`; } }
            }
          } else if (isW(k, 'instrText')) {
            addRun(c);
            const top = stack[stack.length - 1];
            if (top && top.state === 'instr') top.instr += textOf(k);
          } else if (!isW(k, 'rPr')) plain = true;
        }
        if (plain && stack.length) addRun(c, true);
        continue;
      }
      visit(c);
    }
  };
  visit(root);
  return out;
}

const apply = (v, fmt) => {
  const s = String(v);
  if (fmt === 'upper') return s.toUpperCase();
  if (fmt === 'lower') return s.toLowerCase();
  if (fmt === 'caps') return s.replace(/\b\p{L}/gu, ch => ch.toUpperCase());
  if (fmt === 'firstcap') return s.charAt(0).toUpperCase() + s.slice(1);
  return s;
};

function runProps(f) {
  const src = f.result.find(r => childrenW(r, 't').length) || f.runs.find(r => isW(r, 'r')) || null;
  const rp = src && childrenW(src, 'rPr')[0];
  return rp ? rp.cloneNode(true) : null;
}

function textRun(doc, rPr, text, highlight) {
  const r = doc.createElementNS(NS.w, 'w:r');
  const p = rPr ? rPr.cloneNode(true) : (highlight ? doc.createElementNS(NS.w, 'w:rPr') : null);
  if (p && highlight) { const h = doc.createElementNS(NS.w, 'w:highlight'); h.setAttributeNS(NS.w, 'w:val', 'yellow'); p.appendChild(h); }
  if (p) r.appendChild(p);
  String(text).split('\n').forEach((line, i) => {
    if (i) r.appendChild(doc.createElementNS(NS.w, 'w:br'));
    const t = doc.createElementNS(NS.w, 'w:t');
    t.setAttribute('xml:space', 'preserve');
    t.appendChild(doc.createTextNode(line));
    r.appendChild(t);
  });
  return r;
}

// Swap a whole field (all its runs) for new runs.
function replaceField(f, nodes) {
  const first = f.runs[0];
  if (!first || !first.parentNode) return;
  for (const n of nodes) first.parentNode.insertBefore(n, first);
  for (const r of f.runs) if (r.parentNode) r.parentNode.removeChild(r);
}

/* ---------- typed markers: «NAME», <<NAME>> or {{NAME}} written as plain text (not Word fields) ---------- */
const TOKEN = /«\s*([A-Za-z][A-Za-z0-9_]{0,60})\s*»|<<\s*([A-Za-z][A-Za-z0-9_]{0,60})\s*>>|\{\{\s*([A-Za-z][A-Za-z0-9_]{0,60})\s*\}\}/g;
// Text of each paragraph, leaving out the text Word shows for fields (their «NAME» is not a typed marker).
function paragraphTexts(root) {
  const inField = new Set();
  for (const f of collect(root)) for (const r of f.runs) inField.add(r);
  const out = [];
  for (const p of [...root.getElementsByTagNameNS(NS.w, 'p')]) {
    const ts = [...p.getElementsByTagNameNS(NS.w, 't')].filter(t => ancestor(t, 'p') === p && !inField.has(t.parentNode) && !ancestor(t, 'fldSimple'));
    if (ts.length) out.push(ts);
  }
  return out;
}
// Typed markers ({ name, style }) and text that looks like a placeholder but cannot be filled (e.g. "<Court location>").
function typedNames(root) {
  const names = [], odd = [];
  for (const ts of paragraphTexts(root)) {
    const text = ts.map(textOf).join('');
    for (const m of text.matchAll(TOKEN)) names.push({ name: m[1] || m[2] || m[3], style: m[1] ? '«»' : m[2] ? '<<>>' : '{{}}' });
    const rest = text.replace(TOKEN, '');
    for (const m of rest.matchAll(/<[^<>\n]{2,80}>|\[\[[^\]]{2,60}\]\]|«[^»]{1,80}»|\{\{[^}]{1,60}\}\}|\{[A-Z_][A-Za-z0-9_ ]{1,40}\}/g)) odd.push(m[0].trim());
  }
  return { names, odd };
}
// value(name) -> string, or undefined to leave the marker as it is
function replaceTyped(root, value) {
  for (const ts of paragraphTexts(root)) {
    const parts = ts.map(textOf);
    const text = parts.join('');
    const hits = [...text.matchAll(TOKEN)].map(m => ({ at: m.index, len: m[0].length, v: value(m[1] || m[2] || m[3]) })).filter(h => h.v !== undefined);
    if (!hits.length) continue;
    for (const h of hits.reverse()) {
      let pos = 0, si = -1, so = 0, ei = -1, eo = 0;
      for (let i = 0; i < parts.length; i++) {
        const end = pos + parts[i].length;
        if (si < 0 && h.at < end) { si = i; so = h.at - pos; }
        if (si >= 0 && h.at + h.len <= end) { ei = i; eo = h.at + h.len - pos; break; }
        pos = end;
      }
      if (si < 0 || ei < 0) continue;
      if (si === ei) parts[si] = parts[si].slice(0, so) + h.v + parts[si].slice(eo);
      else { parts[si] = parts[si].slice(0, so) + h.v; for (let i = si + 1; i < ei; i++) parts[i] = ''; parts[ei] = parts[ei].slice(eo); }
    }
    ts.forEach((t, i) => {
      if (textOf(t) === parts[i]) return;
      while (t.firstChild) t.removeChild(t.firstChild);
      t.appendChild(t.ownerDocument.createTextNode(parts[i]));
      t.setAttribute('xml:space', 'preserve');
    });
  }
}

/* ---------- formula fields: { = «CTC»/12 \\# "0.00" } ---------- */
const isFormula = instr => /^\s*=/.test(String(instr || ''));
const num = v => { if (v === undefined || v === null || String(v).trim() === '') return NaN; const n = Number(String(v == null ? '' : v).replace(/[₹,\s]|Rs\.?/gi, '')); return Number.isFinite(n) ? n : NaN; };
// + - * / ( ) and numbers only; anything else is not evaluated.
function calc(expr) {
  const t = String(expr).match(/\d+(?:\.\d+)?|[-+*/()]|\S/g) || [];
  let i = 0;
  const peek = () => t[i], take = () => t[i++];
  const atom = () => {
    const x = take();
    if (x === '(') { const v = sum(); if (take() !== ')') throw new Error('bad'); return v; }
    if (x === '-') return -atom();
    if (x === '+') return atom();
    if (/^\d/.test(x || '')) return +x;
    throw new Error('bad');
  };
  const prod = () => { let v = atom(); while (peek() === '*' || peek() === '/') { const o = take(), w = atom(); v = o === '*' ? v * w : v / w; } return v; };
  const sum = () => { let v = prod(); while (peek() === '+' || peek() === '-') { const o = take(), w = prod(); v = o === '+' ? v + w : v - w; } return v; };
  const v = sum();
  if (i !== t.length || !Number.isFinite(v)) throw new Error('bad');
  return v;
}
function picture(v, instr) {
  const m = /\\#\s*"?([#0,.]+)/.exec(instr || '');
  const pic = m ? m[1] : '';
  const dec = pic.includes('.') ? (pic.split('.')[1].match(/0/g) || []).length : (pic ? 0 : (Number.isInteger(v) ? 0 : 2));
  if (pic.includes(',')) return v.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return v.toFixed(dec);
}

/* ---------- pictures ---------- */
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { type: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { type: 'jpeg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}

function drawingRun(doc, relId, size, id) {
  const EMU = 914400, maxW = 1.6 * EMU, maxH = 0.7 * EMU;
  const k = Math.min(maxW / size.w, maxH / size.h);
  const cx = Math.round(size.w * k), cy = Math.round(size.h * k);
  const xml = `<w:r xmlns:w="${NS.w}"><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Signature ${id}"/>` +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="signature.${size.type === 'png' ? 'png' : 'jpg'}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip xmlns:r="${NS.r}" r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  return doc.importNode(parse(xml).documentElement, true);
}

/* ---------- repeating tables ---------- */
const ancestor = (n, local) => { for (let p = n && n.parentNode; p; p = p.parentNode) if (isW(p, local)) return p; return null; };
const marker = name => { const m = /^Table(Start|End):(.+)$/i.exec(name || ''); return m ? { end: /end/i.test(m[1]), table: m[2].trim() } : null; };

function regionsOf(fields) {
  const map = new Map();
  for (const f of fields) {
    const mf = mergeName(f.instr); const mk = mf && marker(mf.name);
    if (!mk) continue;
    const key = mk.table.toLowerCase();
    const r = map.get(key) || { name: mk.table, start: null, end: null };
    if (mk.end) r.end = r.end || f; else { r.start = r.start || f; r.name = mk.table; }
    map.set(key, r);
  }
  const out = [];
  for (const r of map.values()) {
    if (!r.start || !r.end) continue;
    const a = ancestor(r.start.runs[0], 'tr'), b = ancestor(r.end.runs[0], 'tr');
    const rows = [];
    if (a && b && a.parentNode === b.parentNode) {
      for (let n = a; n; n = n.nextSibling) { if (isW(n, 'tr')) rows.push(n); if (n === b) break; }
      if (rows[rows.length - 1] !== b) rows.length = 0;
    }
    out.push({ name: r.name, rows, table: rows.length ? a.parentNode : null });
  }
  return out;
}

/* ---------- scan ---------- */
async function scan(buffer) {
  const zip = await open(buffer);
  const fields = new Map(), regions = [], images = new Set(), warnings = [];
  for (const name of Object.keys(zip.files).filter(n => PART_RE.test(n)).sort()) {
    const doc = parse(await zip.file(name).async('string'));
    const all = collect(doc.documentElement);
    const regs = name === 'word/document.xml' ? regionsOf(all) : [];
    const inRegion = new Set();
    for (const r of regs) {
      if (!r.table) continue;
      const names = [];
      for (const row of r.rows) for (const f of collect(row)) {
        inRegion.add(f.runs[0]);
        const mf = mergeName(f.instr);
        if (mf && !marker(mf.name) && !names.includes(mf.name)) names.push(mf.name);
      }
      regions.push({ name: r.name, fields: names });
    }
    for (const f of all) {
      const mf = mergeName(f.instr);
      if (!mf || marker(mf.name) || inRegion.has(f.runs[0])) continue;
      if (f.depth > 0) {
        if (!f.inInstr) continue; // inside another field's shown value: replaced together with that field
        if (!isFormula(f.parent && f.parent.instr)) { warnings.push(`«${mf.name}» sits inside a Word ${String((f.parent && f.parent.instr) || '').trim().split(/\s/)[0] || ''} field, which is not filled; use a plain merge field instead.`); continue; }
      }
      if (/^Image:/i.test(mf.name)) { images.add(mf.name.replace(/^Image:/i, '')); continue; }
      const e = fields.get(mf.name) || { name: mf.name, count: 0, parts: [] };
      e.count++;
      e.styles = [...new Set((e.styles || []).concat('Word field'))];
      const part = name.replace(/^word\//, '').replace(/\.xml$/, '').replace(/\d+$/, '');
      if (!e.parts.includes(part)) e.parts.push(part);
      fields.set(mf.name, e);
    }
    const typed = typedNames(doc.documentElement);
    for (const o of typed.odd) warnings.push(`"${o.slice(0, 80)}" looks like a placeholder but is not one the tool can fill (use «NAME», <<NAME>> or {{NAME}} with letters, numbers and _ only). It will print as it is.`);
    for (const { name: nm, style } of typed.names) {
      if (/^Table(Start|End)/i.test(nm)) continue;
      const e = fields.get(nm) || { name: nm, count: 0, parts: [] };
      e.count++;
      e.styles = [...new Set((e.styles || []).concat('typed ' + style))];
      const part = name.replace(/^word\//, '').replace(/\.xml$/, '').replace(/\d+$/, '');
      if (!e.parts.includes(part)) e.parts.push(part);
      fields.set(nm, e);
    }
  }
  return { fields: [...fields.values()], regions, images: [...images], warnings: [...new Set(warnings)].slice(0, 10) };
}

/* ---------- fill ---------- */
/* ---------- floating tables ---------- */
// A table set to "Text wrapping: Around" floats. When there is no real room beside it (less than an inch),
// Word leaves that sliver empty, but browser previews and PDF converters pour the next paragraph into it one
// word per line. In previews such tables are made ordinary (in line) tables at the same left position.
const TW = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
function textWidth(doc) {
  const secs = doc.getElementsByTagNameNS(NS.w, 'sectPr');
  const sec = secs.length ? secs[secs.length - 1] : null;
  if (!sec) return 0;
  const sz = sec.getElementsByTagNameNS(NS.w, 'pgSz')[0], mar = sec.getElementsByTagNameNS(NS.w, 'pgMar')[0];
  if (!sz || !mar) return 0;
  return { width: TW(sz.getAttributeNS(NS.w, 'w')) - TW(mar.getAttributeNS(NS.w, 'left')) - TW(mar.getAttributeNS(NS.w, 'right')), left: TW(mar.getAttributeNS(NS.w, 'left')) };
}
function inlineCrampedTables(doc) {
  const page = textWidth(doc);
  if (!page || page.width <= 0) return 0;
  let n = 0;
  for (const tblPr of [...doc.getElementsByTagNameNS(NS.w, 'tblPr')]) {
    const fp = [...tblPr.childNodes].find(x => x.localName === 'tblpPr');
    if (!fp) continue;
    const tbl = tblPr.parentNode;
    const g = tbl && [...tbl.childNodes].find(x => x.localName === 'tblGrid');
    const tw = [...tblPr.childNodes].find(x => x.localName === 'tblW');
    let width = tw && tw.getAttributeNS(NS.w, 'type') === 'dxa' ? TW(tw.getAttributeNS(NS.w, 'w')) : 0;
    if (!width && g) width = [...g.childNodes].filter(x => x.localName === 'gridCol').reduce((a, c) => a + TW(c.getAttributeNS(NS.w, 'w')), 0);
    if (!width || fp.getAttributeNS(NS.w, 'tblpXSpec')) continue;
    const anchor = fp.getAttributeNS(NS.w, 'horzAnchor') || 'text';
    let x = TW(fp.getAttributeNS(NS.w, 'tblpX'));
    if (anchor === 'page') x -= page.left;
    const room = Math.max(x - TW(fp.getAttributeNS(NS.w, 'leftFromText')), page.width - x - width - TW(fp.getAttributeNS(NS.w, 'rightFromText')));
    if (room >= 1440) continue; // real room for text beside it: leave the layout alone
    tblPr.removeChild(fp);
    for (const o of [...tblPr.childNodes].filter(c => c.localName === 'tblOverlap')) tblPr.removeChild(o);
    if (x > 0 && ![...tblPr.childNodes].some(c => c.localName === 'tblInd')) {
      const ind = doc.createElementNS(NS.w, 'w:tblInd');
      ind.setAttributeNS(NS.w, 'w:w', String(x)); ind.setAttributeNS(NS.w, 'w:type', 'dxa');
      const after = [...tblPr.childNodes].find(c => ['tblBorders', 'shd', 'tblLayout', 'tblCellMar', 'tblLook', 'tblCaption', 'tblDescription'].includes(c.localName));
      tblPr.insertBefore(ind, after || null);
    }
    n++;
  }
  return n;
}

async function fill(buffer, opts = {}) {
  const zip = await open(buffer);
  const fields = opts.fields || {}, tables = opts.tables || {}, images = opts.images || {}, preview = Boolean(opts.preview);
  const tableRows = name => { const k = Object.keys(tables).find(t => t.toLowerCase() === String(name).toLowerCase()); return k ? tables[k] : null; };
  const missing = new Set();
  let picId = 9100, media = 0;
  const ctTypes = new Set();

  const valueFor = (name, rec) => {
    if (rec && Object.prototype.hasOwnProperty.call(rec, name)) return rec[name];
    if (Object.prototype.hasOwnProperty.call(fields, name)) return fields[name];
    return undefined;
  };

  for (const part of Object.keys(zip.files).filter(n => PART_RE.test(n))) {
    const doc = parse(await zip.file(part).async('string'));
    const relsPath = part.replace(/^word\//, 'word/_rels/') + '.rels';
    let rels = null, relsChanged = false;
    const relsDoc = async () => {
      if (rels) return rels;
      const f = zip.file(relsPath);
      rels = parse(f ? await f.async('string') : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS.rel}"></Relationships>`);
      return rels;
    };
    const addImage = async img => {
      const size = imageSize(img.data);
      if (!size || !size.w || !size.h) return null;
      const ext = size.type === 'png' ? 'png' : 'jpeg';
      const file = `media/tcmpl_sig_${++media}_${Date.now() % 100000}.${ext}`;
      zip.file('word/' + file, img.data);
      ctTypes.add(ext);
      const rd = await relsDoc();
      const id = 'rIdTc' + media + 'x' + (Date.now() % 10000);
      const el = rd.createElementNS(NS.rel, 'Relationship');
      el.setAttribute('Id', id); el.setAttribute('Type', IMG_REL); el.setAttribute('Target', file);
      rd.documentElement.appendChild(el);
      relsChanged = true;
      return { id, size };
    };

    const fillField = async (f, rec) => {
      if (isFormula(f.instr)) {
        let ok = true;
        const expr = f.instr.replace(/^\s*=/, '').split('\\')[0].replace(/\uE000(\d+)\uE000/g, (x, k) => {
          const mf = mergeName((f.nested[+k] || {}).instr);
          const v = mf ? num(valueFor(mf.name, rec)) : NaN;
          if (!Number.isFinite(v)) { ok = false; if (mf) missing.add(mf.name); return '0'; }
          return String(v);
        });
        let out = '';
        try { if (ok) out = picture(calc(expr), f.instr); } catch { ok = false; }
        const rPr = runProps(f) || (f.nested[0] && runProps(f.nested[0]));
        replaceField(f, ok ? [textRun(doc, rPr, out)] : preview ? [textRun(doc, rPr, '«formula»', true)] : []);
        return;
      }
      const mf = mergeName(f.instr);
      if (!mf) return;
      if (marker(mf.name)) { replaceField(f, []); return; }
      const rPr = runProps(f);
      if (/^Image:/i.test(mf.name)) {
        const key = mf.name.replace(/^Image:/i, '');
        if (images[key] === null) { replaceField(f, []); return; } // set to "leave out"
        const img = images[key] || images[mf.name];
        const added = img && img.data ? await addImage(img) : null;
        if (added) replaceField(f, [drawingRun(doc, added.id, added.size, ++picId)]);
        else if (preview) replaceField(f, [textRun(doc, rPr, `[${(opts.imageNotes || {})[key] || 'picture: ' + key}]`, true)]);
        else { missing.add(mf.name); replaceField(f, []); }
        return;
      }
      const v = valueFor(mf.name, rec);
      if (v === undefined || v === null) {
        missing.add(mf.name);
        replaceField(f, preview ? [textRun(doc, rPr, `«${mf.name}»`, true)] : []);
        return;
      }
      replaceField(f, String(v) === '' ? [] : [textRun(doc, rPr, apply(v, mf.fmt))]);
    };

    // 1. Repeating table rows (body only).
    if (part === 'word/document.xml') {
      for (const r of regionsOf(collect(doc.documentElement))) {
        if (!r.table) continue;
        const recs = (tableRows(r.name) || []).filter(x => x && typeof x === 'object').slice(0, 200);
        if (!recs.length) { if (r.table.parentNode) r.table.parentNode.removeChild(r.table); continue; }
        const anchor = r.rows[0];
        for (const rec of recs) {
          const clones = r.rows.map(x => x.cloneNode(true));
          for (const cl of clones) {
            anchor.parentNode.insertBefore(cl, anchor);
            for (const f of collect(cl).filter(x => x.depth === 0)) await fillField(f, rec);
          }
        }
        for (const x of r.rows) if (x.parentNode) x.parentNode.removeChild(x);
      }
    }
    // 2. Everything else.
    for (const f of collect(doc.documentElement).filter(x => x.depth === 0)) await fillField(f, null);
    // 3. Markers typed as plain text.
    replaceTyped(doc.documentElement, nm => {
      const v = valueFor(nm, null);
      if (v === undefined || v === null) { missing.add(nm); return undefined; }
      return String(v);
    });

    // Previews only: the browser preview pours text into the sliver beside a full-width floating table. PDFs
    // (LibreOffice, Word) lay those tables out like Word does, so the candidate's letter keeps its exact layout.
    if (part === 'word/document.xml' && preview) inlineCrampedTables(doc);
    zip.file(part, serialize(doc));
    if (relsChanged) zip.file(relsPath, serialize(rels));
  }

  if (ctTypes.size) {
    const ct = parse(await zip.file('[Content_Types].xml').async('string'));
    const have = new Set([...ct.documentElement.getElementsByTagName('Default')].map(d => (d.getAttribute('Extension') || '').toLowerCase()));
    for (const ext of ctTypes) {
      if (have.has(ext)) continue;
      const d = ct.createElementNS(NS.ct, 'Default');
      d.setAttribute('Extension', ext); d.setAttribute('ContentType', 'image/' + ext);
      ct.documentElement.insertBefore(d, ct.documentElement.firstChild);
    }
    zip.file('[Content_Types].xml', serialize(ct));
  }
  // The template was a mail-merge main document: without this Word asks for the (absent) data source on opening.
  const st = zip.file('word/settings.xml');
  if (st) {
    const sd = parse(await st.async('string'));
    for (const mm of [...sd.getElementsByTagNameNS(NS.w, 'mailMerge')]) mm.parentNode.removeChild(mm);
    zip.file('word/settings.xml', serialize(sd));
  }
  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { buffer: out, missing: [...missing] };
}


/* ---------- the letter as plain text (for the onboarding agent to read) ---------- */
// Paragraphs in order, tables as "cell | cell" rows, Word's automatic list numbers (1.1, 7.9.1, a.) included,
// then the header and footer text once.
const ROMAN = n => { let r = ''; for (const [v, s] of [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]) while (n >= v) { r += s; n -= v; } return r; };
function fmtNum(n, f) {
  if (f === 'lowerLetter') return String.fromCharCode(96 + ((n - 1) % 26) + 1);
  if (f === 'upperLetter') return String.fromCharCode(64 + ((n - 1) % 26) + 1);
  if (f === 'lowerRoman') return ROMAN(n);
  if (f === 'upperRoman') return ROMAN(n).toUpperCase();
  if (f === 'bullet') return '•';
  if (f === 'none') return '';
  return String(n);
}
const attrW = (el, name) => (el ? (el.getAttributeNS(NS.w, name) || el.getAttribute('w:' + name) || '') : '');
const firstW = (el, local) => (el ? childrenW(el, local)[0] || null : null);

async function toText(buffer) {
  const zip = await open(buffer);
  const read = async n => (zip.file(n) ? parse(await zip.file(n).async('string')) : null);
  const doc = await read('word/document.xml'), numbering = await read('word/numbering.xml'), styles = await read('word/styles.xml');
  // numbering: numId -> { abs, overrides }, abs -> levels
  const nums = {}, abstracts = {};
  if (numbering) {
    for (const a of [...numbering.getElementsByTagNameNS(NS.w, 'abstractNum')]) {
      const lv = {};
      for (const l of childrenW(a, 'lvl')) lv[attrW(l, 'ilvl')] = { start: +attrW(firstW(l, 'start'), 'val') || 1, fmt: attrW(firstW(l, 'numFmt'), 'val') || 'decimal', text: attrW(firstW(l, 'lvlText'), 'val') };
      abstracts[attrW(a, 'abstractNumId')] = lv;
    }
    for (const n of [...numbering.getElementsByTagNameNS(NS.w, 'num')]) {
      const starts = {};
      for (const o of childrenW(n, 'lvlOverride')) { const so = firstW(o, 'startOverride'); if (so) starts[attrW(o, 'ilvl')] = +attrW(so, 'val'); }
      nums[attrW(n, 'numId')] = { abs: attrW(firstW(n, 'abstractNumId'), 'val'), starts };
    }
  }
  const styleNum = {};
  if (styles) {
    const by = {};
    for (const st of [...styles.getElementsByTagNameNS(NS.w, 'style')]) by[attrW(st, 'styleId')] = st;
    const find = (id, depth = 0) => {
      const st = by[id]; if (!st || depth > 8) return null;
      const np = firstW(firstW(st, 'pPr'), 'numPr');
      if (np) return { numId: attrW(firstW(np, 'numId'), 'val'), ilvl: attrW(firstW(np, 'ilvl'), 'val') || '0' };
      const b = firstW(st, 'basedOn'); return b ? find(attrW(b, 'val'), depth + 1) : null;
    };
    for (const id of Object.keys(by)) styleNum[id] = find(id);
  }
  const counters = {}; // abstract id -> [level counters]
  const numberFor = p => {
    const pPr = firstW(p, 'pPr');
    let np = firstW(pPr, 'numPr'), numId = '', ilvl = '0';
    if (np) { numId = attrW(firstW(np, 'numId'), 'val'); ilvl = attrW(firstW(np, 'ilvl'), 'val') || '0'; }
    else { const s = styleNum[attrW(firstW(pPr, 'pStyle'), 'val')]; if (s) { numId = s.numId; ilvl = s.ilvl; } }
    const n = nums[numId];
    if (!n || numId === '0') return '';
    const lv = abstracts[n.abs] || {}, L = +ilvl;
    const c = counters[n.abs] = counters[n.abs] || [];
    if (!n.seen) { n.seen = true; for (const [k, v] of Object.entries(n.starts)) c[+k] = v - 1; }
    c[L] = (c[L] === undefined ? ((lv[L] && lv[L].start) || 1) - 1 : c[L]) + 1;
    for (let k = L + 1; k < 10; k++) c[k] = undefined;
    const def = lv[L]; if (!def) return '';
    return def.text.replace(/%(\d)/g, (x, d) => { const k = +d - 1; const v = c[k] === undefined ? ((lv[k] && lv[k].start) || 1) : c[k]; return fmtNum(v, (lv[k] || def).fmt); }).trim();
  };
  const runText = p => {
    let s = '';
    const walk = n => {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        if (isW(c, 't')) s += textOf(c);
        else if (isW(c, 'tab')) s += ' ';
        else if (isW(c, 'br') || isW(c, 'cr')) s += '\n';
        else if (isW(c, 'instrText') || isW(c, 'delText') || isW(c, 'pPr') || isW(c, 'rPr')) continue;
        else if (isW(c, 'p')) continue; // text boxes are read separately
        else walk(c);
      }
    };
    walk(p);
    return s.replace(/[ \u00a0]+/g, ' ').trim();
  };
  const lines = [];
  const block = el => {
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      if (isW(c, 'p')) {
        const t = runText(c), num = numberFor(c);
        if (t) lines.push((num && num !== '•' ? num + ' ' : num === '•' ? '• ' : '') + t);
        else if (lines.length && lines[lines.length - 1] !== '') lines.push('');
        // text boxes inside the paragraph
        for (const tb of [...c.getElementsByTagNameNS(NS.w, 'txbxContent')]) if (!ancestor(tb, 'txbxContent')) block(tb);
      } else if (isW(c, 'tbl')) {
        for (const tr of childrenW(c, 'tr')) {
          const cells = childrenW(tr, 'tc').map(tc => { const sub = []; const keep = lines.length; block(tc); sub.push(...lines.splice(keep)); return sub.filter(Boolean).join(' / '); });
          if (cells.some(Boolean)) lines.push(cells.join(' | '));
        }
        lines.push('');
      } else if (isW(c, 'sdt')) { const ct = firstW(c, 'sdtContent'); if (ct) block(ct); }
      else if (isW(c, 'body') || isW(c, 'hdr') || isW(c, 'ftr')) block(c);
    }
  };
  block(firstW(doc.documentElement, 'body') || doc.documentElement);
  const extra = [];
  for (const n of Object.keys(zip.files).filter(x => /^word\/(header|footer)\d*\.xml$/.test(x)).sort()) {
    const d = await read(n); const keep = lines.length; block(d.documentElement);
    const t = lines.splice(keep).filter(Boolean).join('\n'); if (t && !extra.includes(t)) extra.push(t);
  }
  let out = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (extra.length) out += '\n\n[Header / footer]\n' + extra.join('\n');
  return out;
}

module.exports = { scan, fill, toText, mergeName, imageSize, inlineCrampedTables };
