'use strict';
// DESTRUCTIVE only to a disposable database named vizitik_test. Never point this
// suite at a live database. It is skipped unless RUN_DB_TESTS=1 is set, and it is
// meant to be run by hand (see docs/DEPLOY-UBUNTU.md).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const configured = process.env.RUN_DB_TESTS === '1';

// Every mapped table of backend/prisma/schema.prisma, children first so the
// cleanup below never trips over a foreign key.
const TABLES = [
  'customer_ledger', 'checks', 'payments', 'order_discount_steps', 'order_items',
  'orders', 'van_inventory', 'user_products', 'invoice_settings', 'invoice_counters',
  'products', 'customers', 'users',
];

test('MariaDB/InnoDB: real HTTP login/JWT, price precision and quoted payloads', { skip: !configured }, async t => {
  const url = new URL(process.env.TEST_DATABASE_URL || 'mysql://missing');
  assert.equal(url.pathname, '/vizitik_test', 'Refusing to modify a non-test database');
  process.env.DATABASE_URL = url.toString();
  process.env.JWT_SECRET = 'integration-test-secret-not-for-production';
  process.env.BALE_BOT_TOKEN = '';
  const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
  const { Test } = require('../../backend/node_modules/@nestjs/testing');
  const { ValidationPipe } = require('../../backend/node_modules/@nestjs/common');
  const { JwtService } = require('../../backend/node_modules/@nestjs/jwt');
  const bcrypt = require('../../backend/node_modules/bcryptjs');
  const { AuthModule } = require('../../backend/dist/auth/auth.module');
  const { PrismaService } = require('../../backend/dist/prisma.service');
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());
  for (const table of TABLES) await prisma.$executeRawUnsafe(`DELETE FROM \`${table}\``);
  const password = 'تست-#quoted\'\\🍦';
  const user = await prisma.user.create({ data: {
    firstName: 'محمد', lastName: 'تست🍦', phone: '09123456789', passwordHash: await bcrypt.hash(password, 4),
  } });
  const product = await prisma.product.create({ data: { name: "O'Reilly;\n-- بکاپ \\", baseUnitPrice: '9999999999.99', unitsPerCartonDefault: 24, createdById: user.id } });
  const customer = await prisma.customer.create({ data: { name: 'مشتری', assignedVisitorId: user.id, notes: 'خط اول\nخط دوم\\' } });
  await prisma.userProduct.create({ data: { userId: user.id, productId: product.id, customUnitPrice: '123.45' } });
  await prisma.vanInventory.create({ data: { userId: user.id, productId: product.id, quantityUnits: 3 } });
  const order = await prisma.order.create({ data: {
    localUuid: 'integration-test', invoiceNumber: '1405-000001', visitorId: user.id, customerId: customer.id,
    subtotalAmount: '100.10', finalAmount: '90.09', totalDiscountAmount: '10.01',
  } });
  await prisma.orderItem.create({ data: { orderId: order.id, productId: product.id, unitCount: 1, unitPriceSnapshot: '100.10', cartonPriceSnapshot: '2402.40', lineTotal: '100.10' } });
  await prisma.orderDiscountStep.create({ data: { orderId: order.id, stepOrder: 1, percent: '10.00', amountBeforeStep: '100.10', amountAfterStep: '90.09' } });
  const payment = await prisma.payment.create({ data: { orderId: order.id, method: 'CHECK', amount: '90.09' } });
  await prisma.check.create({ data: { paymentId: payment.id, checkNumber: '۱۲۳', dueDate: new Date('2027-01-01T12:00:00.123Z') } });
  await prisma.customerLedger.create({ data: { customerId: customer.id, relatedOrderId: order.id, relatedPaymentId: payment.id, type: 'PAYMENT_CREDIT', amount: '90.09', balanceAfter: '0' } });
  await prisma.invoiceSettings.create({ data: { userId: user.id, isDefault: true } });
  await prisma.invoiceCounter.create({ data: { solarYear: 1405, lastSeq: 1 } });

  const module = await Test.createTestingModule({ imports: [AuthModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
  const app = module.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const base = await app.getUrl();
  const login = pass => fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: user.phone, password: pass }),
  });

  const originalLogin = await login(password);
  assert.equal(originalLogin.status, 201);
  const token = (await originalLogin.json()).accessToken;
  const jwt = module.get(JwtService);
  assert.equal(jwt.verify(token).sub, user.id);
  assert.equal((await login('wrong-password')).status, 401);

  // The protected route goes through the real Passport JWT guard.
  const protectedResponse = await fetch(base + '/api/auth/profile', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ firstName: user.firstName, lastName: user.lastName }),
  });
  assert.equal(protectedResponse.status, 200);

  // Stored values keep their exact precision, escapes and timestamps.
  assert.equal((await prisma.product.findUnique({ where: { id: product.id } })).baseUnitPrice.toFixed(2), '9999999999.99');
  assert.equal((await prisma.check.findUnique({ where: { paymentId: payment.id } })).dueDate.toISOString(), '2027-01-01T12:00:00.123Z');
  assert.deepEqual(
    await prisma.user.findUnique({ where: { id: user.id }, select: { firstName: true, lastName: true, phone: true } }),
    { firstName: 'محمد', lastName: 'تست🍦', phone: '09123456789' },
  );
  assert.equal((await login(password)).status, 201, 'login still works after the profile write');
});
