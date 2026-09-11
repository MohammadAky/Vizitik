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

const PORT = parseInt(process.env.ADMIN_PORT || '3001', 10);
const TOKEN = process.env.ADMIN_TOKEN || '';
const STATIC_DIR = process.env.ADMIN_STATIC_DIR || path.join(__dirname, 'static');
const FONTS_DIR = process.env.ADMIN_FONTS_DIR || path.join(__dirname, '..', '..', 'landing', 'fonts');
const MAX_LIMIT = 500;
const MAX_ROWS_WRITE = 1000; // Safety limit for write operations

const prisma = new PrismaClient();

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

async function getDatabaseStats() {
  const tables = await prisma.$queryRawUnsafe('SHOW TABLES');
  const key = tables.length ? Object.keys(tables[0])[0] : null;
  const stats = { tables: 0, totalRows: 0, details: [] };

  for (const r of tables) {
    const name = r[key];
    if (!/^[A-Za-z0-9_]+$/.test(name)) continue;
    try {
      const c = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM \`${name}\``);
      const rowCount = Number(c[0].n);
      stats.tables++;
      stats.totalRows += rowCount;
      stats.details.push({ name, rows: rowCount });
    } catch {
      stats.details.push({ name, rows: null, error: true });
    }
  }

  return stats;
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
    take: Number.isInteger(filters.limit) ? Math.max(1, Math.min(filters.limit, MAX_LIMIT)) : 100,
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
      const raw = await readBody(req, 32 * 1024);
      let payload;
      try { payload = JSON.parse(raw || '{}'); }
      catch { return sendJson(res, 400, { error: 'بدنه‌ی درخواست JSON نیست' }); }

      const allowWrite = payload.allowWrite === true;
      const guarded = guardSql(payload.sql, allowWrite);
      if (!guarded.ok) return sendJson(res, 400, { error: guarded.error });

      const t0 = Date.now();
      let result;

      if (guarded.type === 'SELECT' || guarded.type === 'SHOW' || guarded.type === 'DESCRIBE' || guarded.type === 'EXPLAIN') {
        const rows = await prisma.$queryRawUnsafe(guarded.sql);
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
        const affected = await prisma.$executeRawUnsafe(guarded.sql);
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
      const raw = await readBody(req, 32 * 1024);
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
        const payload = JSON.parse((await readBody(req, 32 * 1024)) || '{}');
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
      const raw = await readBody(req, 32 * 1024);
      const payload = JSON.parse(raw || '{}');

      if (!payload.sql) return sendJson(res, 400, { error: 'کوئری الزامی است' });

      const guarded = guardSql(payload.sql, false);
      if (!guarded.ok) return sendJson(res, 400, { error: guarded.error });

      const format = payload.format || 'csv';
      const rows = await prisma.$queryRawUnsafe(guarded.sql);
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
    return sendJson(res, err.status || 500, { error: (err && err.message) || 'خطای ناشناخته' });
  }
});

if (!TOKEN) {
  console.error('ADMIN_TOKEN is empty - refusing to start. Set it in backend/.env');
  process.exit(1);
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`vizitik admin listening on http://127.0.0.1:${PORT}`);
});
