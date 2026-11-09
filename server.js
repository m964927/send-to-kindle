import express from 'express';
import busboy from 'busboy';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import QRCode from 'qrcode';
import {
  loadConfig, saveConfig, PUBLIC_DIR, FILES_DIR, TMP_DIR,
  SUPPORTED_INPUT, CONTENT_TYPES, NEEDS_CONVERT
} from './lib/config.js';
import * as store from './lib/store.js';
import { detectEngine, resetDetection, convert, hostInfo } from './lib/converter.js';
import { detectPrimaryIps, getPreferred } from './lib/net.js';
import { renderKindlePage, renderDownloadQueue } from './lib/kindle.js';

const app = express();
const PORT = Number(process.env.PORT || loadConfig().port || 8899);

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR, { maxAge: 0 }));

/* ---------------- 工具函数 ---------------- */

const FMT_LABEL = {
  epub: 'EPUB', mobi: 'MOBI', azw3: 'AZW3', azw: 'AZW',
  pdf: 'PDF', txt: 'TXT', kfx: 'KFX', docx: 'DOCX'
};

function fmtBytes(n) {
  if (!n && n !== 0) return '-';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function cleanName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function titleFromName(filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  return cleanName(base.replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ')) || '未命名';
}

function localUrls() {
  const { lan, hostname } = hostInfo();

  // 容器里 os.networkInterfaces() 拿到的是 172.x 网桥地址，Kindle 访问不到，
  // 所以支持用环境变量 / 配置项指定对外地址
  const cfg = loadConfig();
  const override = String(process.env.PUBLIC_URL || cfg.publicUrl || '')
    .trim()
    .replace(/\/+$/, '');
  // 回环地址对 Kindle 没有意义（127.0.0.1 指的是 Kindle 自己），当作没配
  const usable = override && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(override);
  if (usable) {
    return { hostname, primary: override, all: [override], kindle: `${override}/k` };
  }

  const score = (ip) => {
    if (/^192\.168\./.test(ip)) return 0;
    if (/^10\./.test(ip)) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
    return 3;
  };
  const preferred = getPreferred();
  const list = lan
    .filter((ip) => !/^169\.254\./.test(ip))
    .sort((a, b) => {
      const pa = preferred.indexOf(a);
      const pb = preferred.indexOf(b);
      if (pa !== pb) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
      return score(a) - score(b);
    });

  const primary = list[0] ? `http://${list[0]}:${PORT}` : `http://localhost:${PORT}`;
  return {
    hostname,
    primary,
    all: list.map((ip) => `http://${ip}:${PORT}`),
    kindle: primary + '/k'
  };
}

/* ---------------- 转换队列 ---------------- */

const jobQueue = [];
let jobRunning = false;

function enqueueConversion(rec, targetFormat) {
  jobQueue.push({ id: rec.id, targetFormat });
  pump();
}

async function pump() {
  if (jobRunning) return;
  jobRunning = true;
  while (jobQueue.length) {
    const job = jobQueue.shift();
    const rec = store.get(job.id);
    if (!rec) continue;

    const source = (rec.files || []).find((f) => f.disk && CONTENT_TYPES[f.format]);
    if (!source) {
      store.update(job.id, { status: 'failed', error: '找不到源文件' });
      continue;
    }

    const cfg = loadConfig();
    const inPath = path.join(FILES_DIR, source.disk);
    const outDisk = `${rec.id}_c.${job.targetFormat}`;
    const outPath = path.join(FILES_DIR, outDisk);

    store.update(job.id, { status: 'converting', progress: 0, error: null });

    try {
      const result = await convert({
        input: inPath,
        output: outPath,
        targetFormat: job.targetFormat,
        onProgress: (pct) => store.update(job.id, { progress: pct })
      });

      const fresh = store.get(job.id);
      const keptFiles = (fresh.files || []).filter((f) => f.format !== job.targetFormat);
      const newEntry = {
        format: job.targetFormat,
        name: `${fresh.title}.${job.targetFormat}`,
        size: result.size,
        disk: outDisk,
        convertedAt: Date.now()
      };
      store.update(job.id, {
        status: 'ready',
        progress: 100,
        files: [...keptFiles, newEntry],
        bestFormat: job.targetFormat
      });

      // 不需要保留原文件时，删掉 epub 释放空间
      if (!cfg.keepOriginal) {
        const cover = fresh.files.some((f) => f.format === 'epub');
        if (cover) {
          try { fs.unlinkSync(inPath); } catch {}
          const after = store.get(job.id);
          store.update(job.id, { files: (after.files || []).filter((f) => f.disk !== source.disk) });
        }
      }
      console.log(`[转换完成] ${fresh.title} → ${job.targetFormat} (${fmtBytes(result.size)})`);
    } catch (err) {
      console.error(`[转换失败] ${rec.title}: ${err.message}`);
      store.update(job.id, { status: 'failed', error: err.message, progress: 0 });
      try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {}
    }
  }
  jobRunning = false;
}

/* ---------------- 页面 ---------------- */

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/k', (req, res) => {
  const q = String(req.query.q || '').trim();
  const all = store.all().filter((f) => (f.files || []).length > 0);
  const list = q
    ? all.filter((f) => (f.title + ' ' + f.originalName).toLowerCase().includes(q.toLowerCase()))
    : all;

  const items = list.map((rec) => {
    const best = store.pickBest(rec);
    return {
      id: rec.id,
      title: rec.title,
      format: best ? best.format : rec.format,
      label: best ? (FMT_LABEL[best.format] || best.format.toUpperCase()) : '?',
      size: best ? fmtBytes(best.size) : '-',
      href: `/d/${rec.id}`,
      needConvert: best ? !['mobi', 'azw3', 'azw', 'pdf', 'txt'].includes(best.format) : true,
      converting: rec.status === 'converting',
      selectable: rec.status !== 'converting'
    };
  });

  const msg = String(req.query.msg || '') === 'none' ? '没有选中任何书，请先勾选' : '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(renderKindlePage({ items, total: all.length, q, msg }));
});

