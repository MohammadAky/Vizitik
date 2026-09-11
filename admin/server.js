#!/usr/bin/env node
/**
 * vizitik admin panel - a small read-only SQL viewer.
 *   GET  /api/tables   list of tables with row counts   (auth)
 *   POST /api/query    run one read-only SELECT         (auth, LIMIT enforced)
 *   GET  /api/health   unauthenticated probe
 * Config (written by scripts/setup-server.sh):
 *   ADMIN_PORT, ADMIN_TOKEN, ADMIN_STATIC_DIR, ADMIN_FONTS_DIR
 * This file is copied to backend/admin/server.js on deploy so that
 * require('@prisma/client') resolves from the backend node_modules.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const PORT = parseInt(process.env.ADMIN_PORT || '3001', 10);
const TOKEN = process.env.ADMIN_TOKEN || '';
const STATIC_DIR = process.env.ADMIN_STATIC_DIR || path.join(__dirname, 'static');
const FONTS_DIR = process.env.ADMIN_FONTS_DIR || path.join(__dirname, '..', '..', 'landing', 'fonts');
const MAX_LIMIT = 500;

const prisma = new PrismaClient();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function sendJson(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(obj));
}

function authorized(req) {
  if (!TOKEN) return false;
  const a = Buffer.from(String(req.headers['x-admin-token'] || ''));
  const b = Buffer.from(TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** BigInt, Date and Prisma Decimal all become plain strings */
function plain(v) {
  if (v === null || v === undefined) return v;
  const t = typeof v;
  if (t === 'bigint') return v.toString();
  if (t === 'string' || t === 'number' || t === 'boolean') return v;
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array) return `<${v.length} bytes>`;
  const ctor = v && v.constructor ? v.constructor.name : '';
  if (ctor === 'Decimal' && typeof v.toString === 'function') return v.toString();
  if (Array.isArray(v)) return v.map(plain);
  if (t === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = plain(v[k]);
    return out;
  }
  return String(v);
}

// ------------------------------------------------------------- sql guard

const FORBIDDEN = /\b(into\s+(outfile|dumpfile)|for\s+update|lock\s+in\s+share\s+mode)\b/i;

/** one SELECT only, read-only, LIMIT capped at MAX_LIMIT */
function guardSql(raw) {
  const sql = String(raw || '').trim().replace(/;\s*$/, '');
  if (!sql) return { ok: false, error: 'کوئری خالی است' };
  if (sql.includes(';')) return { ok: false, error: 'فقط یک دستور در هر اجرا مجاز است' };
  if (!/^select\s/i.test(sql)) return { ok: false, error: 'فقط دستور SELECT اجرا می‌شود (این پنل فقط‌خواندنی است)' };
  if (FORBIDDEN.test(sql)) return { ok: false, error: 'این عبارت در پنل مجاز نیست' };
  const limit = sql.match(/\blimit\s+(\d+)\s*(,\s*(\d+))?\s*$/i);
  if (limit) {
    if (limit[3] !== undefined) {
      return parseInt(limit[3], 10) > MAX_LIMIT
        ? { ok: true, sql: sql.replace(/\blimit\s+(\d+)\s*,\s*\d+\s*$/i, `LIMIT ${limit[1]}, ${MAX_LIMIT}`) }
        : { ok: true, sql };
    }
    return parseInt(limit[1], 10) > MAX_LIMIT
      ? { ok: true, sql: sql.replace(/\blimit\s+\d+\s*$/i, `LIMIT ${MAX_LIMIT}`) }
      : { ok: true, sql };
  }
  return { ok: true, sql: `${sql} LIMIT ${MAX_LIMIT}` };
}

// ------------------------------------------------------------- products

const MAX_PRICE = 9999999999.99;
const MAX_TEXT = 200;

function cleanText(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s) : undefined;
}

function cleanNumber(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_PRICE) return NaN;
  return n;
}

/**
 * Validates a product payload. With { partial: false } (create) name and
 * unitsPerCartonDefault are required; with { partial: true } (update) every
 * field is optional. Mirrors the rules of backend ProductsService: when only
 * a carton price is given, the unit price is derived from it.
 */
