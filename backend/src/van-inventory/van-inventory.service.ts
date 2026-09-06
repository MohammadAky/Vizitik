import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { BulkUpdateInventoryDto, InventoryItemDto } from './van-inventory.dto';

@Injectable()
export class VanInventoryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * دریافت موجودی خودرو به همراه محاسبات کامل قیمت و ارزش ریالی در سمت بک‌اند
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
      const cartons = inv?.quantityCartons || 0;
      const looseUnits = inv?.quantityUnits || 0;
      const itemTotalUnits = (cartons * unitsPerCarton) + looseUnits;

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
      for (const item of positiveItems) {
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
            quantityCartons: item.quantityCartons || 0,
            quantityUnits: item.quantityUnits || 0,
          },
          update: {
            quantityCartons: item.quantityCartons || 0,
            quantityUnits: item.quantityUnits || 0,
          },
        });
      }
    });

    return this.getInventoryForVisitor(userId);
  }

  async updateSingleItem(userId: string, dto: InventoryItemDto) {
    const cartons = dto.quantityCartons || 0;
    const units = dto.quantityUnits || 0;

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
