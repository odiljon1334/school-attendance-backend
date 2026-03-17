import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditLogParams {
  action: string;
  entity: string;
  entityId?: string;
  details?: object;
  ip?: string;
  userId?: string;
  schoolId?: string;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Silent fire-and-forget. Log failures never break the app.
   */
  async log(params: AuditLogParams): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: params });
    } catch (err: any) {
      this.logger.error(`AuditLog write failed: ${err?.message}`);
    }
  }

  async findAll(query: {
    schoolId?: string;
    action?: string;
    ip?: string;
    entity?: string;
    page?: number;
    limit?: number;
  }) {
    const { schoolId, action, ip, entity, page = 1, limit = 50 } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (schoolId) where.schoolId = schoolId;
    if (action) where.action = action;
    if (ip) where.ip = ip;
    if (entity) where.entity = entity;

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  /**
   * DDoS detection: count LOGIN_FAILED per IP in the last N minutes
   */
  async countFailedLogins(ip: string, windowMinutes = 10): Promise<number> {
    const since = new Date(Date.now() - windowMinutes * 60 * 1000);
    return this.prisma.auditLog.count({
      where: { action: 'LOGIN_FAILED', ip, createdAt: { gte: since } },
    });
  }
}
