import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';
import { BillingPlan } from '@prisma/client';
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
      // MONTHLY rolling
      await this.billing.generate({
        schoolId: s.id,
        plan: BillingPlan.MONTHLY,
        strategy: GenerateStrategy.ROLLING_DUE,
        mode: GenerateMode.SKIP_EXISTING,
        daysBefore: 3,
        sendNotifications: true,
      });

      // YEARLY rolling (xohlasangiz daysBefore 14 qiling)
      await this.billing.generate({
        schoolId: s.id,
        plan: BillingPlan.YEARLY,
        strategy: GenerateStrategy.ROLLING_DUE,
        mode: GenerateMode.SKIP_EXISTING,
        daysBefore: 14,
        sendNotifications: true,
      });
    }

    this.logger.log(`Daily billing cron finished for ${schools.length} school(s)`);
  }
}