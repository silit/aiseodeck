'use strict';
// Checks the Designer Extension bundle and makes the review ZIP for the Marketplace submission.
//
//   cd extension && npx @webflow/webflow-cli extension bundle     (writes extension/bundle.zip)
//   node scripts/package-extension.js                             (checks it, writes extension/review.zip)
//
// The extension ships its source unchanged, so the review ZIP holds its files exactly as they are inside
// bundle.zip, plus extension/README.md. This script refuses to write it unless
//   - bundle.zip holds exactly webflow.json, index.html, app.css and app.js at its root and the two font files
//     and their license in fonts/, and nothing else,
//   - each of them is the same bytes as the file in extension/ (so what was tested is what ships),
//   - none of them carries a source map, the manifest is the one in the repository, and the bundle is under 5 MB.
// It reads and writes ZIP files itself (stored entries and deflate), with no dependency and no other program.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const EXT = path.join(__dirname, '..', 'extension');
const SOURCES = {
  'webflow.json': path.join(EXT, 'webflow.json'),
  'index.html': path.join(EXT, 'public', 'index.html'),
  'app.css': path.join(EXT, 'public', 'app.css'),
  'app.js': path.join(EXT, 'public', 'app.js'),
  // Inter, the typeface of Webflow's interface, for Latin text: two font files and their license
  'fonts/inter-latin-wght-normal.woff2': path.join(EXT, 'public', 'fonts', 'inter-latin-wght-normal.woff2'),
  'fonts/inter-latin-ext-wght-normal.woff2': path.join(EXT, 'public', 'fonts', 'inter-latin-ext-wght-normal.woff2'),
  'fonts/OFL.txt': path.join(EXT, 'public', 'fonts', 'OFL.txt')
};
const MANIFEST = { name: 'AI SEO Deck', apiVersion: '2', size: 'comfortable', publicDir: 'public' };

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/* ---------- reading a ZIP ---------- */
function readZip(buf) {
  // the end of central directory record is at the end of the file, before an optional comment
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a ZIP file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('the ZIP directory is damaged');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 1) throw new Error(name + ' is encrypted');
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('the ZIP entry of ' + name + ' is damaged');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.slice(start, start + csize);
    if (name.endsWith('/')) { files.push({ name, dir: true, data: Buffer.alloc(0) }); continue; }
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(name + ' uses a compression this script does not read (method ' + method + ')');
    if (data.length !== usize) throw new Error(name + ' has another length than the ZIP says');
    if ((zlib.crc32 ? zlib.crc32(data) : crc32(data)) !== crc) throw new Error(name + ' does not match its checksum in the ZIP');
    files.push({ name, dir: false, data });
  }
  return files;
}

/* ---------- writing a ZIP ---------- */
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// The same input gives the same file: a fixed date, a fixed order, no extra fields.
function writeZip(entries) {
  const DOS_TIME = 0, DOS_DATE = (2026 - 1980) << 9 | 11 << 5 | 23; // 23 November 2026, 00:00
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const packed = zlib.deflateRawSync(e.data, { level: 9 });
    const crc = crc32(e.data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt16LE(DOS_TIME, 10); head.writeUInt16LE(DOS_DATE, 12); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(e.data.length, 22); head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28);
    parts.push(head, name, packed);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(DOS_TIME, 12); dir.writeUInt16LE(DOS_DATE, 14); dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20); dir.writeUInt32LE(e.data.length, 24); dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(0, 30); dir.writeUInt32LE(0, 34); dir.writeUInt32LE(0, 38); dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += 30 + name.length + packed.length;
  }
  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(parts.concat([dirBuf, end]));
}

