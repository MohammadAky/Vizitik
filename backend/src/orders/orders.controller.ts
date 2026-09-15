import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OrdersService } from './orders.service';
import { CreateOrderDto, UpdateOrderDto } from './orders.dto';
import { GetUser } from '../auth/get-user.decorator';

@Controller('api/orders')
@UseGuards(AuthGuard('jwt'))
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly ordersService: OrdersService) {}

  @Post()
  createOrder(
    @GetUser('id') visitorId: string,
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.createOrder(visitorId, dto);
  }

  @Get()
  getOrders(
    @GetUser('id') visitorId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.ordersService.getOrders(visitorId, startDate, endDate);
  }

  @Get(':id/invoice')
  getOrderInvoice(
    @GetUser('id') visitorId: string,
    @Param('id') orderId: string,
  ) {
    return this.ordersService.getOrderInvoice(visitorId, orderId);
  }

  @Put(':id')
  updateFullOrder(
    @GetUser('id') visitorId: string,
    @Param('id') orderId: string,
    @Body() dto: UpdateOrderDto,
  ) {
    return this.ordersService.updateFullOrder(visitorId, orderId, dto);
  }

  @Put(':id/payments')
  updateOrderPayments(
    @GetUser('id') visitorId: string,
    @Param('id') orderId: string,
    @Body() dto: { payments: { method: string; amount: number; checkDetails?: any }[] },
  ) {
    return this.ordersService.updateOrderPayments(visitorId, orderId, dto);
  }

  /**
   * ابطال کامل فاکتور (مشتری منصرف شده): اقلام به موجودی خودرو برمی‌گردند،
   * خالص فاکتور در دفتر حساب مشتری معکوس می‌شود و وضعیت CANCELLED ثبت می‌شود.
   */
  @Delete(':id')
  cancelOrder(@GetUser('id') visitorId: string, @Param('id') orderId: string) {
    return this.ordersService.cancelOrder(visitorId, orderId);
  }
}
