import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MessagingSubscriptionsService {
  constructor(private prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────
  // OVERVIEW: maktab bo'yicha umumiy ko'rinish
  // ─────────────────────────────────────────────────────────
  async getOverview(schoolId?: string) {
    const where: any = {};
    if (schoolId) where.id = schoolId;

    const schools = await this.prisma.school.findMany({
      where,
      select: {
        id: true,
        name: true,
        code: true,
        _count: {
          select: {
            telegramSubscriptions: true,
            whatsappSubscriptions: true,
          },
        },
        telegramSubscriptions: {
          where: { isActive: true },
          select: { id: true },
        },
        whatsappSubscriptions: {
          where: { isActive: true },
          select: { id: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return schools.map((s) => ({
      schoolId: s.id,
      schoolName: s.name,
      schoolCode: s.code,
      telegram: {
        total: s._count.telegramSubscriptions,
        active: s.telegramSubscriptions.length,
      },
      whatsapp: {
        total: s._count.whatsappSubscriptions,
        active: s.whatsappSubscriptions.length,
      },
    }));
  }

  // ─────────────────────────────────────────────────────────
  // TELEGRAM SUBSCRIPTIONS
  // ─────────────────────────────────────────────────────────
  async getTelegramSubscriptions(query: {
    schoolId?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }) {
    const { schoolId, isActive, page = 1, limit = 50 } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (schoolId) where.schoolId = schoolId;
    if (isActive !== undefined) where.isActive = isActive;

    const [data, total] = await Promise.all([
      this.prisma.telegramSubscription.findMany({
        where,
        include: {
          school: { select: { id: true, name: true } },
          teacher: { select: { id: true, firstName: true, lastName: true } },
          parent: { select: { id: true, firstName: true, lastName: true, phone: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.telegramSubscription.count({ where }),
    ]);

    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  // ─────────────────────────────────────────────────────────
  // WHATSAPP SUBSCRIPTIONS
  // ─────────────────────────────────────────────────────────
  async getWhatsappSubscriptions(query: {
    schoolId?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }) {
    const { schoolId, isActive, page = 1, limit = 50 } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (schoolId) where.schoolId = schoolId;
    if (isActive !== undefined) where.isActive = isActive;

    const [data, total] = await Promise.all([
      this.prisma.whatsappSubscription.findMany({
        where,
        include: {
          school: { select: { id: true, name: true } },
          parent: { select: { id: true, firstName: true, lastName: true, phone: true } },
          teacher: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.whatsappSubscription.count({ where }),
    ]);

    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }
}
