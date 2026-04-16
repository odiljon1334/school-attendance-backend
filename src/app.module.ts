import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { DistrictsModule } from './districts/districts.module';
import { SchoolsModule } from './schools/schools.module';
import { StudentsModule } from './students/students.module';
import { TeachersModule } from './teachers/teachers.module';
import { AttendanceModule } from './attendance/attendance.module';
import { PaymentsModule } from './payments/payments.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ParentsModule } from './parents/parents.module';
import { HikvisionModule } from './hikvision/hikvision.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ClassesModule } from './classes/classes.module';
import { UsersModule } from './users/users.module';
import { EnrollPicModule } from './enroll-pic/enroll-pic.module';
import { TurnstileModule } from './turnstile/turnstile.module';
import { PayrollModule } from './payroll/payroll.module';
import { RedisModule } from './redis/redis.module';
import { CsvImportModule } from './csv-import/csv-import.module';
import { BillingModule } from './billing/billing.module';
import { ScheduleModule } from '@nestjs/schedule';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { SystemSettingsModule } from './system-settings/system-settings.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { MessagingSubscriptionsModule } from './messaging-subscriptions/messaging-subscriptions.module';
import { CamerasModule } from './cameras/cameras.module';
import { MapModule } from './map/map.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // ✅ Rate limiting: login uchun 10 urinish/60 soniya
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 60000, limit: 10 },   // 10 req/60s
      { name: 'long',  ttl: 3600000, limit: 100 }, // 100 req/soat
    ]),
    PrismaModule,
    AuthModule,
    DistrictsModule,
    ScheduleModule.forRoot(),
    BillingModule,
    SchoolsModule,
    ClassesModule,
    StudentsModule,
    TeachersModule,
    AttendanceModule,
    PaymentsModule,
    NotificationsModule,
    ParentsModule,
    DashboardModule,
    HikvisionModule,
    UsersModule,
    EnrollPicModule,
    WhatsappModule,
    TurnstileModule,
    ClassesModule,
    PayrollModule,
    RedisModule,
    CsvImportModule,
    SystemSettingsModule,
    AuditLogModule,
    MessagingSubscriptionsModule,
    CamerasModule,
    MapModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
