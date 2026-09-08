import 'reflect-metadata';
import 'dotenv/config';
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
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 سرور ${APP.nameFa} با موفقیت روی پورت ${port} اجرا شد: http://0.0.0.0:${port}`);

  // ارسال خودکار پیام آنلاین شدن به ربات پیام‌رسان بله
  try {
    const authService = app.get(AuthService);
    await authService.broadcastServerOnline();
  } catch (err) {
    // در صورت عدم تنظیم یا دسترسی اولیه خطا سرور را متوقف نمی‌کند
  }
}
bootstrap();