// 批量下载：勾选多本 → 中间页依次触发；只勾一本就直接下载
app.get('/k/download', (req, res) => {
  let ids = req.query.id;
  if (!ids) ids = [];
  else if (!Array.isArray(ids)) ids = [ids];

  const books = [];
  for (const id of ids) {
    const rec = store.get(String(id));
    if (!rec || !(rec.files || []).length) continue;
    const best = store.pickBest(rec);
    if (!best) continue;
    books.push({
      id: rec.id,
      title: rec.title,
      label: FMT_LABEL[best.format] || best.format.toUpperCase(),
      size: fmtBytes(best.size),
      href: `/d/${rec.id}`
    });
  }

  if (!books.length) return res.redirect('/k?msg=none');
  if (books.length === 1) return res.redirect(books[0].href);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(renderDownloadQueue({ books }));
});

/* ---------------- API ---------------- */

app.get('/api/info', async (req, res) => {
  const cfg = loadConfig();
  const calibre = await detectEngine();
  res.json({
    urls: localUrls(),
    port: PORT,
    engine: { available: calibre.available, name: calibre.name, version: calibre.version, bin: calibre.bin },
    // 兼容旧字段名
    calibre: { available: calibre.available, version: calibre.version, bin: calibre.bin },
    config: {
      autoConvert: cfg.autoConvert,
      publicUrl: cfg.publicUrl,
      kindlingPath: cfg.kindlingPath,
      calibrePath: cfg.calibrePath,
      targetFormat: cfg.targetFormat,
      keepOriginal: cfg.keepOriginal
    },
    supported: SUPPORTED_INPUT
  });
});

app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 500);
  if (!text) return res.status(400).end();
  try {
    const buf = await QRCode.toBuffer(text, {
      type: 'png', width: 480, margin: 1,
      color: { dark: '#111318', light: '#ffffff' }
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(buf);
  } catch {
    res.status(500).end();
  }
});

