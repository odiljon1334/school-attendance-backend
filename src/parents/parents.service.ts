import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ParentsService {
  constructor(private prisma: PrismaService) {}

  /**
   * createParentDto minimal:
   * {
   *   studentId: string,
   *   firstName: string,
   *   lastName: string,
   *   phone: string,
   *   relationship?: 'PARENT' | 'FATHER' | 'MOTHER' | ... (ParentRelation enum)
   *   notifySms?: boolean
   *   telegramId?: string
   *   telegramChatId?: string
   *   telegramUsername?: string
   * }
   */
  async create(createParentDto: any) {
    if (!createParentDto?.studentId) {
      throw new BadRequestException('studentId обязателен');
    }
    if (!createParentDto?.phone) {
      throw new BadRequestException('phone обязателен');
    }
    if (!createParentDto?.firstName || !createParentDto?.lastName) {
      throw new BadRequestException('firstName и lastName обязательны');
    }

    // Проверяем, существует ли ученик
    const student = await this.prisma.student.findUnique({
      where: { id: createParentDto.studentId },
      select: { id: true },
    });

    if (!student) {
      throw new NotFoundException(`Ученик с ID ${createParentDto.studentId} не найден`);
    }

    // Если родитель с таким телефоном уже существует — НЕ создаём заново,
    // а только привязываем к ученику (M:N). Это правильнее для вашей бизнес-логики.
    const existingParent = await this.prisma.parent.findUnique({
      where: { phone: createParentDto.phone },
      include: { students: true },
    });

    if (existingParent) {
      // Проверка: уже привязан к этому ученику?
      const alreadyLinked = existingParent.students.some((sp) => sp.studentId === createParentDto.studentId);
      if (alreadyLinked) {
        throw new ConflictException(`Этот родитель уже привязан к данному ученику (телефон: ${createParentDto.phone})`);
      }

      // Привязываем существующего parent к новому student
      await this.prisma.studentParent.create({
        data: {
          parentId: existingParent.id,
          studentId: createParentDto.studentId,
          relationship: createParentDto.relationship ?? 'PARENT',
          notifySms: Boolean(createParentDto.notifySms ?? false),
        },
      });

      // Можно обновить ФИО/телеграм данные (по желанию)
      const updated = await this.prisma.parent.update({
        where: { id: existingParent.id },
        data: {
          firstName: createParentDto.firstName ?? existingParent.firstName,
          lastName: createParentDto.lastName ?? existingParent.lastName,
          telegramId: createParentDto.telegramId ?? existingParent.telegramId,
          telegramChatId: createParentDto.telegramChatId ?? existingParent.telegramChatId,
          telegramUsername: createParentDto.telegramUsername ?? existingParent.telegramUsername,
          // статус телеграма при создании НЕ включаем автоматически
        },
        include: {
          students: {
            include: {
              student: { include: { class: true, school: true } },
            },
          },
        },
      });

      return updated;
    }

    // Создаём нового parent и link в StudentParent в одной транзакции
    return this.prisma.$transaction(async (tx) => {
      const parent = await tx.parent.create({
        data: {
          firstName: createParentDto.firstName,
          lastName: createParentDto.lastName,
          phone: createParentDto.phone,
          telegramId: createParentDto.telegramId ?? null,
          telegramChatId: createParentDto.telegramChatId ?? null,
          telegramUsername: createParentDto.telegramUsername ?? null,
          isTelegramActive: false,
        },
      });

      await tx.studentParent.create({
        data: {
          parentId: parent.id,
          studentId: createParentDto.studentId,
          relationship: createParentDto.relationship ?? 'PARENT',
          notifySms: Boolean(createParentDto.notifySms ?? false),
        },
      });

      return tx.parent.findUnique({
        where: { id: parent.id },
        include: {
          students: {
            include: {
              student: {
                include: {
                  class: true,
                  school: true,
                },
              },
            },
          },
        },
      });
    });
  }

  /**
   * findAll filters:
   * - studentId: вернуть родителей, которые привязаны к конкретному ученику
   * - schoolId: вернуть родителей, у которых есть хотя бы один ученик в этой школе
   */
  async findAll(studentId?: string, schoolId?: string) {
    const where: any = {};

    if (studentId) {
      where.students = { some: { studentId } };
    }

    if (schoolId) {
      where.students = {
        some: {
          student: { schoolId },
        },
      };
    }

    return this.prisma.parent.findMany({
      where,
      include: {
        students: {
          include: {
            student: {
              include: {
                class: true,
                school: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { lastName: 'asc' },
    });
  }

  async findOne(id: string) {
    const parent = await this.prisma.parent.findUnique({
      where: { id },
      include: {
        students: {
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
        },
      },
    });
  
    if (!parent) {
      throw new NotFoundException(`Родитель с ID ${id} не найден`);
    }
  
    return parent;
  }

  // Родители с активным Telegram (опционально по школе)
  async getTelegramActive(schoolId?: string) {
    const where: any = {
      isTelegramActive: true,
      telegramChatId: { not: null },
    };

    if (schoolId) {
      where.students = { some: { student: { schoolId } } };
    }

    return this.prisma.parent.findMany({
      where,
      include: {
        students: {
          include: {
            student: {
              include: { class: true, school: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { lastName: 'asc' },
    });
  }

  /**
   * updateParentDto:
   * {
   *   firstName?, lastName?, phone?,
   *   telegramId?, telegramChatId?, telegramUsername?, isTelegramActive?,
   *   // связь:
   *   studentId? (если хотите обновить relationship/notifySms именно для конкретного ученика)
   *   relationship?
   *   notifySms?
   * }
   */
  async update(id: string, updateParentDto: any) {
    const existing = await this.prisma.parent.findUnique({
      where: { id },
      include: { students: true },
    });

    if (!existing) {
      throw new NotFoundException(`Родитель с ID ${id} не найден`);
    }

    // Phone conflict check
    if (updateParentDto.phone && updateParentDto.phone !== existing.phone) {
      const phoneExists = await this.prisma.parent.findUnique({
        where: { phone: updateParentDto.phone },
        select: { id: true },
      });
      if (phoneExists) {
        throw new ConflictException(`Телефон ${updateParentDto.phone} уже существует`);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // 1) обновляем сам Parent
      await tx.parent.update({
        where: { id },
        data: {
          firstName: updateParentDto.firstName ?? undefined,
          lastName: updateParentDto.lastName ?? undefined,
          phone: updateParentDto.phone ?? undefined,
          telegramId: updateParentDto.telegramId ?? undefined,
          telegramChatId: updateParentDto.telegramChatId ?? undefined,
          telegramUsername: updateParentDto.telegramUsername ?? undefined,
          isTelegramActive: updateParentDto.isTelegramActive ?? undefined,
        },
      });

      // 2) обновляем связь StudentParent (relationship/notifySms) если пришли поля
      const wantsLinkUpdate =
        updateParentDto.relationship !== undefined || updateParentDto.notifySms !== undefined;

      if (wantsLinkUpdate) {
        // Если studentId указан — обновляем именно эту связь
        if (updateParentDto.studentId) {
          const link = await tx.studentParent.findUnique({
            where: { studentId_parentId: { studentId: updateParentDto.studentId, parentId: id } },
          });
          if (!link) {
            throw new NotFoundException('Связь родителя с указанным учеником не найдена');
          }

          await tx.studentParent.update({
            where: { studentId_parentId: { studentId: updateParentDto.studentId, parentId: id } },
            data: {
              relationship: updateParentDto.relationship ?? undefined,
              notifySms: updateParentDto.notifySms ?? undefined,
            },
          });
        } else {
          // Иначе обновляем первую связь (fallback)
          const first = existing.students[0];
          if (first) {
            await tx.studentParent.update({
              where: { studentId_parentId: { studentId: first.studentId, parentId: id } },
              data: {
                relationship: updateParentDto.relationship ?? undefined,
                notifySms: updateParentDto.notifySms ?? undefined,
              },
            });
          }
        }
      }

      // 3) вернуть полную модель
      return tx.parent.findUnique({
        where: { id },
        include: {
          students: {
            include: {
              student: {
                include: {
                  class: true,
                  school: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
    });
  }

  async remove(id: string) {
    const parent = await this.prisma.parent.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });

    if (!parent) {
      throw new NotFoundException(`Родитель с ID ${id} не найден`);
    }

    await this.prisma.$transaction(async (tx) => {
      // сначала удалить связи M:N
      await tx.studentParent.deleteMany({ where: { parentId: id } });

      // потом самого parent
      await tx.parent.delete({ where: { id } });

      // удалить user если был привязан
      if (parent.userId) {
        await tx.user.delete({ where: { id: parent.userId } });
      }
    });

    return { message: 'Родитель успешно удалён' };
  }
}