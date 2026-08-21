/**
 * zip.js: a minimal, dependency-free ZIP reader/writer.
 *
 * Excel workbooks (and Word documents) are ZIP archives of XML parts. Rather
 * than vendor a compression library, this writes uncompressed ("stored")
 * entries (valid per the ZIP spec, openable by Excel/LibreOffice/7-Zip)
 * and reads both stored and DEFLATE entries, using the browser's native
 * `DecompressionStream('deflate-raw')` for the latter. No network, no
 * third-party code: every primitive here is either hand-rolled (CRC-32) or
 * a standard Web Platform API.
 */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 of a byte array, per the ZIP/PNG polynomial. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f);
  const day = (((date.getFullYear() - 1980) & 0x7f) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

class Writer {
  constructor() { this.chunks = []; this.length = 0; }
  u16(n) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); this.push(b); }
  u32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); this.push(b); }
  bytes(b) { this.push(b instanceof Uint8Array ? b : new Uint8Array(b)); }
  push(b) { this.chunks.push(b); this.length += b.length; }
  toBytes() {
    const out = new Uint8Array(this.length);
    let off = 0;
    for (const c of this.chunks) { out.set(c, off); off += c.length; }
    return out;
  }
}

/**
 * Build an uncompressed ZIP archive from named byte entries.
 * @param {Array<{name:string, data:Uint8Array}>} entries
 * @returns {Uint8Array}
 */
export function writeZip(entries) {
  const enc = new TextEncoder();
  const { time, day } = dosDateTime();
  const w = new Writer();
  const centralParts = [];
  const offsets = [];

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    offsets.push(w.length);

    w.u32(LOCAL_SIG);
    w.u16(20);        // version needed
    w.u16(0);         // flags
    w.u16(0);         // method: stored
    w.u16(time);
    w.u16(day);
    w.u32(crc);
    w.u32(data.length); // compressed size
    w.u32(data.length); // uncompressed size
    w.u16(nameBytes.length);
    w.u16(0);          // extra length
    w.bytes(nameBytes);
    w.bytes(data);

    const cd = new Writer();
    cd.u32(CENTRAL_SIG);
    cd.u16(20); cd.u16(20);
    cd.u16(0); cd.u16(0);
    cd.u16(time); cd.u16(day);
    cd.u32(crc);
    cd.u32(data.length); cd.u32(data.length);
    cd.u16(nameBytes.length);
    cd.u16(0); cd.u16(0);   // extra, comment
    cd.u16(0); cd.u16(0);   // disk number, internal attrs
    cd.u32(0);              // external attrs
    cd.u32(offsets.at(-1));
    cd.bytes(nameBytes);
    centralParts.push(cd.toBytes());
  }

  const cdStart = w.length;
  for (const part of centralParts) w.bytes(part);
  const cdSize = w.length - cdStart;

  w.u32(EOCD_SIG);
  w.u16(0); w.u16(0);
  w.u16(entries.length); w.u16(entries.length);
  w.u32(cdSize);
  w.u32(cdStart);
  w.u16(0); // comment length

  return w.toBytes();
}

/**
 * Read a ZIP archive into a Map of path -> Uint8Array, transparently
 * inflating DEFLATE entries via the native DecompressionStream API.
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {Promise<Map<string, Uint8Array>>}
 */
export async function readZip(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let eocd = -1;
  const minPos = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('That does not look like a valid .xlsx/.zip file.');

  const totalEntries = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();

  const files = new Map();
  let ptr = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (dv.getUint32(ptr, true) !== CENTRAL_SIG) throw new Error('Corrupt archive: central directory unreadable.');
    const method = dv.getUint16(ptr + 10, true);
    const compSize = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commentLen = dv.getUint16(ptr + 32, true);
    const localOffset = dv.getUint32(ptr + 42, true);
    const name = dec.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    const lNameLen = dv.getUint16(localOffset + 26, true);
    const lExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compSize);

    let data;
    if (method === 0) {
      data = raw;
    } else if (method === 8) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('This browser cannot read compressed Excel files. Please update it and try again.');
      }
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else {
      throw new Error(`Unsupported compression in this file (method ${method}).`);
    }
    if (!name.endsWith('/')) files.set(name, data);
  }
  return files;
}