app.get('/api/files', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  let list = store.all();
  if (q) list = list.filter((f) => (f.title + ' ' + f.originalName).toLowerCase().includes(q));

  res.json({
    files: list.map((rec) => {
      const best = store.pickBest(rec);
      return {
        id: rec.id,
        title: rec.title,
        originalName: rec.originalName,
        size: best ? best.size : rec.size,
        sizeLabel: fmtBytes(best ? best.size : rec.size),
        format: best ? best.format : rec.format,
        formats: (rec.files || []).map((f) => ({
          format: f.format,
          label: FMT_LABEL[f.format] || f.format.toUpperCase(),
          sizeLabel: fmtBytes(f.size),
          href: `/d/${rec.id}/${f.format}`
        })),
        status: rec.status || 'ready',
        progress: rec.progress || 0,
        error: rec.error || null,
        createdAt: rec.createdAt,
        href: `/d/${rec.id}`,
        kindleReady: best ? ['mobi', 'azw3', 'azw', 'pdf', 'txt'].includes(best.format) : false
      };
    })
  });
});

app.post('/api/upload', (req, res) => {
  const cfg = loadConfig();
  const maxBytes = Number(cfg.maxFileSizeMB) * 1024 * 1024;

  let bb;
  try {
    bb = busboy({
      headers: req.headers,
      defParamCharset: 'utf8',
      limits: { fileSize: maxBytes, files: 20 }
    });
  } catch {
    return res.status(400).json({ error: '上传请求格式不正确' });
  }

  const created = [];
  const duplicates = [];
  const errors = [];
  const uploads = [];

  bb.on('file', (_field, file, info) => {
    const originalName = cleanName(info.filename || 'unnamed');
    const ext = (path.extname(originalName).replace('.', '') || '').toLowerCase();

    if (!SUPPORTED_INPUT.includes(ext)) {
      errors.push(`${originalName}：不支持的格式 .${ext || '?'}`);
      file.resume();
      return;
    }

    const id = store.newId();
    const disk = `${id}.${ext}`;
    const tmpPath = path.join(TMP_DIR, disk);
    const finalPath = path.join(FILES_DIR, disk);

    const task = new Promise((resolve) => {
      const ws = fs.createWriteStream(tmpPath);
      let aborted = false;

      // 边写边算 sha256，用于判断"是不是同一个文件"
      const hash = crypto.createHash('sha256');
      const hasher = new Transform({
        transform(chunk, _enc, cb) {
          hash.update(chunk);
          cb(null, chunk);
        }
      });

      file.on('limit', () => {
        aborted = true;
        ws.destroy();
        try { fs.unlinkSync(tmpPath); } catch {}
        errors.push(`${originalName}：超过 ${cfg.maxFileSizeMB}MB 限制`);
        resolve();
      });

      file.on('error', () => {
        aborted = true;
        ws.destroy();
        try { fs.unlinkSync(tmpPath); } catch {}
        errors.push(`${originalName}：上传中断`);
        resolve();
      });

      ws.on('finish', () => {
        if (aborted) return;
        try {
          const size = fs.statSync(tmpPath).size;
          if (size === 0) {
            fs.unlinkSync(tmpPath);
            errors.push(`${originalName}：空文件`);
            return resolve();
          }

          // 内容完全相同的文件已经存在：丢掉这次上传，不新增记录
          const digest = hash.digest('hex');
          const dup = store.findByHash(digest);
          if (dup) {
            fs.unlinkSync(tmpPath);
            duplicates.push({ originalName, title: dup.title, id: dup.id });
            return resolve();
          }

          fs.renameSync(tmpPath, finalPath);

          const title = titleFromName(originalName);
          const rec = {
            id,
            title,
            originalName,
            format: ext,
            size,
            hash: digest,
            createdAt: Date.now(),
            files: [{ format: ext, name: `${title}.${ext}`, size, disk }],
            status: 'ready',
            progress: 100,
            error: null
          };

          // epub 等 Kindle 不支持的格式：登记为待转换
          if (NEEDS_CONVERT.includes(ext) && ext !== cfg.targetFormat) {
            rec.status = cfg.autoConvert ? 'converting' : 'pending';
            rec.progress = 0;
          }

          store.add(rec);
          created.push(rec);
        } catch (e) {
          errors.push(`${originalName}：${e.message}`);
        }
        resolve();
      });

      ws.on('error', () => {
        errors.push(`${originalName}：写入失败`);
        resolve();
      });

      file.pipe(hasher).pipe(ws);
    });

    uploads.push(task);
  });

  bb.on('error', () => {
    if (!res.headersSent) res.status(500).json({ error: '解析上传内容失败' });
  });

  bb.on('close', () => {
    Promise.all(uploads).then(async () => {
      const pending = created.filter((r) => store.get(r.id)?.status === 'converting');
      if (pending.length) {
        const cal = await detectEngine();
        for (const r of pending) {
          if (!cal.available) {
            // 没有转换工具时直接标记为待转换，避免出现假的“转换中”
            store.update(r.id, { status: 'pending', progress: 0, error: '未检测到转换引擎' });
            continue;
          }
          enqueueConversion(r, cfg.targetFormat || 'azw3');
        }
      }
      if (!res.headersSent) {
        res.json({
          ok: errors.length === 0,
          created: created.map((r) => ({ id: r.id, title: r.title, format: r.format })),
          duplicates,
          errors
        });
      }
    });
  });

  req.pipe(bb);
});

