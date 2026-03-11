import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';
import { GenerateMode, GenerateStrategy } from './dto/generate-billing.dto';

@Injectable()
export class BillingCron {
  private readonly logger = new Logger(BillingCron.name);

  constructor(
    private prisma: PrismaService,
    private billing: BillingService,
  ) {}

  @Cron('0 1 * * *') // har kuni 01:00
  async runDaily() {
    const schools = await this.prisma.school.findMany({ select: { id: true } });
    for (const s of schools) {
      // ROLLING_DUE: har student o'z billingPlan'idan foydalanadi.
      // YEARLY uchun kamida 14 kun, MONTHLY uchun 3 kun oldin — service ichida hisoblanadi.
      // plan ko'rsatilmaydi — barcha planlar bir chaqiruvda.
      await this.billing.generate({
        schoolId: s.id,
        strategy: GenerateStrategy.ROLLING_DUE,
        mode: GenerateMode.SKIP_EXISTING,
        daysBefore: 3,          // MONTHLY uchun; YEARLY uchun service avtomatik max(3,14)=14 ishlatadi
        sendNotifications: true,
      });
    }

    this.logger.log(`Daily billing cron finished for ${schools.length} school(s)`);
  }
}