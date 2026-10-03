const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
let handler, orderArgs;
const prisma = { order: { findMany: async args => { orderArgs = args; return []; } } };
// server.js resolves its dependencies through require.resolve({ paths }) so it can
// run from both the repo and /opt; this shim has to expose .resolve as well.
function sandboxRequire(name) {
  if (name === '@prisma/client') return { PrismaClient: function () { return prisma; } };
  if (name === 'http') return { createServer(fn) { handler = fn; return { listen() {} }; } };
  if (name === 'dotenv') return { config: () => ({ parsed: {} }) };
  return require(name);
}
sandboxRequire.resolve = (name) => name;
const context = vm.createContext({
  require: sandboxRequire,
  process: { env: { ADMIN_TOKEN: 'test-only', ADMIN_STATIC_DIR: path.resolve(__dirname, '..') }, exit() { throw Error('unexpected exit'); }, on() {} },
  module: { exports: {} },
  __dirname: path.resolve(__dirname, '..'), console, Buffer, URL, Date
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), context);
function run(code) { return vm.runInContext(code, context); }
async function request(url, token) {
  return new Promise((resolve, reject) => {
    const res = { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body }); } };
    Promise.resolve(handler({ url, method: 'GET', headers: { 'x-admin-token': token } }, res)).catch(reject);
  });
}
(async () => {
  assert.equal((await request('/%zz')).status, 400);
  assert.equal((await request('/api/health')).status, 200);
  assert.equal((await request('/api/orders')).status, 401);
  assert.equal((await request('/server.js')).status, 404);
  assert.equal((await request('/fonts/../fonts-private/secret')).status, 403);
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/api/orders?status=BAD', 'test-only')).status, 400);
  await request('/api/orders?dateTo=2026-09-11&limit=9999&customerId=c1', 'test-only');
  assert.equal(orderArgs.take, 500);
  assert.equal(orderArgs.where.customerId, 'c1');
  assert.equal(orderArgs.where.orderDate.lt.toISOString(), '2026-09-12T00:00:00.000Z');
  assert.equal(run("guardSql('SELECT * FROM users LIMIT 900 OFFSET 10').sql"), 'SELECT * FROM users LIMIT 500 OFFSET 10');
  assert.equal(run("guardSql('SELECT * FROM users -- bypass').ok"), false);
  assert.equal(run("guardSql('DELETE FROM users', true).ok"), false);
  assert.equal(run("guardSql('INSERT INTO users VALUES (1)', false).ok"), false);
  // /api/export may return much more than the 500-row editor preview
  assert.equal(run("guardSql('SELECT * FROM users', false, 20000).sql"), 'SELECT * FROM users LIMIT 20000');
  assert.equal(run("guardSql('SELECT * FROM users LIMIT 900', false, 20000).sql"), 'SELECT * FROM users LIMIT 900');
  assert.equal(run('guardSql(\'SELECT * FROM users\').sql'), 'SELECT * FROM users LIMIT 500');

  // history keeps the query type and the error message of failures
  run("addToHistory('SELECT 1', false, 0, 5, 'SELECT', 'boom')");
  const hist = JSON.parse(JSON.stringify(run('queryHistory')));
  assert.equal(hist[0].success, false);
  assert.equal(hist[0].type, 'SELECT');
  assert.equal(hist[0].error, 'boom');

  // Money columns are Prisma Decimals. The built (minified) client names the class
  // "i", so plain() must not rely on constructor.name — it used to leak the
  // object's own `constructor` key and print raw JS source in the panel.
  const decimalLike = {
    constructor: { name: 'i' },
    toFixed: () => '25000.00',
    toNumber: () => 25000,
    toString() { return '25000.00'; }
  };
  assert.equal(run('plain')(decimalLike), '25000.00');
  assert.equal(run('plain')({ toFixed() {}, toNumber() {}, toString: () => '12.5' }), '12.5');
  assert.equal(run('plain')(function named() {}), '<function>');
  assert.equal(typeof run('plain')(new Date('2026-01-02T03:04:05Z')), 'string');
  assert.deepEqual(
    JSON.parse(JSON.stringify(run('plain')({ price: decimalLike, note: null }))),
    { price: '25000.00', note: null }
  );

  const css = fs.readFileSync(path.join(__dirname, '../css/admin.css'), 'utf8');
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../js/admin.js'), 'utf8');
  for (const [, id] of js.matchAll(/\$\('([^']+)'\)/g)) assert.ok(html.includes(`id="${id}"`), `missing DOM id: ${id}`);

  // Exact row counts (COUNT(*)) for stats/tables — TABLE_ROWS is a stale InnoDB
  // estimate; counts must track inserts/deletes.
  const counts = { orders: 7, customers: 3 };
  prisma.$queryRawUnsafe = async (sql) => {
    if (/information_schema\.TABLES/i.test(sql)) {
      return [{ name: 'orders' }, { name: 'customers' }, { name: 'bad;name' }];
    }
    const m = String(sql).match(/FROM `([A-Za-z0-9_]+)`/);
    if (m && counts[m[1]] !== undefined) return [{ c: counts[m[1]] }];
    throw new Error('unexpected SQL in count test: ' + sql);
  };
  const exactRows = JSON.parse(JSON.stringify(await run('exactTableRows()')));
  assert.deepEqual(exactRows, [
    { name: 'orders', rows: 7 },
    { name: 'customers', rows: 3 },
  ]);
  const statsRes = await request('/api/stats', 'test-only');
  assert.equal(statsRes.status, 200);
  assert.equal(JSON.parse(statsRes.body).stats.totalRows, 10);
  const tablesRes = await request('/api/tables', 'test-only');
  assert.equal(JSON.parse(tablesRes.body).tables.map((t) => t.rows).join(','), '7,3');

  console.log('PASS: routing/auth, malformed URL, static boundaries, date/limit/customer filters, SQL guards, export limit, history records, hidden rule, DOM IDs, exact table counts, decimal-safe rows');
})().catch(e => { console.error(e); process.exitCode = 1; });