/* ---------- the checks ---------- */
// Returns { problems, files, sums }: what is wrong with the bundle (nothing, when it may be submitted), the four
// files as they are inside it, and their SHA-256.
// Webflow takes a Designer Extension bundle of at most 5 MB: a larger one fails at upload, before any review.
const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;
function checkBundle(bundleBuf, sources) {
  const problems = [];
  if (bundleBuf.length > MAX_BUNDLE_BYTES) problems.push('bundle.zip is ' + bundleBuf.length + ' bytes, more than the 5 MB Webflow takes');
  let entries = [];
  try { entries = readZip(bundleBuf).filter((e) => !e.dir); } catch (e) { return { problems: ['bundle.zip cannot be read: ' + e.message], files: [], sums: {} }; }
  const want = Object.keys(sources).sort();
  const names = entries.map((e) => e.name).sort();
  for (const n of names) if (!want.includes(n)) problems.push('bundle.zip holds a file that is not part of the extension: ' + n);
  for (const n of want) if (!names.includes(n)) problems.push('bundle.zip does not hold ' + n);
  if (names.length !== new Set(names).size) problems.push('bundle.zip holds a file more than once');
  const sums = {};
  const files = [];
  for (const n of want) {
    const e = entries.find((x) => x.name === n);
    if (!e) continue;
    const src = sources[n];
    if (!src.equals(e.data)) problems.push(n + ' in bundle.zip is not the same bytes as the file in extension/ (' + e.data.length + ' and ' + src.length + ' bytes)');
    if (/\.(js|css)$/.test(n) && /sourceMappingURL/.test(e.data.toString('utf8'))) problems.push(n + ' carries a source map reference');
    sums[n] = sha256(e.data);
    files.push({ name: n, data: e.data });
  }
  if (names.some((n) => /\.map$/.test(n))) problems.push('bundle.zip holds a source map');
  const manifest = entries.find((x) => x.name === 'webflow.json');
  if (manifest) {
    let m = null;
    try { m = JSON.parse(manifest.data.toString('utf8')); } catch (e) { problems.push('webflow.json in bundle.zip is not JSON'); }
    if (m && JSON.stringify(m) !== JSON.stringify(MANIFEST)) problems.push('webflow.json in bundle.zip is not the manifest of the repository: ' + JSON.stringify(m));
  }
  return { problems, files, sums };
}

function main() {
  const bundlePath = path.join(EXT, 'bundle.zip');
  const reviewPath = path.join(EXT, 'review.zip');
  if (!fs.existsSync(bundlePath)) { console.error('extension/bundle.zip is missing. Run: cd extension && npx @webflow/webflow-cli extension bundle'); process.exit(1); }
  const bundle = fs.readFileSync(bundlePath);
  const sources = Object.fromEntries(Object.entries(SOURCES).map(([n, f]) => [n, fs.readFileSync(f)]));
  const { problems, files, sums } = checkBundle(bundle, sources);
  if (problems.length) {
    console.error('The bundle may not be submitted:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  const readme = fs.readFileSync(path.join(EXT, 'README.md'));
  const review = writeZip(files.concat([{ name: 'README.md', data: readme }]));
  // read it back: what was written is what was meant
  const back = readZip(review);
  for (const f of files) if (!back.find((b) => b.name === f.name).data.equals(f.data)) { console.error('review.zip did not come out right: ' + f.name); process.exit(1); }
  fs.writeFileSync(reviewPath, review);
  console.log('bundle.zip   ' + bundle.length + ' bytes   SHA-256 ' + sha256(bundle));
  console.log('review.zip   ' + review.length + ' bytes   SHA-256 ' + sha256(review));
  for (const n of Object.keys(sums).sort()) console.log('  ' + n.padEnd(40) + String(sources[n].length).padStart(6) + ' bytes   SHA-256 ' + sums[n] + '   (the same in bundle.zip, review.zip and extension/)');
  console.log('  README.md    ' + readme.length + ' bytes   SHA-256 ' + sha256(readme) + '   (review.zip only)');
}

if (require.main === module) main();
module.exports = { readZip, writeZip, checkBundle, crc32, SOURCES, MANIFEST, MAX_BUNDLE_BYTES };
