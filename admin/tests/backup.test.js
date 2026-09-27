'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync, gunzipSync } = require('node:zlib');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { TABLES, encode, decode, createBackup, parseBackup, restoreBackup } = require('../backup');
const bcrypt = require('../../backend/node_modules/bcryptjs');

// Contract double: SQL shape, parameterization, order and transaction rollback.
// Actual InnoDB behavior is separately exercised by integration.test.js.
class Database {
  constructor() {
    this.data = Object.fromEntries(TABLES.map(t => [t, [{ id: t + '-1', value: 'فارسی 🍦 \\ ;\n-- comment\n\'quoted\"' }]]));
    this.columns = [{ Field: 'id', Type: 'varchar(191)', Null: 'NO' }, { Field: 'value', Type: 'text', Null: 'YES' }];
    this.calls = [];
    this.transactions = 0;
  }
  async $transaction(callback, options) {
    this.transactions++;
    this.options = options;
    const previous = structuredClone(this.data);
    try { return await callback(this); } catch (e) { this.data = previous; throw e; }
  }
  async $queryRawUnsafe(sql) {
    if (sql.includes('information_schema.TABLES')) return TABLES.map(name => ({ name, engine: 'InnoDB' }));
    const table = sql.match(/`(\w+)`/)[1];
    if (sql.startsWith('SHOW COLUMNS')) return this.columns;
    assert.match(sql, /^SELECT \* FROM/);
    return this.data[table];
  }
  async $executeRawUnsafe(sql, ...params) {
    this.calls.push([sql, params]);
    const table = sql.match(/`(\w+)`/)[1];
    if (sql.startsWith('DELETE')) { this.data[table] = []; return; }
    assert.match(sql, /^INSERT INTO `\w+` \(`id`,`value`\) VALUES \(\?,\?\)$/);
    assert.equal(params.length, 2);
    if (this.failAt === table) throw new Error('injected insert/FK failure');
    this.data[table].push({ id: params[0], value: params[1] });
  }
}
async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vizitik-backup-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('binary GZIP round-trip preserves every table, Unicode, quotes and bcrypt login', async t => {
  const db = new Database();
  const password = 'رمز#\\;\n🍦';
  db.data.users[0].value = await bcrypt.hash(password, 4);
  const { AuthService } = require('../../backend/dist/auth/auth.service');
  const { JwtService } = require('../../backend/node_modules/@nestjs/jwt');
  const jwt = new JwtService({ secret: 'test-only-jwt-secret' });
  const auth = new AuthService({ user: { findUnique: async () => db.data.users[0] && ({
    id: db.data.users[0].id, passwordHash: db.data.users[0].value, phone: '09123456789',
    firstName: 'محمد', lastName: 'تست', isActive: true, role: 'VISITOR',
  }) } }, jwt, {});
  const login = () => auth.login({ phone: '09123456789', password });
  const firstLogin = await login();
  const before = structuredClone(db.data);
  const buffer = await createBackup(db);
  assert.equal(buffer.subarray(0, 2).toString('hex'), '1f8b');
  assert.equal(db.options.isolationLevel, 'RepeatableRead');
  db.data.users[0].value = 'changed';
  await assert.rejects(login());
  const dir = await temp(t);
  const result = await restoreBackup(db, buffer, dir);
  assert.equal(db.options.isolationLevel, 'Serializable');
  assert.deepEqual(db.data, before);
  assert.equal(await bcrypt.compare(password, db.data.users[0].value), true);
  assert.equal((await login()).user.id, firstLogin.user.id);
  assert.equal(jwt.verify(firstLogin.accessToken).sub, firstLogin.user.id);
  await assert.rejects(auth.login({ phone: '09123456789', password: 'wrong' }));
  assert.equal(result.rowCount, TABLES.length);
  const safety = path.join(dir, result.safetyBackup);
  assert.equal((await fs.stat(safety)).mode & 0o777, 0o600);
  assert.equal((await parseBackup(await fs.readFile(safety))).tables.users.rows[0][1], 'changed');
  assert.deepEqual(db.calls.slice(0, TABLES.length).map(([sql]) => sql.match(/`(\w+)`/)[1]), [...TABLES].reverse());
});

test('typed values preserve dates, bytes, bigints, decimals, null and zero', () => {
  class Decimal { toString() { return '9999999999.99'; } }
  for (const value of [new Date('2026-09-27T00:00:00.123Z'), Buffer.from([0, 255, 128]), 9007199254740993n, null, 0, false, '']) {
    assert.deepEqual(decode(encode(value)), value);
  }
  assert.equal(decode(encode(new Decimal())), '9999999999.99');
  for (const value of [{ type: 'date', value: 'bad' }, {}, [], Infinity, { type: 'sql', value: 'DROP TABLE users' }]) assert.throws(() => decode(value));
});

