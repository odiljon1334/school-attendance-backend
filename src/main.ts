import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { webcrypto } from 'node:crypto';
import * as express from 'express';
import { JwtAuthGuard } from './auth/guards/jwt.auth.guards';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // CORS_ORIGINS env dan o'qiymiz (vergul bilan ajratilgan)
  // Masalan: http://localhost:3000,http://46.202.191.210,https://yourdomain.com
  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://192.168.1.3:3000'];

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  });

  if (!(globalThis as any).crypto) {
    (globalThis as any).crypto = webcrypto as any;
  }

  // ✅ 1. Avval raw body (webhook uchun)
  app.use(
    '/hikvision/webhook/face-recognition',
    express.raw({ type: '*/*', limit: '25mb' }),
  );

  app.useGlobalGuards(new JwtAuthGuard());

  // ✅ 2. Keyin JSON parser (limit oshirildi: 50mb — mobil rasm uchun)
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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