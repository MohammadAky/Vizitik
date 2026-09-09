/**
 * سرور پیش‌نمایش محلی (dev-only) — بدون وابستگی
 *
 *  ۱) فایل‌های build‌شدهٔ frontend-app/dist را سرو می‌کند (SPA fallback)
 *  ۲) مسیرهای /api/* را با یک API در حافظه پاسخ می‌دهد تا ظاهر برنامه
 *     دقیقاً مثل اتصال به بک‌اند واقعی (NestJS + MySQL) دیده شود.
 *
 * اجرا:  node scripts/dev-preview.mjs [پورت]      (پیش‌فرض 8090)
 * داده‌ها در حافظه است و با ری‌استارت سرور به حالت اول برمی‌گردد.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'frontend-app', 'dist');
const PORT = Number(process.argv[2] || 8090);

/* ───────────────────────── دانه‌های آزمایشی ───────────────────────── */
const PRODUCTS = [
  ['مگنوم مینت', 'mihan', 'بستنی خانگی', 24, 380000, 2],
  ['بستنی قیفی میهن', 'mihan', 'بستنی سنتی', 40, 95000, 0],
  ['وانیلی کاپوچینو', 'panda', 'بستنی خانگی', 30, 210000, 1],
  ['چاپستیک کارامل', 'panda', 'بستنی صنعتی', 24, 340000, 0],
  ['بستنی یخی آبسال', 'panda', 'بستنی یخی', 48, 62000, 2],
  ['صفحه میوه‌ای', 'mihan', 'بستنی میوه‌ای', 36, 145000, 1],
  ['کاسه‌ای دابل‌چاک', 'panda', 'بستنی خانگی', 20, 260000, 3],
  ['بستنی نعنایی خانواده', 'mihan', 'بستنی سنتی', 12, 720000, 0]
].map(([name, brand, category, unitsPerCarton, cartonPrice, packSize], i) => ({
  id: i + 1,
  productId: i + 1,
  name,
  productName: name,
  brand,
  brandLabel: brand === 'mihan' ? 'میهن' : 'پاندا',
  category,
  unitsPerCarton,
  packSize,
  baseUnitPrice: Math.round(cartonPrice / unitsPerCarton),
  unitPrice: Math.round(cartonPrice / unitsPerCarton),
  cartonPrice,
  custom: packSize > 0,
  createdAt: '2026-05-11T09:12:00.000Z'
}));

const VAN = PRODUCTS.map((p, i) => ({
  ...p,
  quantityCartons: [6, 12, 3, 0, 20, 4, 2, 7][i],
  quantityUnits: [8, 0, 5, 12, 6, 0, 3, 4][i]
}));

let CUSTOMERS = [
  { id: 1, name: 'سوپرمارکت آرمان', phone: '09121234567', address: 'تهران، خیابان شریعتی، پلاک ۱۴', area: 'شمالی', currentDebt: 4850000, creditLimit: 20000000, totalPurchases: 128500000, invoiceCount: 34, lastPurchaseDate: '2026-09-06', latitude: 35.7448, longitude: 51.4452 },
  { id: 2, name: 'بقالی میرزایی', phone: '09122223344', address: 'تهران، خیابان ورنی، کوچه ۹', area: 'شمالی', currentDebt: 0, creditLimit: 8000000, totalPurchases: 41200000, invoiceCount: 12, lastPurchaseDate: '2026-09-08', latitude: 35.7402, longitude: 51.4377 },
  { id: 3, name: 'هایپر نیکان', phone: '09359876543', address: 'تهران، سعادت‌آباد، میدان کاج', area: 'غربي', currentDebt: 12300000, creditLimit: 40000000, totalPurchases: 402700000, invoiceCount: 71, lastPurchaseDate: '2026-09-02', latitude: 35.7758, longitude: 51.3006 },
  { id: 4, name: 'فروشگاه سارا', phone: '09127654321', address: 'تهران، مجاهدین، پلاک ۸۸', area: 'شرقي', currentDebt: 1650000, creditLimit: 5000000, totalPurchases: 18900000, invoiceCount: 9, lastPurchaseDate: '2026-08-29', latitude: 35.7296, longitude: 51.4658 }
];