app.post('/api/files/:id/convert', async (req, res) => {
  const rec = store.get(req.params.id);
  if (!rec) return res.status(404).json({ error: '文件不存在' });
  if (rec.status === 'converting') return res.status(409).json({ error: '正在转换中' });

  const cal = await detectEngine();
  if (!cal.available) {
    return res.status(412).json({ error: '未检测到转换引擎（Kindling / Calibre），无法转换格式' });
  }

  const cfg = loadConfig();
  store.update(rec.id, { status: 'converting', progress: 0, error: null });
  enqueueConversion(rec, cfg.targetFormat || 'azw3');
  res.json({ ok: true });
});

app.delete('/api/files/:id', (req, res) => {
  const rec = store.remove(req.params.id);
  if (!rec) return res.status(404).json({ error: '文件不存在' });
  for (const f of rec.files || []) {
    try { fs.unlinkSync(path.join(FILES_DIR, f.disk)); } catch {}
  }
  res.json({ ok: true });
});

app.post('/api/config', async (req, res) => {
  const body = req.body || {};
  const patch = {};
  if (typeof body.enginePath === 'string') {
    const p = body.enginePath.trim();
    // 一个输入框同时接受 Kindling 与 Calibre 路径，按文件名分辨
    const isKindling = /kindling/i.test(path.basename(p));
    patch.kindlingPath = isKindling ? p : '';
    patch.calibrePath = isKindling ? '' : p;
  }
  if (typeof body.calibrePath === 'string') patch.calibrePath = body.calibrePath.trim();
  if (typeof body.kindlingPath === 'string') patch.kindlingPath = body.kindlingPath.trim();
  if (typeof body.publicUrl === 'string') patch.publicUrl = body.publicUrl.trim();
  if (typeof body.autoConvert === 'boolean') patch.autoConvert = body.autoConvert;
  if (typeof body.keepOriginal === 'boolean') patch.keepOriginal = body.keepOriginal;
  saveConfig(patch);
  resetDetection();
  const calibre = await detectEngine(true);
  res.json({
    ok: true,
    engine: { available: calibre.available, name: calibre.name, version: calibre.version, bin: calibre.bin },
    calibre: { available: calibre.available, version: calibre.version, bin: calibre.bin }
  });
});

/* ---------------- 下载 ---------------- */

