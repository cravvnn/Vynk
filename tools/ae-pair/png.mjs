import fs from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export function pngPixels(file) {
  const png = fs.readFileSync(file);
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let width, height, channels;
  const chunks = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at), type = png.toString('ascii', at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (data[8] !== 8 || !channels || data[12] !== 0) throw Error('expected an 8-bit RGB/RGBA PNG without interlacing');
    } else if (type === 'IDAT') chunks.push(data);
    at += length + 12;
  }
  const packed = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  if (packed.length !== (stride + 1) * height) throw Error('PNG scanline size differs');
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = packed[y * (stride + 1)];
    if (filter > 4) throw Error('invalid PNG filter');
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const corner = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const p = left + up - corner;
      const predictor = Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - corner) ? left : Math.abs(p - up) <= Math.abs(p - corner) ? up : corner;
      const value = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : predictor;
      pixels[y * stride + x] = packed[y * (stride + 1) + 1 + x] + value;
    }
  }
  return { width, height, channels, pixels, hash: createHash('sha256').update(pixels).digest('hex') };
}
