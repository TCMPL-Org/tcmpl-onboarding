'use strict';
// A small PDF writer for letters and statements (A4, Helvetica, paragraphs, headings and tables).
// No package needed. Text is kept to plain Latin characters ("₹" becomes "Rs.").

const W = 595.28, H = 841.89, M = 56;

// Helvetica widths (per 1000 units) for printable ASCII 32..126.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const BOLD_FACTOR = 1.06;

function ascii(s) {
  return String(s == null ? '' : s).replace(/₹\s?/g, 'Rs. ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/·/g, '-')
    .normalize('NFKD').replace(/[^\x20-\x7e\n]/g, '');
}
const widthOf = (s, size, bold) => [...s].reduce((a, c) => a + (HELV[c.charCodeAt(0) - 32] || 556), 0) * size / 1000 * (bold ? BOLD_FACTOR : 1);
function wrap(text, size, maxW, bold) {
  const out = [];
  for (const para of ascii(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? line + ' ' + word : word;
      if (widthOf(t, size, bold) <= maxW || !line) line = t; else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}
const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

// blocks: { t: 'h', text } | { t: 'p', text } | { t: 'table', rows: [[...], ...], widths?: [fractions], boldRows?: [index] } | { t: 'gap' }
function build(title, blocks, footer) {
  const pages = [];
  let ops = [], y = H - M;
  const newPage = () => { pages.push(ops); ops = []; y = H - M; };
  const need = h => { if (y - h < M) newPage(); };
  const text = (x, yy, s, size, bold) => ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${yy.toFixed(2)} Td (${esc(s)}) Tj ET`);

  for (const l of wrap(title, 15, W - 2 * M, true)) { need(20); text(M, y, l, 15, true); y -= 20; }
  y -= 6;
  for (const b of blocks || []) {
    if (b.t === 'gap') { y -= 10; continue; }
    if (b.t === 'h') { y -= 6; for (const l of wrap(b.text, 11.5, W - 2 * M, true)) { need(16); text(M, y, l, 11.5, true); y -= 16; } continue; }
    if (b.t === 'p') { for (const l of wrap(b.text, 10.5, W - 2 * M, false)) { need(14); text(M, y, l, 10.5, false); y -= 14; } y -= 6; continue; }
    if (b.t === 'table') {
      const n = b.rows[0].length, tw = W - 2 * M;
      const fr = b.widths && b.widths.length === n ? b.widths : new Array(n).fill(1 / n);
      const cw = fr.map(f => f * tw);
      b.rows.forEach((r, ri) => {
        const bold = ri === 0 || (b.boldRows || []).includes(ri);
        const cells = r.map((c, ci) => wrap(c, 9.5, cw[ci] - 8, bold));
        const h = Math.max(...cells.map(c => c.length)) * 12 + 6;
        need(h);
        let x = M;
        cells.forEach((lines, ci) => {
          ops.push(`0.75 G ${x.toFixed(2)} ${(y - h + 9).toFixed(2)} ${cw[ci].toFixed(2)} ${h.toFixed(2)} re S`);
          const right = b.align && b.align[ci] === 'right';
          lines.forEach((l, li) => text(right ? x + cw[ci] - 4 - widthOf(l, 9.5, bold) : x + 4, y - li * 12, l, 9.5, bold));
          x += cw[ci];
        });
        y -= h;
      });
      y -= 10;
    }
  }
  if (footer) { y -= 6; for (const l of wrap(footer, 8, W - 2 * M, false)) { need(11); ops.push(`BT /F3 8 Tf ${M} ${y.toFixed(2)} Td (${esc(l)}) Tj ET`); y -= 11; } }
  pages.push(ops);

  // Assemble the file.
  const objs = [];
  const add = s => { objs.push(s); return objs.length; };
  const catalog = add(''), pagesObj = add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const f3 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>');
  const kids = [];
  pages.forEach((p, i) => {
    const content = p.join('\n') + `\nBT /F3 8 Tf ${(W - M - 40).toFixed(2)} ${(M / 2).toFixed(2)} Td (Page ${i + 1} of ${pages.length}) Tj ET`;
    const c = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R >> >> /Contents ${c} 0 R >>`));
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

module.exports = { build, ascii, wrap };