let ORDERS = [
  {
    id: 101, invoiceNumber: 1042, customerId: 1, customerName: 'سوپرمارکت آرمان', customer: { id: 1, name: 'سوپرمارکت آرمان' },
    date: '2026-09-08T10:20:00.000Z', status: 'DELIVERED', totalAmount: 6384000, discountSteps: [{ type: 'percent', value: 5 }],
    finalAmount: 6064800, paidAmount: 3000000, cashAmount: 3000000, posAmount: 0, checkAmount: 0,
    payments: [{ method: 'CASH', amount: 3000000 }],
    items: [
      { productId: 1, productName: 'مگنوم مینت', cartonCount: 4, unitCount: 10, cartonPrice: 380000, unitPrice: 15833, lineTotal: 1718330 },
      { productId: 5, productName: 'بستنی یخی آبسال', cartonCount: 12, unitCount: 0, cartonPrice: 62000, unitPrice: 1291, lineTotal: 744000 }
    ]
  },
  {
    id: 102, invoiceNumber: 1043, customerId: 3, customerName: 'هایپر نیکان', customer: { id: 3, name: 'هایپر نیکان' },
    date: '2026-09-07T08:05:00.000Z', status: 'PENDING', totalAmount: 14720000, discountSteps: [{ type: 'percent', value: 8 }],
    finalAmount: 13542400, paidAmount: 0, cashAmount: 0, posAmount: 0, checkAmount: 13542400,
    payments: [{ method: 'CHECK', amount: 13542400, checkDetails: { checkNumber: '۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶', bankName: 'بانک ملت', dueDate: '2026-10-05', status: 'PENDING' } }],
    items: [{ productId: 8, productName: 'بستنی نعنایی خانواده', cartonCount: 18, unitCount: 4, cartonPrice: 720000, unitPrice: 60000, lineTotal: 13104000 }]
  },
  {
    id: 103, invoiceNumber: 1044, customerId: 4, customerName: 'فروشگاه سارا', customer: { id: 4, name: 'فروشگاه سارا' },
    date: '2026-09-05T12:40:00.000Z', status: 'DELIVERED', totalAmount: 1290000, discountSteps: [],
    finalAmount: 1290000, paidAmount: 1290000, cashAmount: 500000, posAmount: 790000, checkAmount: 0,
    payments: [{ method: 'CASH', amount: 500000 }, { method: 'CARD', amount: 790000 }],
    items: [{ productId: 6, productName: 'صفحه میوه‌ای', cartonCount: 6, unitCount: 12, cartonPrice: 145000, unitPrice: 4027, lineTotal: 923324 }]
  }
];

let nextOrderId = 105;
const BALE = { connectedCustomers: 2, invoicesSent: 17 };

/* ───────────────────────── کمکى‌ها ───────────────────────── */
const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};
const num = (v) => (v === '' || v == null ? 0 : Number(v) || 0);
const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });

function recalcDebt() {
  for (const c of CUSTOMERS) {
    const sum = ORDERS.filter((o) => o.customerId === c.id).reduce((s, o) => s + Math.max(0, (o.finalAmount || 0) - (o.paidAmount || 0)), 0);
    c.currentDebt = sum;
  }
}

