import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ParentsService {
  constructor(private prisma: PrismaService) {}

  async create(createParentDto: any) {
    // Check if phone already exists
    const existing = await this.prisma.parent.findUnique({
      where: { phone: createParentDto.phone },
    });

    if (existing) {
      throw new ConflictException(`Parent with phone ${createParentDto.phone} already exists`);
    }

    return this.prisma.parent.create({
      data: {
        studentId: createParentDto.studentId,
        firstName: createParentDto.firstName,
        lastName: createParentDto.lastName,
        phone: createParentDto.phone,
        relationship: createParentDto.relationship,
        telegramId: createParentDto.telegramId,
        telegramChatId: createParentDto.telegramChatId,
        isTelegramActive: false,
      },
      include: {
        student: true,
      },
    });
  }

  async findAll(studentId?: string, schoolId?: string) {
    const where: any = {};

    if (studentId) {
      where.studentId = studentId;
    }

    if (schoolId) {
      where.student = {
        schoolId: schoolId,
      };
    }

    return this.prisma.parent.findMany({
      where,
      include: {
        student: {
          include: {
            class: true,
            school: true,
          },
        },
      },
      orderBy: { lastName: 'asc' },
    });
  }

  async findOne(id: string) {
    const parent = await this.prisma.parent.findUnique({
      where: { id },
      include: {
        student: {
          include: {
            class: true,
            school: true,
            attendances: {
              orderBy: { date: 'desc' },
              take: 30,
            },
          },
        },
      },
    });

    if (!parent) {
      throw new NotFoundException(`Parent with ID ${id} not found`);
    }

    return parent;
  }

  // FIXED: was getTelegramSubscribed → getTelegramActive
  async getTelegramActive(schoolId?: string) {
    const where: any = {
      isTelegramActive: true, // FIXED: was isTelegramSubscribed
      telegramChatId: { not: null },
    };

    if (schoolId) {
      where.student = { schoolId };
    }

    return this.prisma.parent.findMany({
      where,
      include: {
        student: {
          include: {
            class: true,
          },
        },
      },
    });
  }

  async update(id: string, updateParentDto: any) {
    const existing = await this.prisma.parent.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException(`Parent with ID ${id} not found`);
    }

    // Check phone conflict
    if (updateParentDto.phone && updateParentDto.phone !== existing.phone) {
      const phoneExists = await this.prisma.parent.findUnique({
        where: { phone: updateParentDto.phone },
      });
      if (phoneExists) {
        throw new ConflictException(`Phone ${updateParentDto.phone} already exists`);
      }
    }

    return this.prisma.parent.update({
      where: { id },
      data: {
        firstName: updateParentDto.firstName,
        lastName: updateParentDto.lastName,
        phone: updateParentDto.phone,
        relationship: updateParentDto.relationship,
        telegramId: updateParentDto.telegramId,
        telegramChatId: updateParentDto.telegramChatId,
        isTelegramActive: updateParentDto.isTelegramActive, // FIXED
      },
      include: { student: true },
    });
  }

  async remove(id: string) {
    const parent = await this.prisma.parent.findUnique({ where: { id } });

    if (!parent) {
      throw new NotFoundException(`Parent with ID ${id} not found`);
    }

    // Delete user if linked
    await this.prisma.parent.delete({ where: { id } });

    if (parent.userId) {
      await this.prisma.user.delete({ where: { id: parent.userId } });
    }

    return { message: 'Parent deleted successfully' };
  }
}