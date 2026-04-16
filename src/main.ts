import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { webcrypto } from 'node:crypto';
import * as express from 'express';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const compression = require('compression');
import { JwtAuthGuard } from './auth/guards/jwt.auth.guards';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // CORS_ORIGINS env dan o'qiymiz (vergul bilan ajratilgan)
  // Masalan: http://localhost:3000,http://46.202.191.210,https://yourdomain.com
  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : [
        'http://localhost:3000',
        'http://localhost:5173',
        'http://localhost:4173',
        'http://192.168.1.3:3000',
        'http://192.168.0.213:5173',
      ];

  // Gzip compression — response hajmini 2-5x kamaytiradi
  app.use(compression());

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  });

  if (!(globalThis as any).crypto) {
    (globalThis as any).crypto = webcrypto as any;
  }

  // ✅ 0. Hikvision webhook logger (faqat terminal so'rovlari)
  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) {
    app.use((req: any, _res: any, next: any) => {
      const size = req.headers['content-length'] ?? '?';
      const ct = (req.headers['content-type'] ?? '').split(';')[0];
      if (req.url.includes('hikvision') || req.url.includes('ISAPI')) {
        console.log(`📡 ${req.method} ${req.url}  size=${size}b  ct=${ct}`);
      }
      next();
    });
  }

  // ✅ 1. Avval raw body — hikvision webhook + barcha noma'lum URL lar
  app.use(
    /^\/(hikvision|ISAPI|api|uploadPic|capture|snapshot|picture)/,
    express.raw({ type: '*/*', limit: '25mb' }),
  );
  // Eski yo'l ham saqlaymiz
  app.use(
    '/hikvision/webhook/face-recognition',
    express.raw({ type: '*/*', limit: '25mb' }),
  );

  app.useGlobalGuards(new JwtAuthGuard());

  // ✅ 2. Keyin JSON parser
  // 10mb — 400×400 JPEG base64 ~70KB, hatto 4K foto base64 ~8MB yetarli
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // ✅ 3. Eng oxirida ValidationPipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
  console.log(`Server is running on port ${process.env.PORT ?? 3001}`);
}
bootstrap();