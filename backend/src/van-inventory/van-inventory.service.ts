import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { BulkUpdateInventoryDto, InventoryItemDto } from './van-inventory.dto';
import { normalizeStock } from '../common/inventory-units';

@Injectable()
export class VanInventoryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * دریافت موجودی خودرو به همراه محاسبات کامل قیمت و ارزش ریالی در سمت بک‌اند
   * خروجی همیشه «شکسته‌شده به کارتن» است (quantityUnits همواره < unitsPerCarton)
   * پس همهٔ مصرف‌کننده‌ها (بارگیری، ثبت فاکتور PHP/PWA) بدون تغییر نمایش درست می‌گیرند.
   */
  async getInventoryForVisitor(userId: string) {
    const products = await this.prisma.product.findMany({
      where: {
        OR: [
          { isGlobal: true },
          { createdById: userId },
        ],
      },
      include: {
        userSettings: { where: { userId } },
        vanInventory: { where: { userId } },
      },
      orderBy: [
        { brand: 'asc' },
        { name: 'asc' },
      ],
    });

    let totalCartons = 0;
    let totalLooseUnits = 0;
    let totalSingleUnits = 0;
    let totalInventoryValue = 0;

    const items = products.map((p) => {
      const inv = p.vanInventory[0];
      const custom = p.userSettings[0];
      const unitsPerCarton = custom?.customUnitsPerCarton || p.unitsPerCartonDefault || 24;

      // ✨ شکستن موجودی به کارتن: مثلاً ۲ کارتن + ۵۵ دانه از کارتن ۲۴تایی → ۴ کارتن و ۷ دانه
      const stock = normalizeStock(inv?.quantityCartons || 0, inv?.quantityUnits || 0, unitsPerCarton);
      const cartons = stock.cartons;
      const looseUnits = stock.units;
      const itemTotalUnits = stock.totalSingleUnits;

      const defaultUnitPrice = Number(p.baseUnitPrice);
      const effectiveUnitPrice = custom?.customUnitPrice !== null && custom?.customUnitPrice !== undefined
        ? Number(custom.customUnitPrice)
        : defaultUnitPrice;

      const defaultCartonPrice = effectiveUnitPrice * unitsPerCarton;
      const effectiveCartonPrice = custom?.customCartonPrice !== null && custom?.customCartonPrice !== undefined
        ? Number(custom.customCartonPrice)
        : defaultCartonPrice;

      const itemTotalValue = (cartons * effectiveCartonPrice) + (looseUnits * effectiveUnitPrice);

      totalCartons += cartons;
      totalLooseUnits += looseUnits;
      totalSingleUnits += itemTotalUnits;
      totalInventoryValue += itemTotalValue;

      return {
        productId: p.id,
        productName: p.name,
        brand: p.brand || 'متفرقه',
        category: p.category || 'سایر',
        imageUrl: p.imageUrl,
        unitsPerCarton,
        unitPrice: effectiveUnitPrice,
        cartonPrice: effectiveCartonPrice,
        quantityCartons: cartons,
        quantityUnits: looseUnits,
        totalSingleUnits: itemTotalUnits,
        itemTotalValue,
        isGlobal: p.isGlobal,
        isCustomUserProduct: !p.isGlobal && p.createdById === userId,
      };
    });

    return {
      summary: {
        totalCartons,
        totalLooseUnits,
        totalSingleUnits,
        totalInventoryValue,
      },
      items,
    };
  }

  /**
   * بازیابی قامت ظرفیت کارتن برای دسته‌ای از محصولات (با اولویت تنظیم شخصی کاربر)
   *
   * نکتهٔ تایپ (باگ TS2345 در بیلد): پارامتر `client` عمداً `any`-پذیر است تا هم
   * `this.prisma` و هم تراکنشِ `tx` را بپذیرد. ولی وقتی ورودیِ `new Map()`
   * نوعش `any` باشد، TypeScript کلید/مقدار را `unknown` استنتاج می‌کند و
   * `.get()` مقدار `unknown` می‌دهد؛ بعد `upcMap.get(...) || 24` که به تابعی با
   * پارامتر `number` پاس داده می‌شود با `error TS2345` بیلد را می‌شکند.
   * پس نوعِ خروجی صریح است و ردیف‌ها هم صریحاً [string, number] ساخته می‌شوند.
   * `Number(...)` هم جلوی مقادیر رشته‌ای/Decimal دیتابیس را می‌گیرد.
   */
  private async unitsPerCartonMap(
    userId: string,
    client: PrismaService | any = this.prisma,
  ): Promise<Map<string, number>> {
    const products = await client.product.findMany({
      where: { OR: [{ isGlobal: true }, { createdById: userId }] },
      include: { userSettings: { where: { userId } } },
    });
    const entries: [string, number][] = (products || []).map((p: any) => {
      const raw = p?.userSettings?.[0]?.customUnitsPerCarton || p?.unitsPerCartonDefault || 24;
      const units = Number(raw);
      return [String(p?.id ?? ''), Number.isFinite(units) && units > 0 ? units : 24];
    });
    return new Map<string, number>(entries);
  }

  async updateBulkInventory(userId: string, dto: BulkUpdateInventoryDto) {
    // تفکیک کالاهای بارگیری‌شده از کالاهای بدون موجودی جهت جلوگیری از افزونگی و رکوردهای پوچ
    const positiveItems = (dto.items || []).filter(
      (item) => (item.quantityCartons || 0) > 0 || (item.quantityUnits || 0) > 0,
    );
    const zeroProductIds = (dto.items || [])
      .filter((item) => (item.quantityCartons || 0) <= 0 && (item.quantityUnits || 0) <= 0)
      .map((item) => item.productId);

    await this.prisma.$transaction(async (tx) => {
      // ۱. حذف رکوردهای صفر شده از جدول ون برای جلوگیری از اشغال بیهوده دیتابیس
      if (zeroProductIds.length > 0) {
        await tx.vanInventory.deleteMany({
          where: {
            userId,
            productId: { in: zeroProductIds },
          },
        });
      }

      // ۲. ذخیره/به‌روزرسانی اختصاصی فقط اقلامی که واقعاً در ون بارگیری شده‌اند
      //    ورودی قبل از ذخیره به فرم شکسته‌شده نرمال می‌شود (دانه همیشه < ظرفیت کارتن)
      const upcMap = await this.unitsPerCartonMap(userId, tx);
      for (const item of positiveItems) {
        const stock = normalizeStock(
          item.quantityCartons || 0,
          item.quantityUnits || 0,
          upcMap.get(item.productId) || 24,
        );
        await tx.vanInventory.upsert({
          where: {
            userId_productId: {
              userId,
              productId: item.productId,
            },
          },
          create: {
            userId,
            productId: item.productId,
            quantityCartons: stock.cartons,
            quantityUnits: stock.units,
          },
          update: {
            quantityCartons: stock.cartons,
            quantityUnits: stock.units,
          },
        });
      }
    });

    return this.getInventoryForVisitor(userId);
  }

  async updateSingleItem(userId: string, dto: InventoryItemDto) {
    const upcMap = await this.unitsPerCartonMap(userId);
    const stock = normalizeStock(
      dto.quantityCartons || 0,
      dto.quantityUnits || 0,
      upcMap.get(dto.productId) || 24,
    );
    const cartons = stock.cartons;
    const units = stock.units;

    if (cartons <= 0 && units <= 0) {
      // اگر موجودی کالا صفر شد، رکورد آن از جدول ون حذف می‌شود
      await this.prisma.vanInventory.deleteMany({
        where: {
          userId,
          productId: dto.productId,
        },
      });
    } else {
      await this.prisma.vanInventory.upsert({
        where: {
          userId_productId: {
            userId,
            productId: dto.productId,
          },
        },
        create: {
          userId,
          productId: dto.productId,
          quantityCartons: cartons,
          quantityUnits: units,
        },
        update: {
          quantityCartons: cartons,
          quantityUnits: units,
        },
      });
    }

    return this.getInventoryForVisitor(userId);
  }
}
