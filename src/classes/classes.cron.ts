import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ClassesService } from './classes.service';

const TZ = 'Asia/Bishkek';

@Injectable()
export class ClassesCron {
  private readonly logger = new Logger(ClassesCron.name);

  constructor(
    private prisma: PrismaService,
    private classesService: ClassesService,
  ) {}

  // Har yil 1-sentabr soat 00:01 da barcha maktablar uchun yangi o'quv yiliga o'tkazadi
  // 11-yillik: 11-sinf → Bitiruvchilar, 12-yillik (section "(12)"): 12-sinf → Bitiruvchilar
  @Cron('1 0 1 9 *', { timeZone: TZ })
  async promoteAllSchools() {
    this.logger.log('Yangi o\'quv yili: sinflarni ko\'tarish boshlandi...');

    const schools = await this.prisma.school.findMany({ select: { id: true, name: true } });

    let totalPromoted = 0;
    let totalGraduated = 0;
    const errors: string[] = [];

    for (const school of schools) {
      try {
        const result = await this.classesService.promoteYear(school.id);
        totalPromoted += result.promoted;
        totalGraduated += result.graduated;
        this.logger.log(
          `${school.name}: ${result.promoted} ko'tarildi, ${result.graduated} bitirdi (${result.fromYear} → ${result.toYear})`,
        );
      } catch (err: any) {
        // Agar maktabda sinflar bo'lmasa yoki allaqachon ko'tarilgan bo'lsa — o'tkazib ketamiz
        this.logger.warn(`${school.name} (${school.id}): ${err?.message}`);
        errors.push(`${school.name}: ${err?.message}`);
      }
    }

    this.logger.log(
      `Yangi o'quv yili yakunlandi. Jami: ${totalPromoted} ko'tarildi, ${totalGraduated} bitirdi. Xatolar: ${errors.length}`,
    );
  }
}
