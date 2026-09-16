#!/usr/bin/env node
/**
 * Vizitik Admin Panel - Advanced SQL Management Interface
 * Features:
 * - Read-only and write SQL operations with safety checks
 * - Query history and bookmarks
 * - Schema introspection
 * - Batch query support
 * - CSV/JSON export
 * - Database statistics
 * - Product, user, customer management
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

// ------------------------------------------------------------------
// Environment: backend/.env is the single source of truth for the
// panel (the same file the API and the Prisma CLI use - see
// backend/.env.example). Values already set (systemd EnvironmentFile,
// shell) always win.
// ------------------------------------------------------------------
function loadEnvFile(file) {
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch { return; }
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
    let val = line.slice(eq + 1).trim();
    if (val.length > 1 && ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))) val = val.slice(1, -1);
    process.env[key] = val;
  }
}
// the script runs from admin/ in a checkout and from backend/admin/ on the
// server - both layouts resolve to the same backend/.env
const backendEnv = [
  path.join(__dirname, '..', 'backend', '.env'),  // checkout: repo/admin → repo/backend/.env
  path.join(__dirname, '..', '.env'),             // server:   backend/admin → backend/.env
].find((f) => fs.existsSync(f));
if (backendEnv) loadEnvFile(backendEnv);

// Port: on the VPS the panel and the API share backend/.env, which contains
// the API's PORT (3000) - so ADMIN_PORT must win over PORT there. On Render
// ADMIN_PORT is not set, so the injected PORT (10000) is used instead.
const PORT = parseInt(process.env.ADMIN_PORT || process.env.PORT || '3001', 10);
// VPS: stays 127.0.0.1 (only nginx may reach it). Render: HOST=0.0.0.0.
const HOST = process.env.HOST || '127.0.0.1';
const TOKEN = process.env.ADMIN_TOKEN || '';
const STATIC_DIR = process.env.ADMIN_STATIC_DIR || __dirname;
const FONTS_DIR = process.env.ADMIN_FONTS_DIR || path.join(__dirname, '..', 'landing', 'fonts');
const MAX_LIMIT = 500;
// Under nginx proxy_read_timeout (60s) so we answer with a clean JSON error
// before the gateway times the request out (nginx 504 / Cloudflare 524).
const QUERY_TIMEOUT_MS = Math.max(1000, parseInt(process.env.ADMIN_QUERY_TIMEOUT_MS || '55000', 10));
const MAX_BODY_QUERY = 2 * 1024 * 1024; // SQL payloads (bulk INSERT/UPDATE)
const MAX_BODY_JSON = 64 * 1024;        // structured JSON endpoints

const prisma = new PrismaClient();

// A stray async error must never kill the process - when node exits mid-request
// nginx reports "502 Bad Gateway" for the request that was in flight.
process.on('uncaughtException', (err) => console.error('[admin] uncaughtException:', err));
process.on('unhandledRejection', (err) => console.error('[admin] unhandledRejection:', err));

// In-memory storage for query history and bookmarks
const queryHistory = [];
const queryBookmarks = [];
const MAX_HISTORY = 100;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// ============================================================ Utility Functions

function sendJson(res, code, obj) {
  if (res.headersSent) {
    // Never attempt a second writeHead - that throws ERR_HTTP_HEADERS_SENT
    // inside the error handler and would crash the service.
    try { res.end(); } catch { /* socket already gone */ }
    return;
  }
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(plain(obj)));
}

function authorized(req) {
  if (!TOKEN) return false;
  const a = Buffer.from(String(req.headers['x-admin-token'] || ''));
  const b = Buffer.from(TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function readBody(req, max) {
  // Reads the whole body and reports it. An oversized body is *drained*, not
  // destroyed: destroying the socket mid-request makes nginx answer
  // "502 Bad Gateway" instead of delivering our 413 JSON to the client.
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) tooLarge = true;
      else chunks.push(c);
    });
    req.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8'), tooLarge }));
    req.on('error', reject);
  });
}

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

function addToHistory(sql, success, rowCount, ms) {
  queryHistory.unshift({
    id: Date.now(),
    sql: sql.trim(),
    success,
    rowCount,
    ms,
    timestamp: new Date().toISOString()
  });
  if (queryHistory.length > MAX_HISTORY) {
    queryHistory.pop();
  }
}

