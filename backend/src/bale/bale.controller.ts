import { Controller, Post, Get, Put, Body, Param, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BaleService } from './bale.service';
import { GetUser } from '../auth/get-user.decorator';

@Controller('api/bale')
export class BaleController {
  constructor(@Inject(BaleService) private readonly baleService: BaleService) {}

  /**
   * وب‌هوک رسمی بله
   */
  @Post('webhook')
  handleWebhook(@Body() body: any) {
    return this.baleService.processUpdate(body);
  }

  /**
   * دریافت آمار اتصال مشتریان و تنظیمات ارسال پیام بله
   */
  @Get('stats')
  @UseGuards(AuthGuard('jwt'))
  getStats(@GetUser('id') visitorId: string) {
    return this.baleService.getBaleStatsAndSettings(visitorId);
  }

  /**
   * ذخیره تنظیمات ارسال خودکار فاکتور به بله
   */
  @Put('settings')
  @UseGuards(AuthGuard('jwt'))
  updateSettings(
    @GetUser('id') visitorId: string,
    @Body() dto: {
      baleNotifyCustomer?: boolean;
      baleNotifyVisitor?: boolean;
      baleIncludeItems?: boolean;
      baleIncludeDebt?: boolean;
    },
  ) {
    return this.baleService.updateBaleSettings(visitorId, dto);
  }

  /**
   * ارسال مجدد / دستی فاکتور به بله مشتری و ویزیتور
   */
  @Post('send-invoice/:orderId')
  @UseGuards(AuthGuard('jwt'))
  sendInvoice(@Param('orderId') orderId: string) {
    return this.baleService.sendInvoiceNotification(orderId);
  }

  /**
   * ارسال پیام اطلاع‌رسانی گروهی یا فردی به مشتریان
   */
  @Post('broadcast')
  @UseGuards(AuthGuard('jwt'))
  broadcast(
    @GetUser('id') visitorId: string,
    @Body() dto: { templateText: string; targetType: 'all' | 'debtors' | 'single'; singleCustomerId?: string },
  ) {
    return this.baleService.broadcastToCustomers(visitorId, dto.templateText, dto.targetType, dto.singleCustomerId);
  }

  /**
   * وضعیت اتصال عمومی ربات بله
   */
  @Get('status')
  getStatus() {
    return {
      status: 'ONLINE',
      botUsername: 'VizitikBot',
      botLink: 'https://ble.ir/VizitikBot',
    };
  }
}
