/**
 * 从电子书里抠出「封面图 + 书名 + 作者」。
 *
 * 刻意不引第三方依赖：EPUB 就是个 ZIP，用 zlib 自己拆；
 * AZW3/MOBI 是 PalmDB 容器，按记录表 + MOBI 头 + EXTH 直接读。
 * 放在这里而不是交给转换引擎，是因为上传完立刻就要在页面上显示封面，
 * 不能等 kindling 慢慢转完。
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'"
};

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function safeChar(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** OPF 里的文本可能带内联标签和多余空白，统一压成一行 */
function tidy(s) {
  return decodeEntities(String(s || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function pickTag(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = re.exec(xml);
  return m ? tidy(m[1]) : '';
}

/** 按文件头判断图片类型，比看扩展名可靠 */
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/* ------------------------------------------------------------------ */
/* ZIP（EPUB 容器）                                                     */
/* ------------------------------------------------------------------ */

function readZipIndex(buf) {
  const min = Math.max(0, buf.length - 70000);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  const count = buf.readUInt16LE(eocd + 10);
  const cdOff = buf.readUInt32LE(eocd + 16);
  const entries = new Map();

  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name.toLowerCase(), { method, compSize, lho });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return entries;
}

function readZipEntry(buf, entries, name) {
  const e = entries.get(String(name).replace(/^\/+/, '').toLowerCase());
  if (!e) return null;
  const { method, compSize, lho } = e;
  if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x04034b50) return null;

  const nameLen = buf.readUInt16LE(lho + 26);
  const extraLen = buf.readUInt16LE(lho + 28);
  const start = lho + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, Math.min(start + compSize, buf.length));

  try {
    if (method === 0) return raw;
    if (method === 8) return zlib.inflateRawSync(raw);
  } catch {
    return null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* EPUB                                                                 */
/* ------------------------------------------------------------------ */

function resolveHref(opfPath, href) {
  // OPF 里的 href 是相对 OPF 自身位置；顺带处理 ../ 和 URL 编码
  const clean = decodeURIComponent(String(href || '').split('#')[0].trim());
  const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const parts = (baseDir + clean).split('/');
  const out = [];
  for (const seg of parts) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

function readEpub(buf) {
  const entries = readZipIndex(buf);
  if (!entries) return null;

  const container = readZipEntry(buf, entries, 'META-INF/container.xml');
  let opfPath = '';
  if (container) {
    const m = /full-path\s*=\s*["']([^"']+)["']/i.exec(container.toString('utf8'));
    if (m) opfPath = decodeURIComponent(m[1]);
  }
  if (!opfPath) {
    // 没有 container.xml 的野生 EPUB：直接找任意 .opf
    for (const key of entries.keys()) {
      if (key.endsWith('.opf')) { opfPath = key; break; }
    }
  }
  if (!opfPath) return null;

  const opfBuf = readZipEntry(buf, entries, opfPath);
  if (!opfBuf) return null;
  const opf = opfBuf.toString('utf8');

  const title = pickTag(opf, 'dc:title') || pickTag(opf, 'title');
  // 多作者时 dc:creator 会有多个，取第一个
  const author = pickTag(opf, 'dc:creator') || pickTag(opf, 'dc:author');

  // 1) EPUB2 的 <meta name="cover" content="封面item的id">
  // 2) EPUB3 的 properties="cover-image"
  // 3) 兜底：manifest 里名字含 cover 的图片
  const items = [];
  const itemRe = /<item\b([^>]*)\/?>/gi;
  let im;
  while ((im = itemRe.exec(opf))) {
    const attrs = im[1];
    const get = (n) => {
      const r = new RegExp(`${n}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrs);
      return r ? r[1] : '';
    };
    items.push({
      id: get('id'),
      href: get('href'),
      type: get('media-type'),
      props: get('properties')
    });
  }

  let coverItem = null;
  const metaCover = /<meta\b[^>]*name\s*=\s*["']cover["'][^>]*content\s*=\s*["']([^"']*)["']/i.exec(opf)
    || /<meta\b[^>]*content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']cover["']/i.exec(opf);
  if (metaCover) {
    coverItem = items.find((it) => it.id === metaCover[1] && /image\//i.test(it.type)) || null;
  }
  if (!coverItem) {
    coverItem = items.find((it) => /cover-image/i.test(it.props)) || null;
  }
  if (!coverItem) {
    coverItem = items.find(
      (it) => /image\//i.test(it.type) && /cover/i.test(`${it.id} ${it.href}`)
    ) || null;
  }

  let cover = null;
  if (coverItem && coverItem.href) {
    const data = readZipEntry(buf, entries, resolveHref(opfPath, coverItem.href));
    if (data && sniffImage(data)) cover = { buffer: data, ext: sniffImage(data) };
  }

  return { title, author, cover };
}

/* ------------------------------------------------------------------ */
/* MOBI / AZW3                                                          */
/* ------------------------------------------------------------------ */

function readMobi(buf) {
  const numRecords = buf.readUInt16BE(76);
  if (!numRecords || numRecords > 100000) return null;

  const offsets = [];
  for (let i = 0; i < numRecords; i++) {offsets.push(buf.readUInt32BE(78 + i * 8));}
  offsets.push(buf.length);

  const rec0 = buf.subarray(offsets[0], offsets[1]);
  const mobiOff = 16;
  if (rec0.toString('latin1', mobiOff, mobiOff + 4) !== 'MOBI') return null;

  const mobiLen = rec0.readUInt32BE(mobiOff + 4);
  const textEnc = rec0.readUInt32BE(mobiOff + 0x0c);

  const exth = {};
  const exthOff = mobiOff + mobiLen;
  if (rec0.toString('latin1', exthOff, exthOff + 4) === 'EXTH') {
    const count = rec0.readUInt32BE(exthOff + 8);
    let pos = exthOff + 12;
    for (let i = 0; i < count && pos + 8 <= rec0.length; i++) {
      const type = rec0.readUInt32BE(pos);
      const len = rec0.readUInt32BE(pos + 4);
      if (len < 8) break;
      exth[type] = rec0.subarray(pos + 8, pos + len);
      pos += len;
    }
  }

  const str = (t) => {
    const d = exth[t];
    if (!d) return '';
    return tidy(d.toString(textEnc === 65001 ? 'utf8' : 'latin1'));
  };

  const title = str(503) || str(504);
  const author = str(100);

  // 图片记录：EXTH 201 是「相对第一张图片的偏移」，所以要先把图片记录按顺序收集起来
  const images = [];
  for (let i = 1; i < numRecords; i++) {
    const s = offsets[i];
    const e = offsets[i + 1];
    if (!e || e - s < 64) continue;
    if (sniffImage(buf.subarray(s, s + 12))) images.push(i);
  }

  let coverBuf = null;
  const coverOff = exth[201] && exth[201].length >= 4 ? exth[201].readUInt32BE(0) : -1;
  if (coverOff >= 0 && images[coverOff] !== undefined) {
    coverBuf = buf.subarray(offsets[images[coverOff]], offsets[images[coverOff] + 1]);
  }
  if (!sniffImage(coverBuf)) {
    const thumbOff = exth[202] && exth[202].length >= 4 ? exth[202].readUInt32BE(0) : -1;
    coverBuf = thumbOff >= 0 && images[thumbOff] !== undefined
      ? buf.subarray(offsets[images[thumbOff]], offsets[images[thumbOff] + 1])
      : null;
  }
  if (!sniffImage(coverBuf)) {
    // 最后兜底：第一张图片通常就是封面
    coverBuf = images.length
      ? buf.subarray(offsets[images[0]], offsets[images[0] + 1])
      : null;
  }

  const ext = sniffImage(coverBuf);
  return {
    title,
    author,
    cover: ext ? { buffer: coverBuf, ext } : null
  };
}

/* ------------------------------------------------------------------ */
/* 对外                                                                 */
/* ------------------------------------------------------------------ */

const EXTRACTABLE = new Set(['epub', 'mobi', 'azw3', 'azw']);
const MAX_READ = 120 * 1024 * 1024;

/**
 * @returns {{ title: string, author: string, cover: { buffer: Buffer, ext: string } | null }}
 */
export function extractMeta(filePath, format) {
  const empty = { title: '', author: '', cover: null };
  const fmt = String(format || '').toLowerCase();
  if (!EXTRACTABLE.has(fmt)) return empty;

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return empty;
  }
  if (!stat.size || stat.size > MAX_READ) return empty;

  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch {
    return empty;
  }

  try {
    const got = fmt === 'epub' ? readEpub(buf) : readMobi(buf);
    if (!got) return empty;
    return { title: got.title || '', author: got.author || '', cover: got.cover || null };
  } catch {
    // 损坏/加密的书不该把整条流程拖挂，拿不到就是拿不到
    return empty;
  }
}
