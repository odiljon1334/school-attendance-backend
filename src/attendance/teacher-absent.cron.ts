import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../notifications/telegram.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

const TZ = 'Asia/Bishkek';

/**
 * Har kuni 18:00 Bishkek (UTC+6 = 12:00 UTC) Du-Ju:
 * 1. Bugun kelmagan teacherlarni ABSENT record qiladi
 * 2. Directorga xulosa xabari yuboradi
 */
@Injectable()
export class TeacherAbsentCron {
  private readonly logger = new Logger(TeacherAbsentCron.name);

  constructor(
    private prisma: PrismaService,
    private wa: WhatsappService,
    private telegram: TelegramService,
  ) {}

  @Cron('0 12 * * 1-5') // 18:00 Bishkek (UTC+6)
  async checkAbsentTeachers() {
    this.logger.log('🔍 Teacher absent cron started');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayStr = today.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: TZ,
    });

    // Barcha maktablarni olish
    const schools = await this.prisma.school.findMany({
      select: { id: true, name: true },
    });

    let totalAbsent = 0;

    for (const school of schools) {
      try {
        await this.processSchool(school, today, tomorrow, todayStr);
        totalAbsent++;
      } catch (err: any) {
        this.logger.error(`Teacher absent cron error [school=${school.id}]: ${err?.message}`);
      }
    }

    this.logger.log(`✅ Teacher absent cron done`);
  }

  private async processSchool(
    school: { id: string; name: string },
    today: Date,
    tomorrow: Date,
    todayStr: string,
  ) {
    // Maktabdagi barcha o'qituvchilar (director emas)
    const teachers = await this.prisma.teacher.findMany({
      where: {
        schoolId: school.id,
        type: 'TEACHER',
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
    });

    if (!teachers.length) return;

    // Bugun kelgan o'qituvchilar
    const presentRecords = await this.prisma.attendance.findMany({
      where: {
        schoolId: school.id,
        teacherId: { in: teachers.map((t) => t.id) },
        date: { gte: today, lt: tomorrow },
        status: { in: ['PRESENT', 'LATE'] },
      },
      select: { teacherId: true },
    });

    const presentIds = new Set(presentRecords.map((r) => r.teacherId).filter(Boolean));

    // Kelmagan o'qituvchilar
    const absentTeachers = teachers.filter((t) => !presentIds.has(t.id));

    if (!absentTeachers.length) {
      this.logger.log(`✅ All teachers present [school=${school.id}]`);
      return;
    }

    // ABSENT record yaratish (mavjud bo'lsa skip)
    for (const teacher of absentTeachers) {
      await this.prisma.attendance.upsert({
        where: { teacherId_date: { teacherId: teacher.id, date: today } },
        update: {}, // mavjud recordni o'zgartirmaymiz
        create: {
          schoolId: school.id,
          teacherId: teacher.id,
          date: today,
          status: 'ABSENT',
        },
      }).catch((err) => {
        this.logger.error(`Upsert absent teacher [${teacher.id}]: ${err?.message}`);
      });
    }

    this.logger.log(
      `📋 Absent teachers [school=${school.id}]: ${absentTeachers.length}/${teachers.length}`,
    );

    // Director topish
    const director = await this.prisma.teacher.findFirst({
      where: {
        schoolId: school.id,
        type: 'DIRECTOR',
      },
      select: {
        id: true,
        whatsappPhone: true,
        isWhatsappActive: true,
        telegramChatId: true,
        isTelegramActive: true,
      },
    });

    if (!director) return;

    // Xabar matni
    const absentList = absentTeachers
      .map((t) => `• ${t.firstName ?? ''} ${t.lastName ?? ''}`.trim())
      .join('\n');

    const presentCount = presentIds.size;
    const totalCount = teachers.length;

    const message =
      `📋 *Давомат учителей* — ${todayStr}\n\n` +
      `✅ Пришли: *${presentCount}* из *${totalCount}*\n` +
      `❌ Не явились: *${absentTeachers.length}*\n\n` +
      `*Отсутствующие:*\n${absentList}\n\n` +
      `_${school.name}_`;

    // WhatsApp
    if (director.isWhatsappActive && director.whatsappPhone) {
      await this.wa.sendText(director.whatsappPhone, message).catch((err) => {
        this.logger.error(`WA absent notif → director: ${err?.message}`);
      });
      this.logger.log(`📱 Teacher absent WA → director [school=${school.id}]`);
    }

    // Telegram
    if (director.isTelegramActive && director.telegramChatId) {
      await this.telegram
        .sendMessage(director.telegramChatId, message.replace(/\*/g, ''))
        .catch((err) => {
          this.logger.error(`TG absent notif → director: ${err?.message}`);
        });
      this.logger.log(`📱 Teacher absent TG → director [school=${school.id}]`);
    }
  }
}
