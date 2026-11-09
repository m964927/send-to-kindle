import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { LIB_FILE } from './config.js';

let cache = null;

function read() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(LIB_FILE, 'utf8'));
    cache = { files: Array.isArray(raw.files) ? raw.files : [] };
  } catch {
    cache = { files: [] };
  }
  return cache;
}

function write() {
  const db = read();
  const tmp = LIB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, LIB_FILE);
  return db;
}

export function all() {
  // 统一按加入时间倒序：最近上传的永远在最前面
  return read().files.slice().sort((a, b) => {
    const ta = a.createdAt || a.updatedAt || 0;
    const tb = b.createdAt || b.updatedAt || 0;
    return tb - ta;
  });
}

export function get(id) {
  return read().files.find((f) => f.id === id) || null;
}

/** 按文件内容哈希查找，用于上传去重（同一个文件传两次只留一条） */
export function findByHash(hash) {
  if (!hash) return null;
  return read().files.find((f) => f.hash === hash) || null;
}

export function add(record) {
  const db = read();
  db.files.unshift(record);
  write();
  return record;
}

export function update(id, patch) {
  const db = read();
  const rec = db.files.find((f) => f.id === id);
  if (!rec) return null;
  Object.assign(rec, patch, { updatedAt: Date.now() });
  write();
  return rec;
}

export function remove(id) {
  const db = read();
  const idx = db.files.findIndex((f) => f.id === id);
  if (idx === -1) return null;
  const [rec] = db.files.splice(idx, 1);
  write();
  return rec;
}

export function newId() {
  return crypto.randomBytes(5).toString('hex');
}

/** 选出最适合 Kindle 的版本：azw3 > azw > mobi > pdf > txt > 其它 */
const PRIORITY = ['azw3', 'azw', 'mobi', 'pdf', 'txt'];

export function pickBest(rec) {
  const files = rec.files || [];
  for (const fmt of PRIORITY) {
    const hit = files.find((f) => f.format === fmt);
    if (hit) return hit;
  }
  return files[0] || null;
}

export function needsConversion(rec) {
  const best = pickBest(rec);
  return !best || !PRIORITY.includes(best.format);
}
