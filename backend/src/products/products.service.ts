import { Injectable, Inject, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateProductDto, UpdateProductDto, UpdateUserProductDto } from './products.dto';

@Injectable()
export class ProductsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * دریافت لیست محصولات:
   * محصولات سراسری (isGlobal = true) + محصولاتی که خود کاربر ساخته است
   */
  async getProductsForUser(userId: string) {
    const products = await this.prisma.product.findMany({
      where: {
        OR: [
          { isGlobal: true },
          { createdById: userId },
        ],
      },
      include: {
        userSettings: {
          where: { userId },
        },
      },
      orderBy: [
        { brand: 'asc' },
        { name: 'asc' },
      ],
    });

    return products.map((p) => {
      const custom = p.userSettings[0];
      const effectiveUnitsPerCarton = custom?.customUnitsPerCarton || p.unitsPerCartonDefault;
      
      const defaultUnitPrice = Number(p.baseUnitPrice);
      const effectiveUnitPrice = custom?.customUnitPrice !== null && custom?.customUnitPrice !== undefined
        ? Number(custom.customUnitPrice)
        : defaultUnitPrice;

      const defaultCartonPrice = effectiveUnitPrice * effectiveUnitsPerCarton;
      const effectiveCartonPrice = custom?.customCartonPrice !== null && custom?.customCartonPrice !== undefined
        ? Number(custom.customCartonPrice)
        : defaultCartonPrice;

      return {
        id: p.id,
        name: p.name,
        brand: p.brand,
        category: p.category,
        imageUrl: p.imageUrl,
        baseUnitPrice: effectiveUnitPrice,
        unitsPerCarton: effectiveUnitsPerCarton,
        cartonPrice: effectiveCartonPrice,
        isGlobal: p.isGlobal,
        createdById: p.createdById,
        isCustomUserProduct: !p.isGlobal && p.createdById === userId,
        hasCustomPrice: !!custom && (custom.customCartonPrice !== null || custom.customUnitPrice !== null),
      };
    });
  }

  /**
   * دریافت آمار کاتالوگ‌های آماده موجود در دیتابیس (برای منوی کشویی کاتالوگ‌ها)
   */
  async getAvailableCatalogPresets() {
    const presets = await this.prisma.product.groupBy({
      by: ['brand'],
      where: { isGlobal: true },
      _count: { id: true },
    });

    return presets.map((item) => ({
      brand: item.brand,
      count: item._count.id,
    }));
  }

  /**
   * ایجاد محصول اختصاصی توسط خود کاربر
   */
  async createProductByUser(userId: string, dto: CreateProductDto) {
    const calculatedUnitPrice = dto.baseUnitPrice !== undefined && dto.baseUnitPrice !== null
      ? dto.baseUnitPrice
      : (dto.cartonPrice ? Math.round(dto.cartonPrice / dto.unitsPerCartonDefault) : 0);

    return this.prisma.product.create({
      data: {
        name: dto.name,
        brand: dto.brand || 'شخصی',
        category: dto.category || 'متفرقه',
        imageUrl: dto.imageUrl,
        baseUnitPrice: calculatedUnitPrice,
        unitsPerCartonDefault: dto.unitsPerCartonDefault,
        isGlobal: false,
        createdById: userId,
      },
    });
  }

  /**
   * ویرایش کامل محصول دست‌ساز خود کاربر (نام، برند، دسته، قیمت، تعداد)
   */
  async updateProductByUser(userId: string, productId: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException('محصول یافت نشد.');
    }

    if (product.isGlobal || product.createdById !== userId) {
      throw new ForbiddenException('ویرایش مشخصات اصلی فقط برای محصولات اختصاصی شما مجاز است.');
    }

    const units = dto.unitsPerCartonDefault || product.unitsPerCartonDefault;
    let unitPrice = dto.baseUnitPrice;
    if (unitPrice === undefined && dto.cartonPrice !== undefined) {
      unitPrice = units > 0 ? Math.round(dto.cartonPrice / units) : 0;
    }

    return this.prisma.product.update({
      where: { id: productId },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.brand ? { brand: dto.brand } : {}),
        ...(dto.category ? { category: dto.category } : {}),
        ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
        ...(dto.unitsPerCartonDefault ? { unitsPerCartonDefault: dto.unitsPerCartonDefault } : {}),
        ...(unitPrice !== undefined ? { baseUnitPrice: unitPrice } : {}),
      },
    });
  }

  /**
   * ویرایش قیمت/تعداد سفارشی کاربر برای هر محصول کاتالوگ شرکتی
   */
  async updateCustomPrice(userId: string, productId: string, dto: UpdateUserProductDto) {
    return this.prisma.userProduct.upsert({
      where: {
        userId_productId: { userId, productId },
      },
      create: {
        userId,
        productId,
        customCartonPrice: dto.customCartonPrice,
        customUnitPrice: dto.customUnitPrice,
        customUnitsPerCarton: dto.customUnitsPerCarton,
      },
      update: {
        customCartonPrice: dto.customCartonPrice,
        customUnitPrice: dto.customUnitPrice,
        customUnitsPerCarton: dto.customUnitsPerCarton,
      },
    });
  }

  /**
   * بازنشانی (Reset) قیمت تک‌محصول به قیمت پایه پیش‌فرض کارخانه/سرور
   */
  async resetSingleProductPrice(userId: string, productId: string) {
    try {
      await this.prisma.userProduct.delete({
        where: {
          userId_productId: { userId, productId },
        },
      });
    } catch (e) {
      // اگر قبلاً رکوردی نبوده نادیده گرفته می‌شود
    }
    return { success: true, message: 'قیمت محصول به قیمت پایه کارخانه بازگردانده شد.' };
  }

  /**
   * بازنشانی تمام قیمت‌های سفارشی یک برند به قیمت پایه سرور
   */
  async resetBrandCustomPrices(userId: string, brandName: string) {
    const products = await this.prisma.product.findMany({
      where: { brand: brandName, isGlobal: true },
      select: { id: true },
    });

    const productIds = products.map((p) => p.id);

    await this.prisma.userProduct.deleteMany({
      where: {
        userId,
        productId: { in: productIds },
      },
    });

    return {
      success: true,
      message: `تمام قیمت‌های کاتالوگ «${brandName}» به قیمت رسمی پایه بازنشانی شدند.`,
      count: productIds.length,
    };
  }

  /**
   * حذف محصول: صرفاً برای محصولاتی که خود کاربر ایجاد کرده است (نه کاتالوگ سراسری)
   */
  async deleteUserCreatedProduct(userId: string, productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        orderItems: { select: { id: true }, take: 1 },
      },
    });

    if (!product) {
      throw new NotFoundException('محصول یافت نشد.');
    }

    if (product.isGlobal || product.createdById !== userId) {
      throw new BadRequestException('شما فقط مجاز به حذف کالاهای اختصاصی ساخته شده توسط خودتان هستید.');
    }

    if (product.orderItems && product.orderItems.length > 0) {
      throw new BadRequestException('این محصول قبلاً در فاکتورهای فروش ثبت شده و امکان حذف آن وجود ندارد.');
    }

    await this.prisma.product.delete({
      where: { id: productId },
    });

    return { success: true, message: 'محصول اختصاصی با موفقیت حذف شد.' };
  }
}
