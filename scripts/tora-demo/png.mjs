// Minimal PNG writer: a soft two-colour gradient with stripes (placeholder "proof photo").
import zlib from 'node:zlib';
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
export function photo(seed = 0, w = 320, h = 240) {
  const a = [[233, 162, 59], [47, 91, 211], [15, 123, 108], [178, 58, 72], [110, 75, 184]][seed % 5];
  const b = [30, 30, 40];
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const t = (x + y) / (w + h); const s = ((x >> 4) + (y >> 4)) % 2 ? 1 : 0.92; for (let k = 0; k < 3; k++) raw[y * (w * 3 + 1) + 1 + x * 3 + k] = Math.round((a[k] * (1 - t) + b[k] * t) * s); } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
