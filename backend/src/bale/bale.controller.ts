import { Controller, Post, Get, Body, UseGuards, Inject } from '@nestjs/common';
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
   * وضعیت اتصال ربات بله
   */
  @Get('status')
  getStatus() {
    return {
      status: 'ONLINE',
      botUsername: 'HesabchinBot',
      botLink: 'https://ble.ir/HesabchinBot',
    };
  }
}