/* ───────────────────────── API ───────────────────────── */
async function handleApi(req, res, url) {
  const p = url.pathname.replace(/^\/api/, '') || '/';
  const m = req.method;
  const body = m === 'GET' || m === 'HEAD' ? {} : await readBody(req);

  if (p === '/health') return json(res, 200, { ok: true, mode: 'dev-preview' });

  /* احراز هویت */
  if (p === '/auth/login') {
    if (!body.phone || !body.password) return json(res, 401, { message: 'شماره تلفن یا رمز عبور اشتباه است.' });
    return json(res, 200, {
      accessToken: 'dev-preview-token',
      user: { id: 7, fullName: 'رضا محمدی', phone: body.phone, role: 'VISITOR', city: 'تهران' }
    });
  }
  if (p === '/auth/me' || p === '/auth/profile') return json(res, 200, { id: 7, fullName: 'رضا محمدی', phone: '09121234567', role: 'VISITOR', city: 'تهران' });
  if (p.startsWith('/auth/send-') || p.startsWith('/auth/register') || p.startsWith('/auth/reset')) {
    return json(res, 200, { ok: true, otp: '12345', message: 'کد تأیید (حالت توسعه): ۱۲۳۴۵' });
  }
  if (p === '/auth/change-password') return json(res, 200, { ok: true });

  /* مشتریان */
  if (p === '/customers') {
    if (m === 'POST') {
      const c = { id: Date.now() % 100000, currentDebt: 0, creditLimit: 0, totalPurchases: 0, invoiceCount: 0, ...body };
      CUSTOMERS = [c, ...CUSTOMERS];
      return json(res, 201, c);
    }
    return json(res, 200, CUSTOMERS);
  }
  let mt = p.match(/^\/customers\/(\d+)(?:\/(settle|notes))?$/);
  if (mt) {
    const c = CUSTOMERS.find((x) => String(x.id) === mt[1]);
    if (!c) return json(res, 404, { message: 'مشتری یافت نشد.' });
    if (mt[2] === 'settle') {
      c.currentDebt = Math.max(0, num(c.currentDebt) - num(body.amount));
      return json(res, 200, { ok: true, currentDebt: c.currentDebt });
    }
    if (m === 'DELETE') {
      CUSTOMERS = CUSTOMERS.filter((x) => x.id !== c.id);
      return json(res, 200, { ok: true });
    }
    Object.assign(c, body);
    recalcDebt();
    return json(res, 200, c);
  }

  /* کالاها */
  if (p === '/products') {
    if (m === 'POST') {
      const pr = { id: PRODUCTS.length + 1, productId: PRODUCTS.length + 1, ...body };
      PRODUCTS.push(pr);
      return json(res, 201, pr);
    }
    return json(res, 200, PRODUCTS);
  }
  mt = p.match(/^\/products\/(\d+)$/);
  if (mt) {
    const i = PRODUCTS.findIndex((x) => String(x.id) === mt[1]);
    if (i < 0) return json(res, 404, { message: 'کالا یافت نشد.' });
    if (m === 'DELETE') {
      PRODUCTS.splice(i, 1);
      return json(res, 200, { ok: true });
    }
    PRODUCTS[i] = { ...PRODUCTS[i], ...body };
    return json(res, 200, PRODUCTS[i]);
  }

  /* بار خودرو */
  if (p === '/van-inventory') return json(res, 200, { items: VAN });
  if (p === '/van-inventory/bulk') {
    for (const it of body.items || []) {
      const row = VAN.find((v) => String(v.productId) === String(it.productId));
      if (row) {
        row.quantityCartons = num(it.quantityCartons);
        row.quantityUnits = num(it.quantityUnits);
      }
    }
    return json(res, 200, { ok: true, items: VAN });
  }

  /* سفارش‌ها */
  if (p === '/orders') {
    if (m === 'POST') {
      const id = nextOrderId++;
      const order = {
        id,
        invoiceNumber: 1000 + id,
        customerId: num(body.customerId),
        customerName: (CUSTOMERS.find((c) => String(c.id) === String(body.customerId)) || {}).name || '—',
        customer: CUSTOMERS.find((c) => String(c.id) === String(body.customerId)) || { id: body.customerId, name: '—' },
        date: new Date().toISOString(),
        status: 'PENDING',
        discountSteps: body.discountSteps || [],
        items: (body.items || []).map((it) => {
          const pr = PRODUCTS.find((x) => String(x.productId) === String(it.productId)) || {};
          const lineTotal = num(it.cartonCount) * num(pr.cartonPrice) + num(it.unitCount) * num(pr.unitPrice);
          const row = VAN.find((v) => String(v.productId) === String(it.productId));
          if (row) {
            row.quantityCartons = Math.max(0, num(row.quantityCartons) - num(it.cartonCount));
            row.quantityUnits = Math.max(0, num(row.quantityUnits) - num(it.unitCount));
          }
          return { ...it, productName: pr.productName || pr.name, cartonPrice: num(pr.cartonPrice), unitPrice: num(pr.unitPrice), lineTotal };
        })
      };
      const gross = order.items.reduce((s, it) => s + it.lineTotal, 0);
      let after = gross;
      for (const st of order.discountSteps) after -= Math.round((after * num(st.value)) / 100);
      order.totalAmount = gross;
      order.finalAmount = Math.max(0, Math.round(after));
      order.payments = body.payments || [];
      order.cashAmount = order.payments.filter((x) => x.method === 'CASH').reduce((s, x) => s + num(x.amount), 0);
      order.posAmount = order.payments.filter((x) => x.method === 'CARD').reduce((s, x) => s + num(x.amount), 0);
      order.checkAmount = order.payments.filter((x) => x.method === 'CHECK').reduce((s, x) => s + num(x.amount), 0);
      order.paidAmount = order.cashAmount + order.posAmount + order.checkAmount;
      ORDERS = [order, ...ORDERS];
      const c = CUSTOMERS.find((x) => String(x.id) === String(order.customerId));
      if (c) c.currentDebt = num(c.currentDebt) + Math.max(0, order.finalAmount - order.paidAmount);
      return json(res, 201, order);
    }
    return json(res, 200, ORDERS);
  }
  mt = p.match(/^\/orders\/(\d+)(\/invoice|\/payments)?$/);
  if (mt) {
    const o = ORDERS.find((x) => String(x.id) === mt[1]);
    if (!o) return json(res, 404, { message: 'سفارش یافت نشد.' });
    if (mt[2] === '/invoice') return json(res, 200, o);
    if (mt[2] === '/payments') {
      o.payments = body.payments || o.payments;
      o.cashAmount = (o.payments || []).filter((x) => x.method === 'CASH').reduce((s, x) => s + num(x.amount), 0);
      o.posAmount = (o.payments || []).filter((x) => x.method === 'CARD').reduce((s, x) => s + num(x.amount), 0);
      o.checkAmount = (o.payments || []).filter((x) => x.method === 'CHECK').reduce((s, x) => s + num(x.amount), 0);
      o.paidAmount = o.cashAmount + o.posAmount + o.checkAmount;
      if (body.discountSteps) o.discountSteps = body.discountSteps;
      recalcDebt();
      return json(res, 200, { ok: true, ...o });
    }
    if (m === 'DELETE') {
      ORDERS = ORDERS.filter((x) => x.id !== o.id);
      recalcDebt();
      return json(res, 200, { ok: true });
    }
    Object.assign(o, body);
    if (body.items) o.totalAmount = o.items.reduce((s, it) => s + num(it.lineTotal), 0);
    recalcDebt();
    return json(res, 200, o);
  }

  /* ربات بله */
  if (p === '/bale/stats') return json(res, 200, BALE);
  if (p === '/bale/status') return json(res, 200, { online: true, webhookConfigured: true });
  if (p === '/bale/broadcast') {
    BALE.invoicesSent += 1;
    return json(res, 200, { sent: BALE.connectedCustomers, message: 'پیام برای ' + BALE.connectedCustomers + ' فروشگاه ارسال شد.' });
  }
  if (p.startsWith('/bale/send-invoice/')) {
    BALE.invoicesSent += 1;
    return json(res, 200, { ok: true, message: 'فاکتور از طریق ربات بله ارسال شد.' });
  }

  /* همگام‌سازی صف آفلاین */
  if (p.startsWith('/sync') || p.startsWith('/orders/bulk') || p.startsWith('/reports')) return json(res, 200, { ok: true, processed: 0 });

  return json(res, 200, { ok: true });
}

/* ───────────────────────── فایل استاتیک ───────────────────────── */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'text/plain; charset=utf-8'
};

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  let file = path.join(DIST, rel);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html'); // SPA fallback
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api')) await handleApi(req, res, url);
    else serveStatic(req, res, url);
  } catch (err) {
    json(res, 500, { message: String((err && err.message) || err) });
  }
});

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('✖ فایل build پیدا نشد. اول این را اجرا کن:  cd frontend-app && npm run build');
  process.exit(1);
}
server.listen(PORT, '0.0.0.0', () => {
  console.log(`ویزیتیک — پیش‌نمایش روی http://0.0.0.0:${PORT}  (داده: mock در حافظه، از هر شماره/رمزی می‌شود وارد شد)`);
});
