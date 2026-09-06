import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function seed() {
  console.log('🌱 شروع درج داده‌های اولیه (Seed)...');

  // ۱. ساخت کاربر ویزیتور
  const passwordHash = await bcrypt.hash('123456', 10);
  const visitor = await prisma.user.upsert({
    where: { phone: '09121234567' },
    update: {},
    create: {
      firstName: 'علی',
      lastName: 'حسینی',
      phone: '09121234567',
      passwordHash,
      baleChatId: '542633638',
      role: 'VISITOR',
    },
  });
  console.log(`👤 ویزیتور: ${visitor.firstName} ${visitor.lastName} (${visitor.phone})`);

  // ۲. محصولات کاتالوگ آماده
  const productsData = [
    { name: 'بستنی چوبی سالار مگنوم', brand: 'میهن', category: 'چوبی', unitsPerCartonDefault: 24, cartonPrice: 720000 },
    { name: 'بستنی قیفی دابل چاکلت', brand: 'دومینو', category: 'قیفی', unitsPerCartonDefault: 20, cartonPrice: 500000 },
    { name: 'بستنی سنتی زعفرانی مخصوص', brand: 'حاج حسن', category: 'سنتی', unitsPerCartonDefault: 12, cartonPrice: 420000 },
    { name: 'بستنی لیوانی وانیل پسته', brand: 'کاله', category: 'لیوانی', unitsPerCartonDefault: 30, cartonPrice: 600000 },
    { name: 'بستنی حصیری زعفرانی', brand: 'پاک', category: 'سنتی', unitsPerCartonDefault: 24, cartonPrice: 480000 },
    { name: 'بستنی خانواده یک لیتری شکلات', brand: 'دومینو', category: 'خانواده', unitsPerCartonDefault: 6, cartonPrice: 390000 },
    { name: 'بستنی یخی آلبالو و لیمو', brand: 'میهن', category: 'یخی', unitsPerCartonDefault: 30, cartonPrice: 300000 },
    { name: 'بستنی قیفی لاله وانیلی', brand: 'پاک', category: 'قیفی', unitsPerCartonDefault: 24, cartonPrice: 480000 },
  ];

  for (const p of productsData) {
    const baseUnitPrice = Math.round(p.cartonPrice / p.unitsPerCartonDefault);
    const existing = await prisma.product.findFirst({
      where: { name: p.name, brand: p.brand },
    });

    if (!existing) {
      await prisma.product.create({
        data: {
          name: p.name,
          brand: p.brand,
          category: p.category,
          unitsPerCartonDefault: p.unitsPerCartonDefault,
          baseUnitPrice,
          isGlobal: true,
          createdById: visitor.id,
        },
      });
    }
  }

  // ۳. ایجاد مشتری‌های نمونه
  const customersData = [
    { name: 'سوپرمارکت امید (آقای رضایی)', phone: '09121112233', address: 'خیابان آزادی، نبش کوچه ۴' },
    { name: 'هایپرمارکت بهار (خانم محمدی)', phone: '09123334455', address: 'میدان انقلاب، جنب بانک ملت' },
    { name: 'سوپر گلستان (آقای احمدی)', phone: '09125556677', address: 'بلوار کشاورز، پلاک ۱۲' },
  ];

  for (const c of customersData) {
    const existing = await prisma.customer.findFirst({
      where: { name: c.name },
    });
    if (!existing) {
      await prisma.customer.create({
        data: {
          name: c.name,
          phone: c.phone,
          address: c.address,
          assignedVisitorId: visitor.id,
        },
      });
    }
  }

  console.log('✅ درج داده‌های اولیه با موفقیت انجام شد.');
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
