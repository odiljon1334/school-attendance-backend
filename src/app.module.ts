import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    AuthModule,
    DistrictsModule,
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
    TurnstileModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
