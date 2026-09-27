import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { BaleService } from '../bale/bale.service';
import { CreateOrderDto, UpdateOrderDto } from './orders.dto';
import { normalizeStock, splitByCarton, toTotalSingleUnits } from '../common/inventory-units';

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BaleService) private readonly baleService: BaleService,
  ) {}

  /** محاسبهٔ سال شمسی یک تاریخ (برای پیشوند شماره فاکتور) */
  private solarYearOf(date: Date): number {
    const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric' }).formatToParts(date);
    const year = parts.find((p) => p.type === 'year')?.value;
    return Number(year || 0);
  }

  /**
   * یکسان‌سازی پله‌های تخفیف به یک ترتیب مشخص:
   * اگر کلاینت پله‌ها را به‌صورت مرتب (percent/fixed) بفرستد همان را نگه می‌دارد؛
   * در غیر این صورت (سازگاری با نسخهٔ قبل) اول همهٔ درصدها و بعد مبلغ ثابت اعمال می‌شود.
   */
  private normalizeDiscountSteps(dto: any): { type: string; value: number }[] {
    if (dto.discountSteps && Array.isArray(dto.discountSteps) && dto.discountSteps.length > 0) {
      return dto.discountSteps
        .map((s: any) => ({ type: s.type === "fixed" ? "fixed" : "percent", value: Math.round(Number(s.value) || 0) }))
        .filter((s: any) => s.value > 0);
    }
    const steps: { type: string; value: number }[] = [];
    if (dto.discountPercentages) {
      (dto.discountPercentages as number[]).forEach((p) => {
        if (Number(p) > 0) steps.push({ type: "percent", value: Number(p) });
      });
    }
    if (dto.fixedDiscountAmount && Number(dto.fixedDiscountAmount) > 0) {
      steps.push({ type: "fixed", value: Math.round(Number(dto.fixedDiscountAmount)) });
    }
    return steps;
  }

  /**
   * موتور تخفیف یکپارچه (همان الگوریتمی که در فرانت‌اند صفحهٔ تسویه نیز اجرا می‌شود):
   * هر پله به تومانِ صحیح گرد می‌شود تا عددِ میانی هرگز اعشاری نماند و نتیجه همیشه
   * عددِ صحیحِ تومان باشد → هیچ باقیماندهٔ کسریِ «نسیهٔ ناخواسته» تولید نمی‌شود.
   */
  private computeDiscounts(subtotal: number, steps: { type: string; value: number }[]) {
    const discountStepsData: any[] = [];
    let current = subtotal;
    let totalDiscountAmount = 0;
    let order = 1;

    for (const s of steps) {
      let stepDiscount = 0;
      if (s.type === "percent" && s.value > 0) {
        stepDiscount = Math.round((current * s.value) / 100);
      } else if (s.type === "fixed" && s.value > 0) {
        stepDiscount = Math.min(current, s.value);
      }
      if (stepDiscount > 0) {
        const afterStep = current - stepDiscount;
        discountStepsData.push({
          stepOrder: order,
          percent: s.type === "percent" ? s.value : 0,
          amountBeforeStep: current,
          amountAfterStep: afterStep,
        });
        totalDiscountAmount += stepDiscount;
        current = afterStep;
        order += 1;
      }
    }

    const finalAmount = Math.max(0, Math.round(current));
    return { discountStepsData, totalDiscountAmount, finalAmount };
  }

  /** برای فاکتورهای قدیمی‌ای که شمارهٔ ترتیبی ندارند، همان رفتار قبلی (برگرفته از localUuid) */
  private legacyInvoiceNumber(order: { id: string; localUuid: string }): string {
    const src = order.localUuid || order.id;
    return src.length > 8 ? src.substring(0, 8).toUpperCase() : src;
  }

  /** تخصیص اتمیکِ شمارهٔ بعدی برای سالِ داده‌شده داخل تراکنش */
  private async reserveInvoiceNumber(tx: any, date: Date): Promise<string> {
    const year = this.solarYearOf(date);

    // شماره فاکتور از ۰۰۱۰۰۰ شروع می‌شود (lastSeq با مقدار ۹۹۹ مقداردهی می‌شود تا اولین شماره ۱۰۰۰ شود)
    const START_SEQ = 999;

    // اگر شمارنده برای این سال نبود، مقداردهی اولیه (بدون ریسکِ رقابت، چون فقط ردیف اولیه را می‌سازد)
    await tx.$executeRaw`
      INSERT INTO invoice_counters (\`solarYear\`, \`lastSeq\`)
      VALUES (${year}, ${START_SEQ})
      ON DUPLICATE KEY UPDATE \`solarYear\` = \`solarYear\`
    `;
    // افزایش اتمیک (قفلِ ردیف) — امن در برابر درخواست‌های هم‌زمان
    await tx.$executeRaw`
      UPDATE invoice_counters SET \`lastSeq\` = \`lastSeq\` + 1 WHERE \`solarYear\` = ${year}
    `;
    const counter = await tx.invoiceCounter.findUnique({ where: { solarYear: year } });
    const seq = counter ? counter.lastSeq : START_SEQ + 1;

    return `${year}-${String(seq).padStart(6, '0')}`;
  }

  async createOrder(visitorId: string, dto: CreateOrderDto) {
    const existingOrder = await this.prisma.order.findUnique({
      where: { localUuid: dto.localUuid },
    });
    if (existingOrder) {
      return this.getOrderInvoice(visitorId, existingOrder.id);
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
      include: {
        ledgerEntries: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!customer) {
      throw new NotFoundException('مشتری یافت نشد');
    }
    if (customer.assignedVisitorId !== visitorId) {
      throw new ForbiddenException('شما دسترسی به این مشتری را ندارید');
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('حداقل یک محصول باید در سفارش ثبت شود');
    }

    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      include: {
        userSettings: { where: { userId: visitorId } },
      },
    });

    const productMap = new Map(products.map((p) => [p.id, p]));

    let subtotalAmount = 0;
    const orderItemsData: any[] = [];
    const inventoryDeductions: { productId: string; cartonCount: number; unitCount: number; unitsPerCarton: number }[] = [];

    for (const item of dto.items) {
      const prod = productMap.get(item.productId);
      if (!prod) {
        throw new BadRequestException(`محصول با شناسه ${item.productId} معتبر نیست`);
      }

      const custom = prod.userSettings[0];
      const unitsPerCarton = custom?.customUnitsPerCarton || prod.unitsPerCartonDefault;
      
      const unitPrice = custom?.customUnitPrice !== null && custom?.customUnitPrice !== undefined
        ? Number(custom.customUnitPrice)
        : Number(prod.baseUnitPrice);

      const defaultCartonPrice = unitPrice * unitsPerCarton;
      const cartonPrice = custom?.customCartonPrice !== null && custom?.customCartonPrice !== undefined
        ? Number(custom.customCartonPrice)
        : defaultCartonPrice;

      const lineTotal = item.cartonCount * cartonPrice + item.unitCount * unitPrice;
      subtotalAmount += lineTotal;

      orderItemsData.push({
        productId: prod.id,
        cartonCount: item.cartonCount,
        unitCount: item.unitCount,
        cartonPriceSnapshot: cartonPrice,
        unitPriceSnapshot: unitPrice,
        lineTotal,
      });

      inventoryDeductions.push({
        productId: prod.id,
        cartonCount: item.cartonCount,
        unitCount: item.unitCount,
        unitsPerCarton,
      });
    }

    // محاسبه تخفیف‌ها با موتور یکپارچه (پله‌ها به‌ترتیب ورود و با گردِ هر پله به تومان صحیح)
    const steps = this.normalizeDiscountSteps(dto);
    const { discountStepsData, totalDiscountAmount, finalAmount } = this.computeDiscounts(subtotalAmount, steps);

    const result = await this.prisma.$transaction(async (tx) => {
      // تخصیص شمارهٔ فاکتور ترتیبی (یکسان در سراسر سیستم) قبل از درج سفارش
      const invoiceNumber = await this.reserveInvoiceNumber(tx, new Date());

      const order = await tx.order.create({
        data: {
          localUuid: dto.localUuid,
          invoiceNumber,
          customerId: customer.id,
          visitorId,
          status: 'CONFIRMED',
          subtotalAmount,
          totalDiscountAmount,
          finalAmount,
          isSynced: true,
          items: {
            create: orderItemsData,
          },
          discountSteps: {
            create: discountStepsData,
          },
        },
      });

      for (const deduction of inventoryDeductions) {
        const inv = await tx.vanInventory.findUnique({
          where: {
            userId_productId: {
              userId: visitorId,
              productId: deduction.productId,
            },
          },
        });

        if (inv) {
          // کسر بر مبنای «مجموع دانه» و شکستن مجدد به کارتن — بدون این کار،
          // رکورد شکسته‌نشده (مثل ۰ کارتن + ۲۴ دانه) هیچ‌وقت از فروش کارتنی کم نمی‌شد
          const stockBefore = normalizeStock(inv.quantityCartons, inv.quantityUnits, deduction.unitsPerCarton);
          const sellTotal = toTotalSingleUnits(deduction.cartonCount, deduction.unitCount, deduction.unitsPerCarton);
          const after = splitByCarton(Math.max(0, stockBefore.totalSingleUnits - sellTotal), deduction.unitsPerCarton);
          const newCartons = after.cartons;
          const newUnits = after.units;

          if (newCartons === 0 && newUnits === 0) {
            // در صورت صفر شدن کامل موجودی، رکورد پاک می‌شود تا افزونگی در دیتابیس ایجاد نشود
            await tx.vanInventory.delete({
              where: {
                userId_productId: {
                  userId: visitorId,
                  productId: deduction.productId,
                },
              },
            });
          } else {
            await tx.vanInventory.update({
              where: {
                userId_productId: {
                  userId: visitorId,
                  productId: deduction.productId,
                },
              },
              data: {
                quantityCartons: newCartons,
                quantityUnits: newUnits,
              },
            });
          }
        }
      }

      const previousBalance = customer.ledgerEntries.length > 0
        ? Number(customer.ledgerEntries[0].balanceAfter)
        : 0;

      let runningBalance = previousBalance + finalAmount;

      await tx.customerLedger.create({
        data: {
          customerId: customer.id,
          type: 'ORDER_DEBIT',
          relatedOrderId: order.id,
          amount: finalAmount,
          balanceAfter: runningBalance,
        },
      });

      if (dto.payments && dto.payments.length > 0) {
        for (const p of dto.payments) {
          const payment = await tx.payment.create({
            data: {
              orderId: order.id,
              method: p.method as any,
              amount: p.amount,
            },
          });

          if (p.method === 'CHECK' && p.checkDetails) {
            await tx.check.create({
              data: {
                paymentId: payment.id,
                checkNumber: p.checkDetails.checkNumber,
                bankName: p.checkDetails.bankName,
                dueDate: new Date(p.checkDetails.dueDate),
                status: 'PENDING',
              },
            });
          }

          // CASH, CARD, and CHECK all reduce customer debt
          if (p.method === 'CASH' || p.method === 'CARD' || p.method === 'CHECK') {
            runningBalance -= p.amount;
            await tx.customerLedger.create({
              data: {
                customerId: customer.id,
                type: 'PAYMENT_CREDIT',
                relatedOrderId: order.id,
                relatedPaymentId: payment.id,
                amount: -p.amount,
                balanceAfter: runningBalance,
              },
            });
          }
        }
      }

      return order;
    });

    const invoice = await this.getOrderInvoice(visitorId, result.id);

    // ارسال خودکار و اصولی فاکتور صادر شده به بله ویزیتور و مشتری
    this.baleService.sendInvoiceNotification(result.id).catch(() => {});

    return invoice;
  }

  /**
   * ابطال کامل فاکتور (مثلاً وقتی مشتری کلا منصرف شده):
   *  ۱) اقلام فاکتور به موجودی خودرو (ون) بازمی‌گردند
   *  ۲) خالص فاکتور در دفتر حساب مشتری معکوس می‌شود (یک سورتکس ADJUSTMENT/PAYMENT_CREDIT)
   *  ۳) وضعیت فاکتور CANCELLED می‌شود — خود فاکتور و سوابقش باقی می‌ماند (تاریخ‌ساز)
   *
   * نکته: پرداخت نقد/پوز/چک در لحظهٔ ثبت، اعتبار (PAYMENT_CREDIT) زده به حساب مشتری
   * کرده است؛ پس خالصِ فاکتور = مبلغ نهایی - (نقد + پوز + چک).
   */
  async cancelOrder(visitorId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: {
          include: { ledgerEntries: { orderBy: { createdAt: 'desc' }, take: 1 } },
        },
        items: true,
        payments: true,
      },
    });

    if (!order) {
      throw new NotFoundException('فاکتور یافت نشد');
    }
    if (order.visitorId !== visitorId) {
      throw new ForbiddenException('دسترسی غیرمجاز');
    }
    if (order.status === 'CANCELLED') {
      throw new BadRequestException('این فاکتور قبلاً ابطال شده است');
    }

    const finalAmount = Number(order.finalAmount);
    const creditedPayments = order.payments
      .filter((p) => p.method === 'CASH' || p.method === 'CARD' || p.method === 'CHECK')
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const netDebt = finalAmount - creditedPayments;

    await this.prisma.$transaction(async (tx) => {
      // ۱) بازگردانی اقلام به موجودی خودرو — افزایش بر مبنای مجموع دانه و شکستن مجدد
      const restockProducts = await tx.product.findMany({
        where: { id: { in: order.items.map((i) => i.productId) } },
        include: { userSettings: { where: { userId: visitorId } } },
      });
      const restockUpc = new Map(
        restockProducts.map((p) => [
          p.id,
          p.userSettings[0]?.customUnitsPerCarton || p.unitsPerCartonDefault || 24,
        ]),
      );

      for (const item of order.items) {
        if (!item.cartonCount && !item.unitCount) continue;
        const upc = restockUpc.get(item.productId) || 24;
        const existing = await tx.vanInventory.findUnique({
          where: {
            userId_productId: {
              userId: visitorId,
              productId: item.productId,
            },
          },
        });
        const before = normalizeStock(existing?.quantityCartons || 0, existing?.quantityUnits || 0, upc);
        const restored = splitByCarton(
          before.totalSingleUnits + toTotalSingleUnits(item.cartonCount || 0, item.unitCount || 0, upc),
          upc,
        );
        await tx.vanInventory.upsert({
          where: {
            userId_productId: {
              userId: visitorId,
              productId: item.productId,
            },
          },
          create: {
            userId: visitorId,
            productId: item.productId,
            quantityCartons: restored.cartons,
            quantityUnits: restored.units,
          },
          update: {
            quantityCartons: restored.cartons,
            quantityUnits: restored.units,
          },
        });
      }

      // ۲) معکوس‌سازی خالص فاکتور در دفتر حساب مشتری
      if (netDebt !== 0) {
        const lastBalance =
          order.customer.ledgerEntries.length > 0
            ? Number(order.customer.ledgerEntries[0].balanceAfter)
            : 0;
        const newBalance = Math.max(0, lastBalance - netDebt);
        await tx.customerLedger.create({
          data: {
            customerId: order.customer.id,
            type: netDebt > 0 ? 'PAYMENT_CREDIT' : 'ADJUSTMENT',
            relatedOrderId: order.id,
            amount: -netDebt,
            balanceAfter: newBalance,
          },
        });
      }

      // ۳) ابطال فاکتور
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' },
      });
    });

    return {
      ok: true,
      message: 'فاکتور ابطال شد، اقلام به موجودی خودرو بازمگرداند و حساب مشتری اصلاح شد.',
    };
  }



  async getOrderInvoice(visitorId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        visitor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
        items: {
          include: {
            product: true,
          },
        },
        discountSteps: {
          orderBy: { stepOrder: 'asc' },
        },
        payments: {
          include: {
            check: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('فاکتور یافت نشد');
    }

    if (order.visitorId !== visitorId) {
      throw new ForbiddenException('دسترسی غیرمجاز');
    }

    return {
      orderId: order.id,
      invoiceNumber: order.invoiceNumber || this.legacyInvoiceNumber(order),
      orderDate: order.orderDate,
      status: order.status,
      customer: {
        id: order.customer.id,
        name: order.customer.name,
        address: order.customer.address,
        phone: order.customer.phone,
      },
      visitor: {
        name: `${order.visitor.firstName} ${order.visitor.lastName}`,
        phone: order.visitor.phone,
      },
      items: order.items.map((i) => {
        const unitsPerCarton = i.product.unitsPerCartonDefault || 1;
        const totalUnits = (i.cartonCount * unitsPerCarton) + i.unitCount;

        return {
          productId: i.productId,
          productName: i.product.name,
          brand: i.product.brand,
          category: i.product.category,
          unitsPerCarton,
          cartonCount: i.cartonCount,
          unitCount: i.unitCount,
          totalUnits,
          cartonPrice: Number(i.cartonPriceSnapshot),
          unitPrice: Number(i.unitPriceSnapshot),
          lineTotal: Number(i.lineTotal),
        };
      }),
      pricing: {
        subtotal: Number(order.subtotalAmount),
        discountSteps: order.discountSteps.map((s) => ({
          step: s.stepOrder,
          percent: Number(s.percent),
          before: Number(s.amountBeforeStep),
          after: Number(s.amountAfterStep),
        })),
        totalDiscount: Number(order.totalDiscountAmount),
        finalAmount: Number(order.finalAmount),
      },
      payments: order.payments.map((p) => ({
        id: p.id,
        method: p.method,
        amount: Number(p.amount),
        paidAt: p.paidAt,
        check: p.check ? {
          checkNumber: p.check.checkNumber,
          bankName: p.check.bankName,
          dueDate: p.check.dueDate,
          status: p.check.status,
        } : null,
      })),
    };
  }

  async getOrders(visitorId: string, startDate?: string, endDate?: string) {
    const whereClause: any = { visitorId };

    if (startDate || endDate) {
      whereClause.orderDate = {};
      if (startDate) whereClause.orderDate.gte = new Date(startDate);
      if (endDate) whereClause.orderDate.lte = new Date(endDate);
    }

    const orders = await this.prisma.order.findMany({
      where: whereClause,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        items: {
          include: {
            product: { select: { name: true, brand: true, category: true, unitsPerCartonDefault: true } },
          },
        },
        discountSteps: { orderBy: { stepOrder: 'asc' } },
        payments: { include: { check: true } },
      },
      orderBy: { orderDate: 'desc' },
    });

    return orders.map((o) => {
      const totalCartons = o.items.reduce((sum, item) => sum + item.cartonCount, 0);
      const totalIndividualUnits = o.items.reduce((sum, item) => sum + item.unitCount, 0);

      return {
        id: o.id,
        invoiceNumber: o.invoiceNumber || this.legacyInvoiceNumber(o),
        orderDate: o.orderDate,
        customer: {
          id: o.customer.id,
          name: o.customer.name,
          phone: o.customer.phone,
        },
        summary: {
          totalCartons,
          totalIndividualUnits,
          totalItemsCount: o.items.length,
        },
        items: o.items.map((item) => ({
          productId: item.productId,
          productName: item.product.name,
          brand: item.product.brand,
          category: item.product.category,
          cartonCount: item.cartonCount,
          unitCount: item.unitCount,
          unitsPerCarton: item.product.unitsPerCartonDefault,
          totalUnits: (item.cartonCount * item.product.unitsPerCartonDefault) + item.unitCount,
          cartonPrice: Number(item.cartonPriceSnapshot),
          unitPrice: Number(item.unitPriceSnapshot),
          lineTotal: Number(item.lineTotal),
        })),
        discountSteps: o.discountSteps.map((d) => ({
          step: d.stepOrder,
          percent: Number(d.percent),
        })),
        payments: o.payments.map((p) => ({
          id: p.id,
          method: p.method,
          amount: Number(p.amount),
          check: p.check ? {
            checkNumber: p.check.checkNumber,
            bankName: p.check.bankName,
            dueDate: p.check.dueDate,
          } : null,
        })),
        subtotalAmount: Number(o.subtotalAmount),
        totalDiscountAmount: Number(o.totalDiscountAmount),
        finalAmount: Number(o.finalAmount),
        status: o.status,
      };
    });
  }

  /**
   * ویرایش جامع فاکتور (تعداد کارتن، دانه، افزودن/حذف کالا، تخفیفات و روش‌های تسویه)
   * به همراه به‌روزرسانی هوشمند انبار خودرو و دفتر حساب مشتری
   */
  async updateFullOrder(visitorId: string, orderId: string, dto: UpdateOrderDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: {
          include: {
            ledgerEntries: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
        items: true,
        discountSteps: true,
        payments: true,
      },
    });

    if (!order) {
      throw new NotFoundException('فاکتور یافت نشد');
    }
    if (order.visitorId !== visitorId) {
      throw new ForbiddenException('دسترسی غیرمجاز');
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('فاکتور باید حداقل دارای یک قلم کالا باشد');
    }

    // ۱. محاسبه مبالغ قبلی
    const oldFinalAmount = Number(order.finalAmount);
    const oldPaidAmount = order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const oldCreditAmount = Math.max(0, oldFinalAmount - oldPaidAmount);

    // ۲. دریافت اطلاعات محصولات جدید
    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      include: {
        userSettings: { where: { userId: visitorId } },
      },
    });

    const productMap = new Map(products.map((p) => [p.id, p]));

    let newSubtotalAmount = 0;
    const newOrderItemsData: any[] = [];

    for (const item of dto.items) {
      const prod = productMap.get(item.productId);
      if (!prod) {
        throw new BadRequestException(`کالای ${item.productId} معتبر نیست`);
      }

      const custom = prod.userSettings[0];
      const unitsPerCarton = custom?.customUnitsPerCarton || prod.unitsPerCartonDefault;

      const unitPrice = custom?.customUnitPrice !== null && custom?.customUnitPrice !== undefined
        ? Number(custom.customUnitPrice)
        : Number(prod.baseUnitPrice);

      const defaultCartonPrice = unitPrice * unitsPerCarton;
      const cartonPrice = custom?.customCartonPrice !== null && custom?.customCartonPrice !== undefined
        ? Number(custom.customCartonPrice)
        : defaultCartonPrice;

      const lineTotal = item.cartonCount * cartonPrice + item.unitCount * unitPrice;
      newSubtotalAmount += lineTotal;

      newOrderItemsData.push({
        orderId: order.id,
        productId: prod.id,
        cartonCount: item.cartonCount,
        unitCount: item.unitCount,
        cartonPriceSnapshot: cartonPrice,
        unitPriceSnapshot: unitPrice,
        lineTotal,
      });
    }

    // ۳. محاسبه تخفیفات جدید با موتور یکپارچه (گردِ هر پله به تومان صحیح + ترتیب ورود)
    const steps = this.normalizeDiscountSteps(dto);
    const { discountStepsData, totalDiscountAmount: newTotalDiscountAmount, finalAmount: newFinalRaw } =
      this.computeDiscounts(newSubtotalAmount, steps);
    const newDiscountStepsData = discountStepsData.map((s: any) => ({ orderId: order.id, ...s }));

    const newFinalAmount = newFinalRaw;
    const newPaidAmount = (dto.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
    const newCreditAmount = Math.max(0, newFinalAmount - newPaidAmount);

    // ۴. محاسبه اختلاف دفتر حساب مشتری
    const currentCustomerDebt = order.customer.ledgerEntries.length > 0
      ? Number(order.customer.ledgerEntries[0].balanceAfter)
      : 0;

    const debtDifference = newCreditAmount - oldCreditAmount;
    const newCustomerBalance = Math.max(0, currentCustomerDebt + debtDifference);

    // ۵. اجرای تراکنش جامع
    await this.prisma.$transaction(async (tx) => {
      // نقشهٔ ظرفیت کارتن برای کالاهای قدیم و جدید (کالای حذف‌شده هم باید درست شکسته شود)
      const allIds = Array.from(new Set([
        ...dto.items.map((i) => i.productId),
        ...order.items.map((i) => i.productId),
      ]));
      const upcProducts = await tx.product.findMany({
        where: { id: { in: allIds } },
        include: { userSettings: { where: { userId: visitorId } } },
      });
      const upcOf = new Map(
        upcProducts.map((p) => [
          p.id,
          p.userSettings[0]?.customUnitsPerCarton || p.unitsPerCartonDefault || 24,
        ]),
      );

      // الف: بازگردانی موجودی اقلام قبلی به انبار خودرو (افزایش بر مبنای مجموع دانه + شکستن مجدد)
      for (const oldItem of order.items) {
        const upc = upcOf.get(oldItem.productId) || 24;
        const inv = await tx.vanInventory.findUnique({
          where: {
            userId_productId: {
              userId: visitorId,
              productId: oldItem.productId,
            },
          },
        });

        const before = normalizeStock(inv?.quantityCartons || 0, inv?.quantityUnits || 0, upc);
        const restored = splitByCarton(
          before.totalSingleUnits + toTotalSingleUnits(oldItem.cartonCount, oldItem.unitCount, upc),
          upc,
        );

        if (inv) {
          await tx.vanInventory.update({
            where: { id: inv.id },
            data: {
              quantityCartons: restored.cartons,
              quantityUnits: restored.units,
            },
          });
        } else {
          await tx.vanInventory.create({
            data: {
              userId: visitorId,
              productId: oldItem.productId,
              quantityCartons: restored.cartons,
              quantityUnits: restored.units,
            },
          });
        }
      }

      // ب: کسر مقادیر جدید از انبار خودرو (کسر بر مبنای مجموع دانه + شکستن مجدد)
      for (const newItem of dto.items) {
        const upc = upcOf.get(newItem.productId) || 24;
        const inv = await tx.vanInventory.findUnique({
          where: {
            userId_productId: {
              userId: visitorId,
              productId: newItem.productId,
            },
          },
        });

        if (inv) {
          const before = normalizeStock(inv.quantityCartons, inv.quantityUnits, upc);
          const sellTotal = toTotalSingleUnits(newItem.cartonCount, newItem.unitCount, upc);
          const after = splitByCarton(Math.max(0, before.totalSingleUnits - sellTotal), upc);
          const finalCartons = after.cartons;
          const finalUnits = after.units;

          if (finalCartons === 0 && finalUnits === 0) {
            await tx.vanInventory.delete({ where: { id: inv.id } });
          } else {
            await tx.vanInventory.update({
              where: { id: inv.id },
              data: {
                quantityCartons: finalCartons,
                quantityUnits: finalUnits,
              },
            });
          }
        }
      }

      // ج: به‌روزرسانی اقلام فاکتور
      await tx.orderItem.deleteMany({ where: { orderId: order.id } });
      await tx.orderItem.createMany({ data: newOrderItemsData });

      // د: به‌روزرسانی پله‌های تخفیف
      await tx.orderDiscountStep.deleteMany({ where: { orderId: order.id } });
      if (newDiscountStepsData.length > 0) {
        await tx.orderDiscountStep.createMany({ data: newDiscountStepsData });
      }

      // ه: به‌روزرسانی پرداخت‌ها و چک‌ها
      await tx.payment.deleteMany({ where: { orderId: order.id } });
      for (const p of dto.payments || []) {
        if (p.method === 'CHECK' && p.checkDetails) {
          await tx.payment.create({
            data: {
              orderId: order.id,
              method: 'CHECK',
              amount: p.amount,
              check: {
                create: {
                  checkNumber: p.checkDetails.checkNumber || '---',
                  bankName: p.checkDetails.bankName || 'بانک',
                  dueDate: new Date(p.checkDetails.dueDate || new Date()),
                  status: 'PENDING',
                },
              },
            },
          });
        } else {
          await tx.payment.create({
            data: {
              orderId: order.id,
              method: p.method as any,
              amount: p.amount,
            },
          });
        }
      }

      // و: به‌روزرسانی دفتر حساب در صورت تغییر نسیه
      if (debtDifference !== 0) {
        await tx.customerLedger.create({
          data: {
            customerId: order.customerId,
            relatedOrderId: order.id,
            type: debtDifference < 0 ? 'PAYMENT_CREDIT' : 'ORDER_DEBIT',
            amount: Math.abs(debtDifference),
            balanceAfter: newCustomerBalance,
          },
        });
      }

      // ز: به‌روزرسانی مقادیر هدر فاکتور
      await tx.order.update({
        where: { id: order.id },
        data: {
          subtotalAmount: newSubtotalAmount,
          totalDiscountAmount: newTotalDiscountAmount,
          finalAmount: newFinalAmount,
          status: 'CONFIRMED',
        },
      });
    });

    const updatedInvoice = await this.getOrderInvoice(visitorId, order.id);
    this.baleService.sendInvoiceNotification(order.id, { isUpdate: true }).catch(() => {});
    return updatedInvoice;
  }

  /**
   * ویرایش و اصلاح روش‌های تسویه فاکتور و اعمال آن در دفتر حساب مشتری
   */
  async updateOrderPayments(
    visitorId: string,
    orderId: string,
    dto: { payments: { method: string; amount: number; checkDetails?: any }[] },
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: {
          include: {
            ledgerEntries: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
        payments: true,
      },
    });

    if (!order) {
      throw new NotFoundException('فاکتور یافت نشد');
    }
    if (order.visitorId !== visitorId) {
      throw new ForbiddenException('دسترسی غیرمجاز');
    }

    const finalAmount = Number(order.finalAmount);
    const oldPaidAmount = order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const oldCreditAmount = Math.max(0, finalAmount - oldPaidAmount);

    const newPaidAmount = (dto.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
    const newCreditAmount = Math.max(0, finalAmount - newPaidAmount);

    const currentCustomerDebt = order.customer.ledgerEntries.length > 0
      ? Number(order.customer.ledgerEntries[0].balanceAfter)
      : 0;

    // مابه‌التفاوت نسیه در دفتر حساب
    const debtDifference = newCreditAmount - oldCreditAmount;
    const newCustomerBalance = Math.max(0, currentCustomerDebt + debtDifference);

    await this.prisma.$transaction(async (tx) => {
      // ۱. حذف پرداخت‌های قبلی
      await tx.payment.deleteMany({
        where: { orderId },
      });

      // ۲. ثبت پرداخت‌های جدید اصلاح‌شده
      for (const p of dto.payments || []) {
        if (p.method === 'CHECK' && p.checkDetails) {
          await tx.payment.create({
            data: {
              orderId,
              method: 'CHECK',
              amount: p.amount,
              check: {
                create: {
                  checkNumber: p.checkDetails.checkNumber || '---',
                  bankName: p.checkDetails.bankName || 'بانک',
                  dueDate: new Date(p.checkDetails.dueDate || new Date()),
                  status: 'PENDING',
                },
              },
            },
          });
        } else {
          await tx.payment.create({
            data: {
              orderId,
              method: p.method as any,
              amount: p.amount,
            },
          });
        }
      }

      // ۳. ثبت مابه‌التفاوت در دفتر حساب مشتری
      if (debtDifference !== 0) {
        await tx.customerLedger.create({
          data: {
            customerId: order.customerId,
            relatedOrderId: order.id,
            type: debtDifference < 0 ? 'PAYMENT_CREDIT' : 'ORDER_DEBIT',
            amount: Math.abs(debtDifference),
            balanceAfter: newCustomerBalance,
          },
        });
      }
    });

    const updatedInvoice = await this.getOrderInvoice(visitorId, orderId);
    this.baleService.sendInvoiceNotification(orderId, { isUpdate: true }).catch(() => {});
    return updatedInvoice;
  }
}
