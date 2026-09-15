import 'reflect-metadata';
import './env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { AuthService } from './auth/auth.service';
import { APP } from './app.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.enableCors();

  const port = process.env.PORT || 3000;
  // behind Nginx set BIND_HOST=127.0.0.1 so the API is not reachable from outside
  const host = process.env.BIND_HOST || '0.0.0.0';
  await app.listen(port, host);
  console.log(`[${APP.nameEn}] API listening on http://${host}:${port}`);

  // broadcast the "server is online" message through the Bale bot
  try {
    const authService = app.get(AuthService);
    await authService.broadcastServerOnline();
  } catch (err) {
    // a missing or unreachable bot must never stop the server
  }
}
bootstrap();
