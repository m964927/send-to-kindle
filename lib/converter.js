import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, ROOT } from './config.js';

let detected = null; // { available, engine, name, bin, version, checkedAt }

/* ---------------- 引擎探测 ---------------- */

function kindlingCandidates() {
  const cfg = loadConfig();
  const exe = process.platform === 'win32' ? 'kindling.exe' : 'kindling';
  const list = [];
  const raw = (cfg.kindlingPath || '').trim();
  if (raw) list.push(raw);
  if (process.env.KINDLING_BIN) list.push(process.env.KINDLING_BIN);
  list.push(
    path.join(ROOT, 'tools', exe),
    path.join(ROOT, 'tools', 'kindling', exe),
    exe,
    'kindling-cli'
  );
  return [...new Set(list.filter(Boolean))];
}

function calibreCandidates() {
  const cfg = loadConfig();
  const list = [];
  const raw = (cfg.calibrePath || '').trim();
  if (raw) {
    if (/ebook-convert(\.exe)?$/i.test(raw)) list.push(raw);
    else list.push(path.join(raw, process.platform === 'win32' ? 'ebook-convert.exe' : 'ebook-convert'));
  }
  if (process.env.EBOOK_CONVERT) list.push(process.env.EBOOK_CONVERT);
  if (process.platform === 'win32') {
    list.push(
      'C:\\Program Files\\Calibre2\\ebook-convert.exe',
      'C:\\Program Files (x86)\\Calibre2\\ebook-convert.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Calibre2', 'ebook-convert.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'calibre', 'ebook-convert.exe'),
      path.join(ROOT, 'tools', 'calibre', 'ebook-convert.exe'),
      path.join(ROOT, 'tools', 'calibre', 'Calibre', 'ebook-convert.exe'),
      path.join(ROOT, 'tools', 'Calibre Portable', 'Calibre', 'ebook-convert.exe')
    );
  } else {
    list.push('/usr/bin/ebook-convert', '/usr/local/bin/ebook-convert', '/opt/calibre/ebook-convert');
  }
  list.push('ebook-convert');
  return [...new Set(list.filter(Boolean))];
}

function probe(bin, args = ['--version']) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      resolve({ ok, out });
    };
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true });
    } catch {
      return finish(false);
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(false);
    }, 8000);
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (out += d.toString()));
    child.on('error', () => {
      clearTimeout(timer);
      finish(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish(code === 0 || !!out.trim());
    });
  });
}

/**
 * 优先用 kindling（17MB 单文件），没有才退回 Calibre（约 570MB）。
 * 两者对 EPUB→AZW3 的效果都在 Oasis 上验证过。
 */
export async function detectEngine(force = false) {
  if (detected && !force) return detected;

  for (const bin of kindlingCandidates()) {
    const { ok, out } = await probe(bin);
    if (!ok) continue;
    const version = (out.match(/kindling\s+v?([\d.]+)/i) || out.match(/([\d]+\.[\d.]+)/) || [])[1] || 'unknown';
    detected = { available: true, engine: 'kindling', name: 'Kindling', bin, version, checkedAt: Date.now() };
    return detected;
  }

  for (const bin of calibreCandidates()) {
    const { ok, out } = await probe(bin);
    if (!ok) continue;
    const version = (out.match(/calibre[^\d]*([\d.]+)/i) || out.match(/([\d]+\.[\d.]+)/) || [])[1] || 'unknown';
    detected = { available: true, engine: 'calibre', name: 'Calibre', bin, version, checkedAt: Date.now() };
    return detected;
  }

  detected = { available: false, engine: null, name: null, bin: null, version: null, checkedAt: Date.now() };
  return detected;
}

// 兼容旧调用名
export const detectCalibre = detectEngine;

export function resetDetection() {
  detected = null;
}

/* ---------------- 转换 ---------------- */

function runProcess(bin, args, { onLine, timeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true });
    } catch (err) {
      return reject(err);
    }
    let buf = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      try { child.kill(); } catch {}
    }, timeoutMs);

    const onData = (chunk) => {
      buf = (buf + chunk.toString()).slice(-8000);
      if (onLine) {
        for (const line of chunk.toString().split(/\r?\n/)) {
          if (line.trim()) onLine(line.trim());
        }
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) return reject(new Error('转换超时（超过 15 分钟）'));
      if (code === 0) return resolve();
      const tail = buf.split('\n').filter(Boolean).slice(-5).join(' ');
      reject(new Error(`转换失败（exit ${code}）：${tail || '未知错误'}`));
    });
  });
}