function validateProductBody(body, { partial, currentUnits } = {}) {
  const data = {};
  const name = cleanText(body.name);
  if (name === undefined) {
    if (!partial) return { ok: false, error: 'نام محصول الزامی است' };
  } else {
    data.name = name;
  }
  for (const f of ['brand', 'category', 'imageUrl']) {
    const v = cleanText(body[f]);
    if (v !== undefined) data[f] = v;
  }
  let units = cleanNumber(body.unitsPerCartonDefault);
  if (units !== undefined) {
    if (!Number.isInteger(units) || units < 1) return { ok: false, error: 'تعداد در کارتن باید عدد صحیح بزرگ‌تر از صفر باشد' };
    data.unitsPerCartonDefault = units;
  } else if (!partial) {
    return { ok: false, error: 'تعداد در کارتن الزامی است' };
  } else {
    units = currentUnits;
  }
  const carton = cleanNumber(body.cartonPrice);
  if (Number.isNaN(carton)) return { ok: false, error: 'قیمت کارتن نامعتبر است' };
  const unit = cleanNumber(body.baseUnitPrice);
  if (Number.isNaN(unit)) return { ok: false, error: 'قیمت واحد نامعتبر است' };
  if (unit !== undefined) {
    data.baseUnitPrice = unit;
  } else if (carton !== undefined) {
    if (!units) return { ok: false, error: 'برای محاسبه‌ی قیمت واحد، تعداد در کارتن لازم است' };
    data.baseUnitPrice = Math.round(carton / units);
  } else if (carton === undefined && !partial) {
    return { ok: false, error: 'قیمت کارتن یا قیمت واحد الزامی است' };
  }
  return { ok: true, data };
}

/** global catalog products with usage counts */
async function listProducts() {
  const rows = await prisma.product.findMany({
    orderBy: [{ brand: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { userSettings: true, orderItems: true } } },
  });
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    brand: p.brand,
    category: p.category,
    imageUrl: p.imageUrl,
    baseUnitPrice: p.baseUnitPrice === null ? null : Number(p.baseUnitPrice),
    unitsPerCartonDefault: p.unitsPerCartonDefault,
    isGlobal: p.isGlobal,
    createdAt: p.createdAt,
    userSettingsCount: p._count.userSettings,
    orderItemsCount: p._count.orderItems,
  }));
}

async function listTables() {
  const rows = await prisma.$queryRawUnsafe('SHOW TABLES');
  const key = rows.length ? Object.keys(rows[0])[0] : null;
  const out = [];
  for (const r of rows) {
    const name = r[key];
    if (!/^[A-Za-z0-9_]+$/.test(name)) continue;
    try {
      const c = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM \`${name}\``);
      out.push({ name, rows: Number(c[0].n) });
    } catch {
      out.push({ name, rows: null });
    }
  }
  return out;
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'not found' });
    const ext = path.extname(filePath).toLowerCase();
    const cache = ext === '.woff2' || ext === '.woff' || ext === '.png' ? 'public, max-age=604800' : 'no-cache';
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  });
}

