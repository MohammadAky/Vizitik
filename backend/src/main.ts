import 'reflect-metadata';
import './env';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AuthService } from './auth/auth.service';
import { APP } from './app.config';

/**
 * سرو کردن PWA از همین سرویس (هم‌ریشه با API).
 *
 * اگر بیلد PWA موجود باشد (frontend-app/dist)، بک‌اند دقیقاً همان کاری را
 * انجام می‌دهد که Nginx روی سرور VPS انجام می‌دهد:
 *   /          → خودِ اپ PWA (SPA)
 *   /assets/*  → فایل‌های بیلد (کش بلندمدت)
 *   /sw.js و…  → بدون کش (service worker همیشه تازه)
 *   /api/*     → API (اولویت دارد؛ توسط Nest سرو می‌شود)
 *
 * روی VPS این یعنی بک‌اند می‌تواند در حالت dev (بدون Nginx) هم کل اپ را
 * تک‌دامنه سرو کند. در پیکربندی production بی‌ضرر است: بک‌اند همان‌جا
 * 127.0.0.1 گوش می‌دهد و Nginx جلوتر از آن PWA را خودش سرو می‌کند.
 * در dev بدون بیلد PWA، پوشه نیست و هیچ‌کاری انجام نمی‌شود.
 * برای اشاره به بیلد در جای دیگر: PWA_DIST_DIR=/path/to/dist
 */
const PWA_DIST = process.env.PWA_DIST_DIR
  ? path.resolve(process.env.PWA_DIST_DIR)
  : path.resolve(__dirname, '..', '..', 'frontend-app', 'dist');

function registerPwaStatic(app: INestApplication): boolean {
  if (!fs.existsSync(path.join(PWA_DIST, 'index.html'))) return false;

  app.use(
    express.static(PWA_DIST, {
      index: 'index.html',
      setHeaders: (res: Response, filePath: string) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          // فایل‌های هَش‌دار بیلد: یک‌بار دانلود، یک‌سال کش
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (/(^|[\\/])(sw\.js|registerSW\.js|manifest\.webmanifest)$/.test(filePath)) {
          // service worker و manifest نباید کش بخورند، وگرنه آپدیت‌ها جا می‌مانند
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );

  // SPA fallback: هر GETِ غیر-API که فایلش موجود نیست → index.html
  const fallback = (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') {
      next();
      return;
    }
    if (req.path === '/api' || req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile('index.html', { root: PWA_DIST });
  };
  app.use(fallback);
  return true;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.enableCors();
  const servesPwa = registerPwaStatic(app);

  const port = process.env.PORT || 3000;
  // behind Nginx set BIND_HOST=127.0.0.1 so the API is not reachable from outside
  const host = process.env.BIND_HOST || '0.0.0.0';
  await app.listen(port, host);
  console.log(
    `[${APP.nameEn}] API listening on http://${host}:${port}` +
      (servesPwa ? ` (also serving the PWA from ${PWA_DIST})` : ''),
  );

  // broadcast the "server is online" message through the Bale bot
  try {
    const authService = app.get(AuthService);
    await authService.broadcastServerOnline();
  } catch (err) {
    // a missing or unreachable bot must never stop the server
  }
}
bootstrap();
