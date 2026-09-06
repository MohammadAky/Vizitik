import { Injectable, NotFoundException, ForbiddenException, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class ReportsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getDashboardStats(visitorId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayOrders = await this.prisma.order.findMany({
      where: {
        visitorId,
        orderDate: { gte: today },
      },
      include: {
        payments: true,
      },
    });

    const todaySales = todayOrders.reduce((sum, o) => sum + Number(o.finalAmount), 0);

    const todayCollectedCash = todayOrders.reduce((sum, o) => {
      const orderCash = o.payments
        .filter((p) => p.method === 'CASH' || p.method === 'CARD')
        .reduce((pSum, p) => pSum + Number(p.amount), 0);
      return sum + orderCash;
    }, 0);

    const customers = await this.prisma.customer.findMany({
      where: { assignedVisitorId: visitorId },
      include: {
        ledgerEntries: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const totalOutstandingDebt = customers.reduce((sum, c) => {
      const debt = c.ledgerEntries.length > 0 ? Number(c.ledgerEntries[0].balanceAfter) : 0;
      return debt > 0 ? sum + debt : sum;
    }, 0);

    const pendingChecksCount = await this.prisma.check.count({
      where: {
        status: 'PENDING',
        payment: {
          order: { visitorId },
        },
      },
    });

    return {
      todaySales,
      todayCollectedCash,
      todayOrdersCount: todayOrders.length,
      totalOutstandingDebt,
      pendingChecksCount,
    };
  }

  async getChecksReport(visitorId: string) {
    const checks = await this.prisma.check.findMany({
      where: {
        payment: {
          order: { visitorId },
        },
      },
      include: {
        payment: {
          include: {
            order: {
              include: { customer: true },
            },
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    return checks.map((c) => ({
      id: c.id,
      checkNumber: c.checkNumber,
      bankName: c.bankName,
      dueDate: c.dueDate,
      status: c.status,
      amount: Number(c.payment.amount),
      customerName: c.payment.order?.customer.name || 'نامشخص',
      customerId: c.payment.order?.customerId,
    }));
  }

  async updateCheckStatus(visitorId: string, checkId: string, status: 'PASSED' | 'BOUNCED' | 'PENDING') {
    const check = await this.prisma.check.findUnique({
      where: { id: checkId },
      include: {
        payment: {
          include: {
            order: { include: { customer: true } },
          },
        },
      },
    });

    if (!check) {
      throw new NotFoundException('چک یافت نشد');
    }

    if (check.payment.order?.visitorId !== visitorId) {
      throw new ForbiddenException('دسترسی غیرمجاز');
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedCheck = await tx.check.update({
        where: { id: checkId },
        data: { status },
      });

      if (status === 'PASSED' && check.status !== 'PASSED') {
        const customerId = check.payment.order.customerId;
        const lastLedger = await tx.customerLedger.findFirst({
          where: { customerId },
          orderBy: { createdAt: 'desc' },
        });

        const currentBalance = lastLedger ? Number(lastLedger.balanceAfter) : 0;
        const newBalance = currentBalance - Number(check.payment.amount);

        await tx.customerLedger.create({
          data: {
            customerId,
            type: 'PAYMENT_CREDIT',
            relatedPaymentId: check.paymentId,
            amount: -Number(check.payment.amount),
            balanceAfter: newBalance,
          },
        });
      }

      return updatedCheck;
    });
  }

  async getOutstandingBalances(visitorId: string) {
    const customers = await this.prisma.customer.findMany({
      where: { assignedVisitorId: visitorId },
      include: {
        ledgerEntries: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    });

    return customers
      .map((c) => {
        const debt = c.ledgerEntries.length > 0 ? Number(c.ledgerEntries[0].balanceAfter) : 0;
        return {
          customerId: c.id,
          customerName: c.name,
          phone: c.phone,
          address: c.address,
          currentDebt: debt,
        };
      })
      .filter((c) => c.currentDebt > 0);
  }
}
