'use strict';
// Blacks out regions of a photo (the first 8 Aadhaar digits and the QR code).
// Masking happens in memory: the unmasked photo is never written to storage.

const PAD = 6;

function box(polygon) {
  const xs = [], ys = [];
  for (let i = 0; i + 1 < polygon.length; i += 2) { xs.push(polygon[i]); ys.push(polygon[i + 1]); }
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// Returns { buffer, contentType } of the masked JPEG, or throws masking_unsafe when the
// photo and the OCR result don't line up (then nothing is stored).
async function maskImage(buffer, regions) {
  const { Jimp } = require('jimp');
  const img = await Jimp.read(buffer);
  const W = img.bitmap.width, H = img.bitmap.height;
  for (const r of regions) {
    if (r.unit && r.unit !== 'pixel') { const e = new Error('Only photos can be masked'); e.code = 'masking_unsafe'; throw e; }
    if (r.width && r.height && (Math.abs(r.width / r.height - W / H) > 0.02)) { const e = new Error('Photo orientation differs from the OCR result'); e.code = 'masking_unsafe'; throw e; }
    const s = r.width ? W / r.width : 1;
    const b = box(r.polygon);
    const pad = r.kind === 'qr' ? PAD * 2 : PAD;
    const x = Math.max(0, Math.floor(b.x0 * s) - pad), y = Math.max(0, Math.floor(b.y0 * s) - pad);
    const w = Math.min(W - x, Math.ceil((b.x1 - b.x0) * s) + 2 * pad), h = Math.min(H - y, Math.ceil((b.y1 - b.y0) * s) + 2 * pad);
    if (w <= 0 || h <= 0) continue;
    img.scan(x, y, w, h, function (_x, _y, idx) { this.bitmap.data[idx] = 0; this.bitmap.data[idx + 1] = 0; this.bitmap.data[idx + 2] = 0; this.bitmap.data[idx + 3] = 255; });
  }
  return { buffer: await img.getBuffer('image/jpeg', { quality: 85 }), contentType: 'image/jpeg' };
}

// Shrinks large photos so they fit the free tier's 4 MB limit.
async function shrinkPhoto(buffer, maxBytes = 3900000) {
  if (buffer.length <= maxBytes) return buffer;
  const { Jimp } = require('jimp');
  const img = await Jimp.read(buffer);
  const side = Math.max(img.bitmap.width, img.bitmap.height);
  if (side > 2400) img.scale(2400 / side);
  return img.getBuffer('image/jpeg', { quality: 85 });
}

module.exports = { maskImage, shrinkPhoto, box };