function timeoutError(what) {
  const e = new Error(`اجرای ${what} بیش از ${Math.round(QUERY_TIMEOUT_MS / 1000)} ثانیه طول کشید و لغو شد (محدودیت سرور)` );
  e.code = 'ADMIN_TIMEOUT';
  return e;
}

function withTimeout(promise, what) {
  let timer;
  const gate = new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError(what)), QUERY_TIMEOUT_MS);
  });
  return Promise.race([promise, gate]).finally(() => clearTimeout(timer));
}

// ============================================================ SQL Guard

const FORBIDDEN_READ = /\b(into\s+(outfile|dumpfile)|for\s+update|lock\s+in\s+share\s+mode)\b/i;
const FORBIDDEN_WRITE = /\b(drop\s+database|truncate\s+database|alter\s+database)\b/i;

function classifyQuery(sql) {
  const trimmed = sql.trim().toLowerCase();
  if (/^select\s/i.test(trimmed)) return 'SELECT';
  if (/^insert\s/i.test(trimmed)) return 'INSERT';
  if (/^update\s/i.test(trimmed)) return 'UPDATE';
  if (/^delete\s/i.test(trimmed)) return 'DELETE';
  if (/^show\s/i.test(trimmed)) return 'SHOW';
  if (/^describe\s/i.test(trimmed)) return 'DESCRIBE';
  if (/^explain\s/i.test(trimmed)) return 'EXPLAIN';
  return 'UNKNOWN';
}

function guardSql(raw, allowWrite = false) {
  const sql = String(raw || '').trim().replace(/;\s*$/, '');
  if (!sql) return { ok: false, error: 'کوئری خالی است' };

  // Check for multiple statements
  if (sql.includes(';')) return { ok: false, error: 'فقط یک دستور در هر اجرا مجاز است' };

  if (/--|#|\/\*/.test(sql)) return { ok: false, error: 'کامنت SQL در این ویرایشگر پشتیبانی نمی‌شود' };
  const queryType = classifyQuery(sql);

  // Read operations
  if (queryType === 'SELECT' || queryType === 'SHOW' || queryType === 'DESCRIBE' || queryType === 'EXPLAIN') {
    if (FORBIDDEN_READ.test(sql)) return { ok: false, error: 'این عبارت در پنل مجاز نیست' };

    // Apply LIMIT for SELECT queries
    if (queryType === 'SELECT') {
      const offsetLimit = sql.match(/\blimit\s+(\d+)\s+offset\s+(\d+)\s*$/i);
      if (offsetLimit) return { ok: true, sql: sql.replace(/\blimit\s+\d+\s+offset\s+\d+\s*$/i, `LIMIT ${Math.min(Number(offsetLimit[1]), MAX_LIMIT)} OFFSET ${offsetLimit[2]}`), type: queryType, requiresConfirmation: false };
      const limit = sql.match(/\blimit\s+(\d+)\s*(,\s*(\d+))?\s*$/i);
      if (limit) {
        if (limit[3] !== undefined) {
          return {
            ok: true,
            sql: parseInt(limit[3], 10) > MAX_LIMIT
              ? sql.replace(/\blimit\s+(\d+)\s*,\s*\d+\s*$/i, `LIMIT ${limit[1]}, ${MAX_LIMIT}`)
              : sql,
            type: queryType,
            requiresConfirmation: false
          };
        }
        return {
          ok: true,
          sql: parseInt(limit[1], 10) > MAX_LIMIT
            ? sql.replace(/\blimit\s+\d+\s*$/i, `LIMIT ${MAX_LIMIT}`)
            : sql,
          type: queryType,
          requiresConfirmation: false
        };
      }
      return { ok: true, sql: `${sql} LIMIT ${MAX_LIMIT}`, type: queryType, requiresConfirmation: false };
    }

    return { ok: true, sql, type: queryType, requiresConfirmation: false };
  }

  // Write operations
  if (queryType === 'INSERT' || queryType === 'UPDATE' || queryType === 'DELETE') {
    if (!allowWrite) {
      return { ok: false, error: 'عملیات نوشتن در حالت عادی مجاز نیست. لطفاً گزینه "اجازه نوشتن" را فعال کنید.' };
    }

    if (FORBIDDEN_WRITE.test(sql)) {
      return { ok: false, error: 'این عملیات خطرناک و غیرقابل بازگشت است و مجاز نیست' };
    }

    // Require WHERE clause for UPDATE and DELETE (except DELETE with LIMIT 1)
    if (queryType === 'UPDATE' && !/\bwhere\s/i.test(sql)) {
      return { ok: false, error: 'برای عملیات UPDATE الزاماً باید شرط WHERE داشته باشید' };
    }

    if (queryType === 'DELETE' && !/\bwhere\s/i.test(sql) && !/\blimit\s+1\s*$/i.test(sql)) {
      return { ok: false, error: 'برای عملیات DELETE الزاماً باید شرط WHERE یا LIMIT 1 داشته باشید' };
    }

    return { ok: true, sql, type: queryType, requiresConfirmation: true };
  }

  return { ok: false, error: 'نوع کوئری پشتیبانی نمی‌شود. فقط SELECT, INSERT, UPDATE, DELETE, SHOW, DESCRIBE مجاز هستند.' };
}

// ============================================================ Schema Introspection

async function getTableSchema(tableName) {
  const columns = await prisma.$queryRawUnsafe(`SHOW COLUMNS FROM \`${tableName}\``);
  const indexes = await prisma.$queryRawUnsafe(`SHOW INDEX FROM \`${tableName}\``);
  return {
    columns: columns.map(c => ({
      name: c.Field,
      type: c.Type,
      nullable: c.Null === 'YES',
      key: c.Key,
      defaultValue: c.Default,
      extra: c.Extra
    })),
    indexes: indexes.map(i => ({
      name: i.Key_name,
      column: i.Column_name,
      unique: !i.Non_unique,
      type: i.Index_type
    }))
  };
}

// Exact row counts (COUNT(*)) for every table in the schema.
// information_schema.TABLE_ROWS is only an InnoDB *estimate* that does not
// track row inserts/deletes, so panel counters would stay stale (e.g. after
// deleting an invoice and registering a new one the orders count would not
// move). Table sizes here keep exact counts fast; identifiers stay
// allowlisted so the interpolated name is safe.
async function exactTableRows() {
  const tables = await prisma.$queryRawUnsafe(
    'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME'
  );
  const details = [];
  for (const t of tables || []) {
    if (!/^[A-Za-z0-9_]+$/.test(t.name)) continue;
    try {
      const [r] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS c FROM \`${t.name}\``);
      details.push({ name: t.name, rows: Number(r.c) || 0 });
    } catch {
      details.push({ name: t.name, rows: null });
    }
  }
  return details;
}

