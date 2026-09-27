import { Controller, Get } from '@nestjs/common';
import { APP } from '../app.config';
import { PrismaService } from '../prisma.service';

/**
 * Lightweight liveness probe.
 *
 * - deployment health checks (nginx/systemd/monitoring pings)
 *
 * Unauthenticated, but it deliberately touches the database (SELECT 1)
 * so the response reflects the real DB state, not just process liveness.
 */
@Controller('api')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      status: 'ok',
      db: 'ok',
      service: APP.nameEn,
      time: new Date().toISOString(),
    };
  }
}