test('corrupt, truncated and old SQL/ZIP files fail before touching the DB', async t => {
  const db = new Database(); const dir = await temp(t);
  const good = await createBackup(db); const n = db.transactions;
  for (const data of [Buffer.from('DROP TABLE users;'), gzipSync('CREATE TABLE users;'), good.subarray(0, -8), Buffer.from('PK\x03\x04')]) {
    await assert.rejects(restoreBackup(db, data, dir));
  }
  assert.equal(db.transactions, n);
  assert.equal(db.calls.length, 0);
});

test('missing/extra tables, bad version/values/columns cannot delete live data', async t => {
  const db = new Database(); const dir = await temp(t); const backup = await createBackup(db);
  for (const mutate of [d => delete d.tables.users, d => d.tables.evil = {}, d => d.version = 100,
    d => d.tables.users.rows[0][1] = {}, d => d.tables.users.columns[0].name = 'evil`', d => d.tables.users.rows[0].push(1)]) {
    const doc = JSON.parse(gunzipSync(backup)); mutate(doc);
    await assert.rejects(restoreBackup(db, gzipSync(JSON.stringify(doc)), dir));
  }
  assert.equal(db.calls.length, 0);
});

test('insert failure rolls back ALL tables, retaining the safety backup', async t => {
  const db = new Database(); const dir = await temp(t); const buffer = await createBackup(db);
  db.data.users[0].value = 'live password hash';
  const before = structuredClone(db.data);
  db.failAt = 'checks';
  await assert.rejects(restoreBackup(db, buffer, dir), /injected/);
  assert.deepEqual(db.data, before);
  assert.equal((await fs.readdir(dir)).length, 1);
});

test('unwritable safety-backup destination aborts BEFORE any delete', async t => {
  const db = new Database(); const dir = await temp(t); const file = path.join(dir, 'file');
  await fs.writeFile(file, 'not a directory');
  await assert.rejects(restoreBackup(db, await createBackup(db), file));
  assert.equal(db.calls.length, 0);
});

test('empty tables are represented and genuinely replace current contents', async t => {
  const db = new Database(); const dir = await temp(t);
  db.data.users = [];
  const buffer = await createBackup(db);
  db.data.users = [{ id: 'new', value: 'new' }];
  await restoreBackup(db, buffer, dir);
  assert.deepEqual(db.data.users, []);
});

test('HTTP auth, confirmation, binary upload and error status (no false 207 success)', async t => {
  const db = new Database(); const dir = await temp(t);
  process.env.ADMIN_TOKEN = 'test-only-admin-secret';
  process.env.BACKUP_DIR = dir;
  // Replace only Prisma construction; real HTTP handler/body reader is tested.
  const clientPath = require.resolve('@prisma/client', { paths: [path.resolve(__dirname, '../../backend')] });
  const original = require.cache[clientPath];
  require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { PrismaClient: class { constructor() { return db; } } } };
  const { server } = require('../server');
  if (original) require.cache[clientPath] = original; else delete require.cache[clientPath];
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'X-Admin-Token': process.env.ADMIN_TOKEN };
  assert.equal((await fetch(url + '/api/export/backup')).status, 401);
  assert.equal((await fetch(url + '/api/import/backup', { method: 'POST', headers })).status, 400);
  const response = await fetch(url + '/api/export/backup', { headers });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /\.vizitik\.json\.gz/);
  const bytes = Buffer.from(await response.arrayBuffer());
  const before = structuredClone(db.data);
  db.data.users = [];
  headers['X-Confirm-Restore'] = 'replace-all-data';
  const restored = await fetch(url + '/api/import/backup', { method: 'POST', headers, body: bytes });
  assert.equal(restored.status, 200);
  assert.deepEqual(db.data, before);
  assert.equal((await fetch(url + '/api/import/backup', { method: 'POST', headers, body: 'garbage' })).status, 400);
});

test('expanded GZIP limit rejects a decompression bomb', async () => {
  const compressed = gzipSync(Buffer.alloc(200 * 1024 * 1024 + 1, 0x20));
  await assert.rejects(parseBackup(compressed), { status: 400 });
});

test('unknown/missing tables and nontransactional engines fail export', async () => {
  for (const alter of [rows => rows.slice(1), rows => [...rows, { name: 'unknown', engine: 'InnoDB' }],
    rows => rows.map(row => ({ ...row, engine: 'MyISAM' }))]) {
    const db = new Database();
    const query = db.$queryRawUnsafe.bind(db);
    db.$queryRawUnsafe = async sql => {
      const rows = await query(sql);
      return sql.includes('information_schema.TABLES') ? alter(rows) : rows;
    };
    await assert.rejects(createBackup(db));
    assert.equal(db.calls.length, 0);
  }
});

test('body reader preserves binary bytes and reports oversized payloads', async () => {
  const { Readable } = require('node:stream');
  const { readBody } = require('../server');
  const bytes = Buffer.from([0, 128, 255, 13, 10, 195, 169]);
  const body = await readBody(Readable.from([bytes.subarray(0, 3), bytes.subarray(3)]), 7, true);
  assert.deepEqual(body, { body: bytes, tooLarge: false });
  const over = await readBody(Readable.from([bytes, bytes, bytes]), 8, true);
  assert.equal(over.tooLarge, true);
  assert.ok(over.body.length <= 8);
});
