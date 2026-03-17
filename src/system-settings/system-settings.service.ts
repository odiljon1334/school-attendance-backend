import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const SINGLETON_ID = 'global';

export interface SystemSettingsData {
  smsEnabled: boolean;
  telegramEnabled: boolean;
  whatsappEnabled: boolean;
}

@Injectable()
export class SystemSettingsService {
  constructor(private prisma: PrismaService) {}

  async get(): Promise<SystemSettingsData> {
    // upsert — race condition bo'lmaydi (findUnique+create pattern P2002 beradi)
    const settings = await this.prisma.systemSettings.upsert({
      where: { id: SINGLETON_ID },
      update: {},
      create: {
        id: SINGLETON_ID,
        smsEnabled: true,
        telegramEnabled: true,
        whatsappEnabled: true,
      },
    });

    return {
      smsEnabled: settings.smsEnabled,
      telegramEnabled: settings.telegramEnabled,
      whatsappEnabled: settings.whatsappEnabled,
    };
  }

  async update(data: Partial<SystemSettingsData>): Promise<SystemSettingsData> {
    const settings = await this.prisma.systemSettings.upsert({
      where: { id: SINGLETON_ID },
      update: data,
      create: {
        id: SINGLETON_ID,
        smsEnabled: data.smsEnabled ?? true,
        telegramEnabled: data.telegramEnabled ?? true,
        whatsappEnabled: data.whatsappEnabled ?? true,
      },
    });

    return {
      smsEnabled: settings.smsEnabled,
      telegramEnabled: settings.telegramEnabled,
      whatsappEnabled: settings.whatsappEnabled,
    };
  }
}
