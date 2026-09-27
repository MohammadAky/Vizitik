'use strict';

// Data-only, versioned backups. Never execute SQL supplied by an upload. All
// deletes/inserts run on ONE connection in ONE transaction with FKs enabled.
const { promisify } = require('node:util');
const zlib = require('node:zlib');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const MAX_EXPANDED = 200 * 1024 * 1024;
const TABLES = Object.freeze([
  'users', 'products', 'user_products', 'customers', 'van_inventory',
  'orders', 'order_items', 'order_discount_steps', 'payments', 'checks',
  'customer_ledger', 'invoice_settings', 'invoice_counters',
]);
const quote = name => '`' + name.replace(/`/g, '``') + '`';
function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}
function encode(value) {
  if (value instanceof Date) return { type: 'date', value: value.toISOString() };
  if (value instanceof Uint8Array) return { type: 'bytes', value: Buffer.from(value).toString('base64') };
  if (typeof value === 'bigint') return { type: 'bigint', value: String(value) };
  if (value && value.constructor?.name === 'Decimal') return { type: 'decimal', value: value.toString() };
  return value;
}
function decode(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && Object.keys(value).sort().join() === 'type,value' && typeof value.value === 'string') {
    if (value.type === 'date' && /^\d{4}-\d\d-\d\dT/.test(value.value) && !isNaN(Date.parse(value.value))) return new Date(value.value);
    if (value.type === 'bigint' && /^-?\d+$/.test(value.value)) return BigInt(value.value);
    if (value.type === 'decimal' && /^-?\d+(\.\d+)?$/.test(value.value)) return value.value;
    if (value.type === 'bytes' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.value)) return Buffer.from(value.value, 'base64');
  }
  throw invalid('مقدار نامعتبر در فایل پشتیبان');
}
async function schema(tx) {
  const tables = await tx.$queryRawUnsafe('SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = \'BASE TABLE\'');
  // Refuse unknown tables rather than silently producing an incomplete backup.
  const names = tables.map(t => t.name).filter(n => n !== '_prisma_migrations');
  if (names.sort().join() !== [...TABLES].sort().join() || tables.some(t => TABLES.includes(t.name) && t.engine !== 'InnoDB')) {
    throw invalid('ساختار دیتابیس پشتیبانی نمی‌شود؛ همهٔ جدول‌های برنامه باید موجود و InnoDB باشند');
  }
  const result = {};
  for (const table of TABLES) {
    const cols = await tx.$queryRawUnsafe(`SHOW COLUMNS FROM ${quote(table)}`);
    result[table] = cols.map(c => ({ name: c.Field, type: c.Type, nullable: c.Null === 'YES' }));
  }
  return result;
}
async function snapshot(tx, structure) {
  const tables = {};
  for (const table of TABLES) {
    const rows = await tx.$queryRawUnsafe(`SELECT * FROM ${quote(table)}`);
    tables[table] = { columns: structure[table], rows: rows.map(row => structure[table].map(c => encode(row[c.name]))) };
  }
  const json = Buffer.from(JSON.stringify({ format: 'vizitik-data', version: 1, createdAt: new Date().toISOString(), tables }));
  if (json.length > MAX_EXPANDED) throw invalid('دیتابیس برای بکاپ پنل بزرگ است؛ از بکاپ خط فرمان استفاده کنید');
  const compressed = await gzip(json);
  if (compressed.length > 50 * 1024 * 1024) throw invalid('بکاپ از حد آپلود پنل بزرگ‌تر است؛ از بکاپ خط فرمان استفاده کنید');
  return compressed;
}
async function createBackup(prisma) {
  return prisma.$transaction(async tx => snapshot(tx, await schema(tx)), { isolationLevel: 'RepeatableRead', timeout: 120000, maxWait: 10000 });
}
async function parseBackup(buffer) {
  let doc;
  try {
    const raw = await gunzip(buffer, { maxOutputLength: MAX_EXPANDED });
    doc = JSON.parse(raw.toString('utf8'));
  } catch {
    throw invalid('فایل خراب یا نامعتبر است؛ فقط بکاپ جدید .vizitik.json.gz پذیرفته می‌شود. SQL/ZIP قدیمی را آفلاین بررسی کنید');
  }
  if (doc?.format !== 'vizitik-data' || doc.version !== 1 || !doc.tables || Object.keys(doc.tables).sort().join() !== [...TABLES].sort().join()) throw invalid('نسخه یا جدول‌های فایل پشتیبان نامعتبر است');
  for (const table of TABLES) {
    const data = doc.tables[table];
    if (!data || !Array.isArray(data.columns) || !Array.isArray(data.rows)) throw invalid('ساختار فایل پشتیبان نامعتبر است');
    // Decode every value before any database writes.
    data.rows = data.rows.map(row => {
      if (!Array.isArray(row) || row.length !== data.columns.length) throw invalid('تعداد ستون‌ها نامعتبر است');
      return row.map(decode);
    });
  }
  return doc;
}
async function saveSafetyBackup(buffer, directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const name = `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}.vizitik.json.gz`;
  const target = path.join(directory, name);
  // fsync before touching the database. Partial files never look like backups.
  const tmp = target + '.partial';
  try {
    const file = await fs.open(tmp, 'wx', 0o600);
    try { await file.writeFile(buffer); await file.sync(); } finally { await file.close(); }
    await fs.rename(tmp, target);
    const dir = await fs.open(directory, 'r');
    try { await dir.sync(); } finally { await dir.close(); }
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return name;
}
async function restoreBackup(prisma, buffer, directory) {
  const doc = await parseBackup(buffer);
  return prisma.$transaction(async tx => {
    const structure = await schema(tx);
    for (const table of TABLES) {
      if (JSON.stringify(doc.tables[table].columns) !== JSON.stringify(structure[table])) throw invalid(`ساختار جدول ${table} با بکاپ یکسان نیست؛ بازیابی متوقف شد`);
    }
    const safetyBackup = await saveSafetyBackup(await snapshot(tx, structure), directory);
    for (const table of [...TABLES].reverse()) await tx.$executeRawUnsafe(`DELETE FROM ${quote(table)}`);
    let rowCount = 0;
    for (const table of TABLES) {
      const { columns, rows } = doc.tables[table];
      const sql = `INSERT INTO ${quote(table)} (${columns.map(c => quote(c.name)).join(',')}) VALUES (${columns.map(() => '?').join(',')})`;
      for (const row of rows) { await tx.$executeRawUnsafe(sql, ...row); rowCount++; }
    }
    return { safetyBackup, rowCount };
  }, { isolationLevel: 'Serializable', timeout: 120000, maxWait: 10000 });
}
module.exports = { TABLES, encode, decode, parseBackup, createBackup, restoreBackup };