async function convertWithKindling(engine, { input, output, onProgress }) {
  const args = [
    'build',
    input,
    '-o',
    output,
    // 不把原始 EPUB 塞进 AZW3（否则体积会翻 3-4 倍），也不保留 HD 原图容器
    '--no-embed-source',
    '--no-hd-images',
    // kindling 默认 --doc-type none，不写 EXTH 501（CDE Type=EBOK）和 EXTH 113（ASIN）。
    // 这两个字段是 Kindle 固件给书建封面缓存和锁屏缩略图的依据，缺了就在书架里
    // 显示灰色占位。kindling 官方说明：writing EXTH 501 also writes an EXTH 113
    // identifier, and that pair is what lets the firmware store a cover for the book.
    '--doc-type',
    'ebok',
    // kindling 默认按「亚马逊 KDP 出版规范」校验，一旦有 error 就 abort。
    // 那些规则是给要上架 Kindle 书店的书用的，自用转档完全不需要，
    // 常见的 Z-Library 等来源书籍几乎都会中招（重复 HTML 封面页、NCX uid 不匹配、
    // @font-face 引用了不在 manifest 里的字体）。跳过校验后这些都能正常转，
    // kindling 自己还会顺手修掉重复封面。
    '--no-validate'
  ];

  await runProcess(engine.bin, args, {
    onLine: (line) => {
      if (!onProgress) return;
      if (/^Collected .*images/i.test(line)) onProgress(40);
      else if (/^Building KF8/i.test(line)) onProgress(70);
      else if (/^Wrote /i.test(line)) onProgress(95);
    }
  });

  if (!fs.existsSync(output)) throw new Error('转换未产出文件');
  return { ok: true, size: fs.statSync(output).size, engine: 'kindling' };
}

async function convertWithCalibre(engine, { input, output, targetFormat, onProgress }) {
  const cfg = loadConfig();
  const args = [input, output];
  if (cfg.outputProfile && targetFormat === 'azw3') args.push('--output-profile', cfg.outputProfile);

  let lastPct = 0;
  const onLine = (line) => {
    const m = line.match(/(\d{1,3})%/);
    if (!m || !onProgress) return;
    const pct = parseInt(m[1], 10);
    if (pct > lastPct) {
      lastPct = pct;
      onProgress(Math.min(99, pct));
    }
  };

  try {
    await runProcess(engine.bin, args, { onLine });
  } catch (err) {
    // 老版本 Calibre 不认识 kindle_oasis 时，退回不带 profile 重试一次
    if (/unknown|invalid|profile/i.test(err.message) && args.includes('--output-profile')) {
      await runProcess(engine.bin, [input, output], { onLine });
    } else {
      throw err;
    }
  }

  if (!fs.existsSync(output)) throw new Error('转换未产出文件');
  return { ok: true, size: fs.statSync(output).size, engine: 'calibre' };
}

/**
 * 转换电子书。kindling 只吃 EPUB/OPF，其它输入自动交给 Calibre。
 * @returns {Promise<{ok:boolean, size:number, engine:string}>}
 */
export async function convert({ input, output, targetFormat, onProgress }) {
  const engine = await detectEngine();
  if (!engine.available) throw new Error('未检测到转换引擎（Kindling 或 Calibre）');

  const isEpub = /\.epub$/i.test(input);
  if (engine.engine === 'kindling' && isEpub) {
    return convertWithKindling(engine, { input, output, onProgress });
  }

  if (engine.engine === 'kindling' && !isEpub) {
    const fallback = await detectCalibreOnly();
    if (!fallback) throw new Error('Kindling 仅支持 EPUB，转换其它格式需要安装 Calibre');
    return convertWithCalibre(fallback, { input, output, targetFormat, onProgress });
  }

  return convertWithCalibre(engine, { input, output, targetFormat, onProgress });
}

async function detectCalibreOnly() {
  for (const bin of calibreCandidates()) {
    const { ok, out } = await probe(bin);
    if (!ok) continue;
    const version = (out.match(/calibre[^\d]*([\d.]+)/i) || out.match(/([\d]+\.[\d.]+)/) || [])[1] || 'unknown';
    return { available: true, engine: 'calibre', name: 'Calibre', bin, version, checkedAt: Date.now() };
  }
  return null;
}

export function hostInfo() {
  const nets = os.networkInterfaces();
  const lan = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) lan.push(net.address);
    }
  }
  return { hostname: os.hostname(), lan };
}
