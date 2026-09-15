import { Controller, Get } from '@nestjs/common';
import { APP } from '../app.config';

/**
 * Lightweight, unauthenticated liveness probe.
 *
 * - Render health check (render.yaml: healthCheckPath: /api/health)
 * - keep-alive pings on the free plan (scripts/keep-alive.sh) — a public
 *   endpoint with no auth and no DB access keeps the response fast.
 */
@Controller('api')
export class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: APP.nameEn,
      time: new Date().toISOString(),
    };
  }
}