function serveStatic(res, urlPath) {
  if (urlPath.startsWith('/fonts/')) {
    const rel = path.normalize(urlPath.replace(/^\/fonts\//, ''));
    const full = path.join(FONTS_DIR, rel);
    if (!full.startsWith(FONTS_DIR)) return sendJson(res, 403, { error: 'forbidden' });
    return serveFile(res, full);
  }
  if (urlPath === '/' || urlPath === '/index.html') {
    return serveFile(res, path.join(STATIC_DIR, 'index.html'));
  }
  const full = path.join(STATIC_DIR, path.normalize(urlPath).replace(/^([/\\])+/, ''));
  if (!full.startsWith(STATIC_DIR)) return sendJson(res, 403, { error: 'forbidden' });
  return serveFile(res, full);
}

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  try {
    if (urlPath === '/api/health') return sendJson(res, 200, { ok: true });

    if (urlPath === '/api/tables' && req.method === 'GET') {
      if (!authorized(req)) return sendJson(res, 401, { error: 'توکن ادمین درست نیست' });
      return sendJson(res, 200, { tables: await listTables() });
    }

    if (urlPath === '/api/query' && req.method === 'POST') {
      if (!authorized(req)) return sendJson(res, 401, { error: 'توکن ادمین درست نیست' });
      const raw = await readBody(req, 32 * 1024);
      let payload;
      try { payload = JSON.parse(raw || '{}'); }
      catch { return sendJson(res, 400, { error: 'بدنه‌ی درخواست JSON نیست' }); }
      const guarded = guardSql(payload.sql);
      if (!guarded.ok) return sendJson(res, 400, { error: guarded.error });
      const t0 = Date.now();
      const rows = await prisma.$queryRawUnsafe(guarded.sql);
      const clean = (rows || []).map((r) => plain(r));
      return sendJson(res, 200, {
        columns: clean.length ? Object.keys(clean[0]) : [],
        rows: clean,
        rowCount: clean.length,
        ms: Date.now() - t0,
        sql: guarded.sql,
      });
    }

    // ----- products: structured CRUD (the SQL tab itself stays read-only) -----
    const productMatch = urlPath.match(/^\/api\/products(?:\/([A-Za-z0-9-]{1,64}))?$/);
    if (productMatch) {
      if (!authorized(req)) return sendJson(res, 401, { error: 'توکن ادمین درست نیست' });
      const id = productMatch[1];

      if (!id && req.method === 'GET') {
        return sendJson(res, 200, { products: await listProducts() });
      }

      if (!id && req.method === 'POST') {
        const payload = JSON.parse((await readBody(req, 64 * 1024)) || '{}');
        const v = validateProductBody(payload, { partial: false });
        if (!v.ok) return sendJson(res, 400, { error: v.error });
        const product = await prisma.product.create({
          data: Object.assign({ isGlobal: true }, v.data),
          include: { _count: { select: { userSettings: true, orderItems: true } } },
        });
        return sendJson(res, 201, { product: (await listProducts()).find((x) => x.id === product.id) || plain(product) });
      }

      if (id && req.method === 'PUT') {
        const existing = await prisma.product.findUnique({ where: { id } });
        if (!existing) return sendJson(res, 404, { error: 'محصول یافت نشد' });
        const payload = JSON.parse((await readBody(req, 64 * 1024)) || '{}');
        const v = validateProductBody(payload, { partial: true, currentUnits: existing.unitsPerCartonDefault });
        if (!v.ok) return sendJson(res, 400, { error: v.error });
        if (!Object.keys(v.data).length) return sendJson(res, 400, { error: 'چیزی برای تغییر ارسال نشده است' });
        await prisma.product.update({ where: { id }, data: v.data });
        return sendJson(res, 200, { product: (await listProducts()).find((x) => x.id === id) });
      }

      if (id && req.method === 'DELETE') {
        const existing = await prisma.product.findUnique({
          where: { id },
          include: { _count: { select: { orderItems: true, userSettings: true } } },
        });
        if (!existing) return sendJson(res, 404, { error: 'محصول یافت نشد' });
        const used = existing._count.orderItems;
        if (used > 0) {
          return sendJson(res, 409, {
            error: `این محصول در ${used} ردیف فاکتور ثبت شده و حذف نمی‌شود (تاریخچه‌ی سفارش‌ها باید سالم بماند)`,
          });
        }
        await prisma.product.delete({ where: { id } });
        return sendJson(res, 200, { deleted: true, wasUserSettingCount: existing._count.userSettings });
      }

      return sendJson(res, 405, { error: 'method not allowed' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'method not allowed' });
    }
    return serveStatic(res, urlPath);
  } catch (err) {
    return sendJson(res, 500, { error: (err && err.message) || 'خطای ناشناخته' });
  }
});

if (!TOKEN) {
  console.error('ADMIN_TOKEN is empty - refusing to start. Set it in backend/.env');
  process.exit(1);
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`vizitik admin listening on http://127.0.0.1:${PORT}`);
});
