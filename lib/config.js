import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const FILES_DIR = path.join(DATA_DIR, 'files');
export const TMP_DIR = path.join(DATA_DIR, 'tmp');
export const LIB_FILE = path.join(DATA_DIR, 'library.json');
export const PUBLIC_DIR = path.join(ROOT, 'public');
// 配置跟数据放在一起，容器部署时只要挂载 data 一个目录就够了
export const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
export const LEGACY_CONFIG_FILE = path.join(ROOT, 'config.json');

export const DEFAULT_CONFIG = {
  port: 8899,
  // Kindle 上支持的格式（azw3 对 Oasis 2 的排版支持最好）
  targetFormat: 'azw3',
  // Calibre 输出设备配置，Oasis 2 用 kindle_oasis
  outputProfile: 'kindle_oasis',
  autoConvert: true,
  // 留空则自动在 PATH / tools 目录查找转换引擎
  // kindling 优先（17MB 单文件），没有才用 calibre（约 570MB）
  kindlingPath: '',
  // 留空则自动在 PATH / 常见安装位置查找 ebook-convert
  calibrePath: '',
  maxFileSizeMB: 500,
  // 转换完成后保留原始 epub
  keepOriginal: true,
  // 对外访问地址，例如 http://192.168.1.10:8899
  // 部署在 Docker/NAS 时填上，页面和二维码才不会显示容器内网 IP
  publicUrl: ''
};

for (const dir of [DATA_DIR, FILES_DIR, TMP_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

// 老版本配置在项目根目录，自动迁移到 data/ 下
function migrateLegacyConfig() {
  if (fs.existsSync(CONFIG_FILE) || !fs.existsSync(LEGACY_CONFIG_FILE)) return;
  try {
    const raw = fs.readFileSync(LEGACY_CONFIG_FILE, 'utf8');
    JSON.parse(raw);
    fs.writeFileSync(CONFIG_FILE, raw, 'utf8');
  } catch {
    /* 旧文件损坏就忽略，用默认值 */
  }
}

export function loadConfig() {
  migrateLegacyConfig();
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    cfg = {};
  }
  const merged = { ...DEFAULT_CONFIG, ...cfg };

  // Docker 部署时用环境变量覆盖，避免进容器改文件
  if (process.env.PUBLIC_URL) merged.publicUrl = process.env.PUBLIC_URL.trim();
  if (process.env.CALIBRE_PATH) merged.calibrePath = process.env.CALIBRE_PATH.trim();
  if (process.env.AUTO_CONVERT !== undefined) {
    merged.autoConvert = String(process.env.AUTO_CONVERT).toLowerCase() !== 'false';
  }
  if (process.env.KEEP_ORIGINAL !== undefined) {
    merged.keepOriginal = String(process.env.KEEP_ORIGINAL).toLowerCase() !== 'false';
  }

  if (!fs.existsSync(CONFIG_FILE)) saveConfig(merged);
  return merged;
}

export function saveConfig(patch) {
  const current = (() => {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {
      return {};
    }
  })();
  const next = { ...DEFAULT_CONFIG, ...current, ...patch };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export const SUPPORTED_INPUT = ['epub', 'mobi', 'azw3', 'azw', 'pdf', 'txt', 'kfx'];
export const KINDLE_NATIVE = ['mobi', 'azw3', 'azw', 'pdf', 'txt'];
export const NEEDS_CONVERT = ['epub', 'kfx', 'docx', 'fb2', 'rtf'];

export const CONTENT_TYPES = {
  epub: 'application/epub+zip',
  mobi: 'application/x-mobipocket-ebook',
  azw: 'application/x-mobipocket-ebook',
  azw3: 'application/vnd.amazon.ebook',
  kfx: 'application/octet-stream',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};