async function getDatabaseStats() {
  const details = await exactTableRows();
  return {
    tables: details.length,
    totalRows: details.reduce((sum, d) => sum + (d.rows || 0), 0),
    details,
  };
}

// ============================================================ Products CRUD

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

// ============================================================ Users & Pricing

async function listUsers() {
  const rows = await prisma.user.findMany({
    select: {
      id: true, firstName: true, lastName: true, phone: true, role: true, isActive: true,
      _count: { select: { customers: true, customUserProducts: true, orders: true } },
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });
  return rows.map((u) => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    phone: u.phone,
    role: u.role,
    isActive: u.isActive,
    customersCount: u._count.customers,
    userProductsCount: u._count.customUserProducts,
    ordersCount: u._count.orders,
  }));
}

async function listUserProducts() {
  const rows = await prisma.userProduct.findMany({
    include: {
      user: { select: { firstName: true, lastName: true, phone: true } },
      product: { select: { name: true, brand: true, baseUnitPrice: true, unitsPerCartonDefault: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    productId: r.productId,
    userName: `${r.user.firstName} ${r.user.lastName}`.trim(),
    userPhone: r.user.phone,
    productName: r.product.name,
    productBrand: r.product.brand,
    productBaseUnitPrice: r.product.baseUnitPrice === null ? null : Number(r.product.baseUnitPrice),
    productUnitsPerCarton: r.product.unitsPerCartonDefault,
    customCartonPrice: r.customCartonPrice === null ? null : Number(r.customCartonPrice),
    customUnitPrice: r.customUnitPrice === null ? null : Number(r.customUnitPrice),
    customUnitsPerCarton: r.customUnitsPerCarton,
    isActiveForUser: r.isActiveForUser,
    updatedAt: r.updatedAt,
  }));
}

function validateUserProductBody(body) {
  const data = {};
  for (const f of ['customCartonPrice', 'customUnitPrice']) {
    const v = body[f];
    if (v === undefined) continue;
    if (v === null || v === '') { data[f] = null; continue; }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > MAX_PRICE) return { ok: false, error: `مقدار ${f === 'customCartonPrice' ? 'قیمت کارتن' : 'قیمت واحد'} نامعتبر است` };
    data[f] = n;
  }
  if (body.customUnitsPerCarton !== undefined) {
    const v = body.customUnitsPerCarton;
    if (v === null || v === '') { data.customUnitsPerCarton = null; }
    else {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'تعداد در کارتن باید عدد صحیح بزرگ‌تر از صفر باشد' };
      data.customUnitsPerCarton = n;
    }
  }
  if (body.isActiveForUser !== undefined) data.isActiveForUser = Boolean(body.isActiveForUser);
  return { ok: true, data };
}

