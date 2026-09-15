import { Controller, Get } from '@nestjs/common';
import { APP } from '../app.config';
import { PrismaService } from '../prisma.service';

/**
 * Lightweight liveness probe.
 *
 * - Render health check (render.yaml: healthCheckPath: /api/health)
 * - keep-alive pings on the free plan (scripts/keep-alive.sh)
 *
 * Unauthenticated, but it deliberately touches the database (SELECT 1):
 *   - Render's health check then reflects the real DB state
 *   - the free-plan pinger also keeps a free Supabase project's
 *     connection alive so the project doesn't pause (7-day inactivity)
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
