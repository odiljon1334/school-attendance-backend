import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Каждый день в 03:00 удаляет записи посещаемости старше 2 месяцев.
 * Также удаляет связанные фотографии с диска.
 */
@Injectable()
export class AttendanceCleanupCron {
  private readonly logger = new Logger(AttendanceCleanupCron.name);

  constructor(private prisma: PrismaService) {}

  @Cron('0 3 * * *', { timeZone: 'Asia/Bishkek' })
  async cleanOldAttendance() {
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

    this.logger.log(`Очистка посещаемости до: ${twoMonthsAgo.toISOString()}`);

    try {
      // Сначала получаем фотографии для удаления
      const oldRecords = await this.prisma.attendance.findMany({
        where: { createdAt: { lt: twoMonthsAgo } },
        select: { id: true, checkInPhoto: true, checkOutPhoto: true },
      });

      // Удаляем фотографии с диска
      let photoDeleted = 0;
      for (const rec of oldRecords) {
        for (const photo of [rec.checkInPhoto, rec.checkOutPhoto]) {
          if (photo) {
            try {
              const filePath = path.join(process.cwd(), 'uploads', path.basename(photo));
              if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                photoDeleted++;
              }
            } catch {}
          }
        }
      }

      // Удаляем записи из БД
      const { count } = await this.prisma.attendance.deleteMany({
        where: { createdAt: { lt: twoMonthsAgo } },
      });

      this.logger.log(
        `Удалено записей: ${count}, фотографий: ${photoDeleted}`,
      );
    } catch (err: any) {
      this.logger.error(`Ошибка очистки: ${err.message}`);
    }
  }
}