// ============================================================ Customers

async function listCustomers(q) {
  const rows = await prisma.customer.findMany({
    where: q ? { OR: [{ name: { contains: q } }, { phone: { contains: q } }] } : undefined,
    include: {
      assignedVisitor: { select: { firstName: true, lastName: true } },
      ledgerEntries: { orderBy: { createdAt: 'desc' }, take: 1 },
      orders: { orderBy: { createdAt: 'desc' }, take: 1, select: { orderDate: true, finalAmount: true } },
      _count: { select: { orders: true } },
    },
    orderBy: { name: 'asc' },
  });
  return rows.map((c) => {
    const debt = c.ledgerEntries.length > 0 ? Number(c.ledgerEntries[0].balanceAfter) : 0;
    const last = c.orders[0];
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      address: c.address,
      visitorName: `${c.assignedVisitor.firstName} ${c.assignedVisitor.lastName}`.trim(),
      debt,
      hasDebt: debt > 0,
      ordersCount: c._count.orders,
      lastOrderDate: last ? last.orderDate : null,
      lastOrderAmount: last ? Number(last.finalAmount) : null,
    };
  });
}

// ============================================================ Orders

async function listOrders(filters = {}) {
  const where = {};

  if (filters.status && !['DRAFT', 'CONFIRMED', 'DELIVERED', 'CANCELLED'].includes(filters.status)) throw Object.assign(new Error('وضعیت نامعتبر است'), { status: 400 });
  if (filters.status) where.status = filters.status;
  for (const key of ['dateFrom', 'dateTo']) {
    if (filters[key] && !Number.isFinite(Date.parse(filters[key]))) throw Object.assign(new Error('تاریخ نامعتبر است'), { status: 400 });
  }
  if (filters.visitorId) where.visitorId = filters.visitorId;
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.dateFrom || filters.dateTo) {
    where.orderDate = {};
    if (filters.dateFrom) where.orderDate.gte = new Date(filters.dateFrom);
    if (filters.dateTo) {
      const end = new Date(filters.dateTo);
      if (/^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo)) { end.setUTCDate(end.getUTCDate() + 1); where.orderDate.lt = end; }
      else where.orderDate.lte = end;
    }
  }

  const rows = await prisma.order.findMany({
    where,
    include: {
      customer: { select: { name: true, phone: true } },
      visitor: { select: { firstName: true, lastName: true } },
      items: { include: { product: { select: { name: true } } } },
      payments: true,
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(parseInt(filters.limit, 10) || 100, 1), MAX_LIMIT),
  });

  return rows.map((o) => ({
    id: o.id,
    localUuid: o.localUuid,
    invoiceNumber: o.invoiceNumber,
    customerName: o.customer.name,
    customerPhone: o.customer.phone,
    visitorName: `${o.visitor.firstName} ${o.visitor.lastName}`.trim(),
    orderDate: o.orderDate,
    status: o.status,
    subtotalAmount: Number(o.subtotalAmount),
    totalDiscountAmount: Number(o.totalDiscountAmount),
    finalAmount: Number(o.finalAmount),
    itemsCount: o.items.length,
    items: o.items.map(i => ({
      productName: i.product.name,
      cartonCount: i.cartonCount,
      unitCount: i.unitCount,
      lineTotal: Number(i.lineTotal)
    })),
    payments: o.payments.map(p => ({
      method: p.method,
      amount: Number(p.amount),
      paidAt: p.paidAt
    })),
    createdAt: o.createdAt,
  }));
}

