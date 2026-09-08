import { Injectable, NotFoundException, ForbiddenException, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateCustomerDto, UpdateCustomerDto } from './customers.dto';

@Injectable()
export class CustomersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getCustomersForVisitor(visitorId: string) {
    const customers = await this.prisma.customer.findMany({
      where: { assignedVisitorId: visitorId },
      include: {
        ledgerEntries: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { orderDate: true, finalAmount: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return customers.map((c) => {
      const currentDebt = c.ledgerEntries.length > 0 ? Number(c.ledgerEntries[0].balanceAfter) : 0;
      const lastOrder = c.orders[0];

      return {
        id: c.id,
        name: c.name,
        address: c.address,
        phone: c.phone,
        notes: c.notes,
        currentDebt,
        hasDebt: currentDebt > 0,
        lastOrderDate: lastOrder?.orderDate || null,
        lastOrderAmount: lastOrder ? Number(lastOrder.finalAmount) : null,
      };
    });
  }

  async createCustomer(visitorId: string, dto: CreateCustomerDto) {
    const customer = await this.prisma.customer.create({
      data: {
        name: dto.name,
        address: dto.address,
        phone: dto.phone,
        notes: dto.notes,
        assignedVisitorId: visitorId,
      },
    });

    if (dto.initialDebt && Number(dto.initialDebt) > 0) {
      const debtAmount = Number(dto.initialDebt);
      await this.prisma.customerLedger.create({
        data: {
          customerId: customer.id,
          type: 'ADJUSTMENT',
          amount: debtAmount,
          balanceAfter: debtAmount,
        },
      });
    }

    return customer;
  }

  async getCustomerDetails(visitorId: string, customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            items: { include: { product: true } },
          },
        },
        ledgerEntries: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('مشتری یافت نشد');
    }

    if (customer.assignedVisitorId !== visitorId) {
      throw new ForbiddenException('دسترسی به این مشتری ندارید');
    }

    const currentDebt = customer.ledgerEntries.length > 0 ? Number(customer.ledgerEntries[0].balanceAfter) : 0;

    return {
      id: customer.id,
      name: customer.name,
      address: customer.address,
      phone: customer.phone,
      notes: customer.notes,
      currentDebt,
      orders: customer.orders.map((o) => {
        const summary = o.items.map((it) => {
          const parts = [];
          if (it.cartonCount > 0) parts.push(`${it.cartonCount} کارتن`);
          if (it.unitCount > 0) parts.push(`${it.unitCount} دانه`);
          return `${parts.join(' + ')} ${it.product.name}`;
        }).slice(0, 2).join('، ');

        return {
          id: o.id,
          invoiceNumber: o.invoiceNumber || null,
          orderDate: o.orderDate,
          finalAmount: Number(o.finalAmount),
          status: o.status,
          summary: summary || 'اقلام بستنی',
        };
      }),
      ledger: customer.ledgerEntries.map((l) => ({
        id: l.id,
        type: l.type,
        amount: Number(l.amount),
        balanceAfter: Number(l.balanceAfter),
        createdAt: l.createdAt,
      })),
    };
  }

  async updateCustomer(visitorId: string, customerId: string, dto: UpdateCustomerDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException('مشتری یافت نشد');
    }

    if (customer.assignedVisitorId !== visitorId) {
      throw new ForbiddenException('دسترسی به این مشتری ندارید');
    }

    return this.prisma.customer.update({
      where: { id: customerId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
  }

  async deleteCustomer(visitorId: string, customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        _count: {
          select: { orders: true },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('مشتری یافت نشد');
    }

    if (customer.assignedVisitorId !== visitorId) {
      throw new ForbiddenException('دسترسی به این مشتری ندارید');
    }

    // بررسی آیا مشتری سابقه فاکتور دارد
    if (customer._count.orders > 0) {
      throw new ForbiddenException(
        `این مشتری دارای ${customer._count.orders} فاکتور ثبت‌شده است و جهت حفظ اسناد مالی امکان حذف مستقیم ندارد.`,
      );
    }

    // در صورت عدم وجود فاکتور، حذف اسناد تنظیم و حذف نهایی مشتری
    await this.prisma.customerLedger.deleteMany({
      where: { customerId },
    });

    await this.prisma.customer.delete({
      where: { id: customerId },
    });

    return { message: 'مشتری با موفقیت حذف شد' };
  }

  async settleCustomerDebt(
    visitorId: string,
    customerId: string,
    dto: { amount: number; method: string; notes?: string },
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
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
      throw new ForbiddenException('دسترسی به این مشتری ندارید');
    }

    const currentDebt = customer.ledgerEntries.length > 0
      ? Number(customer.ledgerEntries[0].balanceAfter)
      : 0;

    const paymentAmount = Number(dto.amount) || 0;
    const newBalance = Math.max(0, currentDebt - paymentAmount);

    const ledger = await this.prisma.customerLedger.create({
      data: {
        customerId,
        type: 'PAYMENT_CREDIT',
        amount: paymentAmount,
        balanceAfter: newBalance,
      },
    });

    return {
      message: 'دریافت وجه با موفقیت در دفتر حساب ثبت شد و از مانده بدهی کسر گردید',
      currentDebt: newBalance,
      cleared: newBalance === 0,
      ledger,
    };
  }
}