app.get('/d/:id/:fmt?', (req, res) => {
  const rec = store.get(req.params.id);
  if (!rec) return res.status(404).send('文件不存在');

  const files = rec.files || [];
  const entry = req.params.fmt
    ? files.find((f) => f.format === String(req.params.fmt).toLowerCase())
    : store.pickBest(rec);

  if (!entry) return res.status(404).send('没有可下载的版本');

  const full = path.join(FILES_DIR, entry.disk);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    return res.status(410).send('文件已从服务器删除');
  }

  const filename = entry.name || `${rec.title}.${entry.format}`;
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");

  res.setHeader('Content-Type', CONTENT_TYPES[entry.format] || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'no-store');

  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (isNaN(start) || isNaN(end) || start > end || start >= stat.size) {
        res.setHeader('Content-Range', `bytes */${stat.size}`);
        return res.status(416).end();
      }
      end = Math.min(end, stat.size - 1);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Length', end - start + 1);
      return fs.createReadStream(full, { start, end }).pipe(res);
    }
  }

  fs.createReadStream(full).pipe(res);
});

/* ---------------- 启动 ---------------- */

/* 旧版本的书没有内容指纹，后台补算一次，让它们也能参与去重 */
async function backfillHashes() {
  const missing = store.all().filter((f) => !f.hash && (f.files || []).length);
  for (const rec of missing) {
    const disk = rec.files[0].disk;
    const p = path.join(FILES_DIR, disk);
    if (!fs.existsSync(p)) continue;
    try {
      const digest = await new Promise((resolve, reject) => {
        const h = crypto.createHash('sha256');
        fs.createReadStream(p)
          .on('data', (d) => h.update(d))
          .on('end', () => resolve(h.digest('hex')))
          .on('error', reject);
      });
      store.update(rec.id, { hash: digest });
    } catch {}
  }
  if (missing.length) {
    console.log(`  书库           已为 ${missing.length} 本旧书补算内容指纹（重复上传会自动跳过）`);
  }
}

async function onListen() {
  // 上次退出时卡在“转换中”的记录，重启后重置为待转换
  for (const f of store.all()) {
    if (f.status === 'converting') {
      store.update(f.id, { status: 'pending', progress: 0, error: '服务重启，需重新转换' });
    }
  }

  const urls = localUrls();
  const calibre = await detectEngine(true);

  // 容器里默认只能看到 172.x 网桥地址，对 Kindle 没有意义
  const bridgeOnly = /^http:\/\/172\.(1[7-9]|2\d|3[01])\./.test(urls.primary);

  console.log('\n  📚 Kindle 投递站已启动\n');
  if (bridgeOnly) {
    console.log('  电脑 / 手机上传   http://<NAS的局域网IP>:' + PORT);
    console.log('  Kindle 访问       http://<NAS的局域网IP>:' + PORT + '/k');
    console.log('  经 lucky 反代时   直接用你的域名 + /k');
    console.log('  说明              页面会自动显示你当前访问的地址，不需要配 PUBLIC_URL');
  } else {
    console.log(`  电脑 / 手机上传   ${urls.primary}`);
    console.log(`  Kindle 访问       ${urls.kindle}`);
    if (urls.all.length > 1) {
      console.log(`  其他网卡地址      ${urls.all.slice(1).join('  ')}`);
    }
  }
  console.log(
    calibre.available
      ? `  格式转换          ${calibre.name} ${calibre.version} 已就绪`
      : '  格式转换          未检测到 Kindling / Calibre（EPUB 无法转成 AZW3，见 README）'
  );
  console.log('\n  Kindle 能访问到这个地址即可（同一 Wi-Fi，或经反向代理的公网域名）\n');

  // 后台给旧书补指纹，不阻塞启动
  backfillHashes().catch(() => {});

  // PowerShell 首次启动偶尔会超时（杀软扫描等），失败就在后台补一次，
  // 之后的请求就能拿到正确的网卡地址
  if (!getPreferred().length && process.platform === 'win32' && !process.env.PUBLIC_URL) {
    setTimeout(() => {
      detectPrimaryIps().then((ips) => {
        if (ips.length) console.log(`  （已重新识别网卡，Kindle 地址应为 http://${ips[0]}:${PORT}/k）\n`);
      });
    }, 2000);
  }
}

detectPrimaryIps().then(() => {
  app.listen(PORT, '0.0.0.0', onListen);
});

process.on('uncaughtException', (err) => {
  console.error('[未捕获异常]', err);
});