// ============================================================ Tables

async function listTables() {
  // تعداد دقیق ردیف‌ها با COUNT(*) — جدول‌ها این‌جا کوچک هستند و شمارش
  // تخمینی InnoDB (TABLE_ROWS) با حذف/افزودن ردیف به‌روز نمی‌شد.
  return exactTableRows();
}

// ============================================================ Static Files

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
    const full = path.resolve(FONTS_DIR, rel);
    if (!full.startsWith(path.resolve(FONTS_DIR) + path.sep)) return sendJson(res, 403, { error: 'forbidden' });
    return serveFile(res, full);
  }
  if (urlPath === '/' || urlPath === '/index.html') {
    return serveFile(res, path.join(STATIC_DIR, 'index.html'));
  }
  if (!/^\/(css|js)\/[A-Za-z0-9_.\/-]+$/.test(urlPath)) return sendJson(res, 404, { error: 'not found' });
  const full = path.resolve(STATIC_DIR, '.' + urlPath);
  if (!full.startsWith(path.resolve(STATIC_DIR) + path.sep)) return sendJson(res, 403, { error: 'forbidden' });
  return serveFile(res, full);
}

// ============================================================ HTTP Server

const server = http.createServer(async (req, res) => {
  let urlPath, query;
  try {
    // Parsed inside try: a malformed URL (bad %-escapes) must answer with a
    // JSON error instead of throwing out of the handler and killing the
    // service (which nginx would report as 502 for in-flight requests).
    urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    query = new URL(req.url || '/', 'http://localhost').searchParams;
  } catch { return sendJson(res, 400, { error: 'Invalid URL' }); }

  try {

    // Health check (no auth)
    if (urlPath === '/api/health') return sendJson(res, 200, { ok: true });

    // Auth check for all other API endpoints
    if (urlPath.startsWith('/api/')) {
      if (!authorized(req)) return sendJson(res, 401, { error: 'توکن ادمین درست نیست' });
    }

    // ============================================================ Schema & Stats

    // Get schema for a specific table
    if (urlPath.match(/^\/api\/schema\/[A-Za-z0-9_]+$/) && req.method === 'GET') {
      const tableName = urlPath.split('/').pop();
      const schema = await getTableSchema(tableName);
      return sendJson(res, 200, { schema });
    }

    // Get database statistics
    if (urlPath === '/api/stats' && req.method === 'GET') {
      const stats = await getDatabaseStats();
      return sendJson(res, 200, { stats });
    }

    // ============================================================ SQL Queries

    // List tables
    if (urlPath === '/api/tables' && req.method === 'GET') {
      return sendJson(res, 200, { tables: await listTables() });
    }

    // Execute SQL query
    if (urlPath === '/api/query' && req.method === 'POST') {
      const { body: raw, tooLarge } = await readBody(req, MAX_BODY_QUERY);
      if (tooLarge) return sendJson(res, 413, { error: 'کوئری بیش از حد بزرگ است (حداکثر ۲ مگابایت)' });
      let payload;
      try { payload = JSON.parse(raw || '{}'); }
      catch { return sendJson(res, 400, { error: 'بدنه‌ی درخواست JSON نیست' }); }

      const allowWrite = payload.allowWrite === true;
      const guarded = guardSql(payload.sql, allowWrite);
      if (!guarded.ok) return sendJson(res, 400, { error: guarded.error });

      const t0 = Date.now();
      let result;

      if (guarded.type === 'SELECT' || guarded.type === 'SHOW' || guarded.type === 'DESCRIBE' || guarded.type === 'EXPLAIN') {
        const rows = await withTimeout(prisma.$queryRawUnsafe(guarded.sql), 'کوئری');
        const clean = (rows || []).map((r) => plain(r));
        result = {
          columns: clean.length ? Object.keys(clean[0]) : [],
          rows: clean,
          rowCount: clean.length,
          ms: Date.now() - t0,
          sql: guarded.sql,
          type: guarded.type,
          success: true
        };
      } else {
        // Write operation
        const affected = await withTimeout(prisma.$executeRawUnsafe(guarded.sql), 'عملیات نوشتن');
        result = {
          affectedRows: affected,
          ms: Date.now() - t0,
          sql: guarded.sql,
          type: guarded.type,
          success: true
        };
      }

      addToHistory(guarded.sql, true, result.rowCount || result.affectedRows || 0, result.ms);
      return sendJson(res, 200, result);
    }

    // ============================================================ Query History

    if (urlPath === '/api/query-history' && req.method === 'GET') {
      const limit = parseInt(query.get('limit') || '50', 10);
      return sendJson(res, 200, { history: queryHistory.slice(0, limit) });
    }

    if (urlPath === '/api/query-history' && req.method === 'DELETE') {
      queryHistory.length = 0;
      return sendJson(res, 200, { cleared: true });
    }

    // ============================================================ Query Bookmarks

    if (urlPath === '/api/query-bookmarks' && req.method === 'GET') {
      return sendJson(res, 200, { bookmarks: queryBookmarks });
    }

    if (urlPath === '/api/query-bookmarks' && req.method === 'POST') {
      const { body: raw, tooLarge } = await readBody(req, MAX_BODY_JSON);
      if (tooLarge) return sendJson(res, 413, { error: 'بدنه‌ی درخواست بیش از حد بزرگ است' });
      const payload = JSON.parse(raw || '{}');
      if (!payload.sql || !payload.name) {
        return sendJson(res, 400, { error: 'نام و کوئری الزامی است' });
      }
      const bookmark = {
        id: Date.now(),
        name: payload.name.trim().slice(0, 100),
        sql: payload.sql.trim(),
        description: (payload.description || '').trim().slice(0, 500),
        createdAt: new Date().toISOString()
      };
      queryBookmarks.push(bookmark);
      return sendJson(res, 201, { bookmark });
    }

    if (urlPath.match(/^\/api\/query-bookmarks\/[0-9]+$/) && req.method === 'DELETE') {
      const id = parseInt(urlPath.split('/').pop(), 10);
      const index = queryBookmarks.findIndex(b => b.id === id);
      if (index === -1) return sendJson(res, 404, { error: 'Bookmark یافت نشد' });
      queryBookmarks.splice(index, 1);
      return sendJson(res, 200, { deleted: true });
    }

    // ============================================================ Products

    const productMatch = urlPath.match(/^\/api\/products(?:\/([A-Za-z0-9-]{1,64}))?$/);
    if (productMatch) {
      const id = productMatch[1];

      if (!id && req.method === 'GET') {
        return sendJson(res, 200, { products: await listProducts() });
      }

      if (!id && req.method === 'POST') {
        const { body: rawBody, tooLarge } = await readBody(req, MAX_BODY_JSON);
        if (tooLarge) return sendJson(res, 413, { error: 'بدنه‌ی درخواست بیش از حد بزرگ است' });
        const payload = JSON.parse(rawBody || '{}');
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
        const { body: rawBody, tooLarge } = await readBody(req, MAX_BODY_JSON);
        if (tooLarge) return sendJson(res, 413, { error: 'بدنه‌ی درخواست بیش از حد بزرگ است' });
        const payload = JSON.parse(rawBody || '{}');
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
            error: `این محصول در ${used} ردیف فاکتور ثبت شده و حذف نمی‌شود`,
          });
        }
        await prisma.product.delete({ where: { id } });
        return sendJson(res, 200, { deleted: true, wasUserSettingCount: existing._count.userSettings });
      }

      return sendJson(res, 405, { error: 'method not allowed' });
    }

    // ============================================================ Users & Per-User Pricing

    if (urlPath === '/api/users' && req.method === 'GET') {
      return sendJson(res, 200, { users: await listUsers() });
    }

    const userProductMatch = urlPath.match(/^\/api\/user-products(?:\/([A-Za-z0-9-]{1,64}))?(?:\/([A-Za-z0-9-]{1,64}))?$/);
    if (userProductMatch) {
      const userId = userProductMatch[1];
      const productId = userProductMatch[2];

      if (!userId && req.method === 'GET') {
        const productIdFilter = query.get('productId') || '';
        const rows = await listUserProducts();
        return sendJson(res, 200, {
          userProducts: productIdFilter ? rows.filter((r) => r.productId === productIdFilter) : rows,
        });
      }

      if (userId && productId && req.method === 'PUT') {
        const [user, product] = await Promise.all([
          prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
          prisma.product.findUnique({ where: { id: productId }, select: { id: true } }),
        ]);
        if (!user) return sendJson(res, 404, { error: 'ویزیتور یافت نشد' });
        if (!product) return sendJson(res, 404, { error: 'محصول یافت نشد' });
        const { body: rawBody, tooLarge } = await readBody(req, MAX_BODY_JSON);
        if (tooLarge) return sendJson(res, 413, { error: 'بدنه‌ی درخواست بیش از حد بزرگ است' });
        const payload = JSON.parse(rawBody || '{}');
        const v = validateUserProductBody(payload);
        if (!v.ok) return sendJson(res, 400, { error: v.error });
        if (!Object.keys(v.data).length) return sendJson(res, 400, { error: 'چیزی برای تغییر ارسال نشده است' });
        await prisma.userProduct.upsert({
          where: { userId_productId: { userId, productId } },
          update: v.data,
          create: Object.assign({ userId, productId, isActiveForUser: true }, v.data),
        });
        return sendJson(res, 200, { ok: true });
      }

      if (userId && productId && req.method === 'DELETE') {
        await prisma.userProduct.deleteMany({ where: { userId, productId } });
        return sendJson(res, 200, { deleted: true });
      }

      return sendJson(res, 405, { error: 'method not allowed' });
    }

    // ============================================================ Customers

    if (urlPath === '/api/customers' && req.method === 'GET') {
      const q = (query.get('q') || '').trim().slice(0, 100);
      return sendJson(res, 200, { customers: await listCustomers(q || undefined) });
    }

    // ============================================================ Orders

    if (urlPath === '/api/orders' && req.method === 'GET') {
      const filters = {
        status: query.get('status') || undefined,
        visitorId: query.get('visitorId') || undefined,
        customerId: query.get('customerId') || undefined,
        dateFrom: query.get('dateFrom') || undefined,
        dateTo: query.get('dateTo') || undefined,
        limit: parseInt(query.get('limit') || '100', 10)
      };
      return sendJson(res, 200, { orders: await listOrders(filters) });
    }

    // ============================================================ Export

    if (urlPath === '/api/export' && req.method === 'POST') {
      const { body: raw, tooLarge } = await readBody(req, MAX_BODY_QUERY);
      if (tooLarge) return sendJson(res, 413, { error: 'کوئری بیش از حد بزرگ است (حداکثر ۲ مگابایت)' });
      const payload = JSON.parse(raw || '{}');

      if (!payload.sql) return sendJson(res, 400, { error: 'کوئری الزامی است' });

      const guarded = guardSql(payload.sql, false);
      if (!guarded.ok) return sendJson(res, 400, { error: guarded.error });

      const format = payload.format || 'csv';
      const rows = await withTimeout(prisma.$queryRawUnsafe(guarded.sql), 'خروجی‌گیری');
      const clean = (rows || []).map((r) => plain(r));

      if (clean.length === 0) {
        return sendJson(res, 200, { data: '', format, rowCount: 0 });
      }

      if (format === 'json') {
        return sendJson(res, 200, { data: JSON.stringify(clean, null, 2), format, rowCount: clean.length });
      }

      // CSV format
      const columns = Object.keys(clean[0]);
      const csvRows = [columns.join(',')];
      for (const row of clean) {
        const values = columns.map(c => {
          const v = row[c];
          if (v === null || v === undefined) return '';
          const str = String(v);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
          }
          return str;
        });
        csvRows.push(values.join(','));
      }

      return sendJson(res, 200, { data: csvRows.join('\n'), format, rowCount: clean.length });
    }

    // ============================================================ Fallback

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'method not allowed' });
    }
    return serveStatic(res, urlPath);

  } catch (err) {
    console.error('Server error:', err);
    if (err && err.code === 'ADMIN_TIMEOUT') return sendJson(res, 504, { error: err.message });
    return sendJson(res, err.status || 500, { error: (err && err.message) || 'خطای ناشناخته' });
  }
});

if (!TOKEN) {
  console.error('ADMIN_TOKEN is empty - refusing to start. Set it in backend/.env');
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  console.log(`vizitik admin listening on http://${HOST}:${PORT}`);
});
