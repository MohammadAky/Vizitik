import { Controller, Get, Put, Body, Param, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ReportsService } from './reports.service';
import { GetUser } from '../auth/get-user.decorator';

@Controller('api/reports')
@UseGuards(AuthGuard('jwt'))
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  getDashboardStats(@GetUser('id') visitorId: string) {
    return this.reportsService.getDashboardStats(visitorId);
  }

  @Get('checks')
  getChecks(@GetUser('id') visitorId: string) {
    return this.reportsService.getChecksReport(visitorId);
  }

  @Put('checks/:id/status')
  updateCheckStatus(
    @GetUser('id') visitorId: string,
    @Param('id') checkId: string,
    @Body('status') status: 'PASSED' | 'BOUNCED' | 'PENDING',
  ) {
    return this.reportsService.updateCheckStatus(visitorId, checkId, status);
  }

  @Get('outstanding')
  getOutstandingBalances(@GetUser('id') visitorId: string) {
    return this.reportsService.getOutstandingBalances(visitorId);
  }
}
