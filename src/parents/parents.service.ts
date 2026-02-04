import {
    Injectable,
    NotFoundException,
    ConflictException,
  } from '@nestjs/common';
  import { PrismaService } from '../prisma/prisma.service';
  import { CreateParentDto, UpdateParentDto } from './dto/parent.dto';
  import * as bcrypt from 'bcrypt';
  import { UserRole } from '@prisma/client';
  
  @Injectable()
  export class ParentsService {
    constructor(private prisma: PrismaService) {}
  
    async create(createParentDto: CreateParentDto) {
      const { username, password, email, studentId, ...parentData } =
        createParentDto;
  
      // Check if username already exists
      const existingUser = await this.prisma.user.findUnique({
        where: { username },
      });
  
      if (existingUser) {
        throw new ConflictException('Username already exists');
      }
  
      // Check if student exists
      const student = await this.prisma.student.findUnique({
        where: { id: studentId },
      });
  
      if (!student) {
        throw new NotFoundException('Student not found');
      }
  
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);
  
      // Create user
      const user = await this.prisma.user.create({
        data: {
          username,
          email,
          password: hashedPassword,
          role: UserRole.PARENT,
          status: 'ACTIVE',
        },
      });
  
      // Create parent profile
      return this.prisma.parent.create({
        data: {
          userId: user.id,
          studentId,
          ...parentData,
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              email: true,
              role: true,
              status: true,
            },
          },
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              school: {
                select: {
                  id: true,
                  name: true,
                },
              },
              class: {
                select: {
                  grade: true,
                  section: true,
                },
              },
            },
          },
        },
      });
    }
  
    async findAll(studentId?: string, schoolId?: string) {
      const where: any = {};
  
      if (studentId) {
        where.studentId = studentId;
      }
  
      if (schoolId) {
        where.student = { schoolId };
      }
  
      return this.prisma.parent.findMany({
        where,
        include: {
          user: {
            select: {
              username: true,
              email: true,
              status: true,
            },
          },
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              school: {
                select: {
                  name: true,
                },
              },
              class: {
                select: {
                  grade: true,
                  section: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    }
  
    async findOne(id: string) {
      const parent = await this.prisma.parent.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              email: true,
              role: true,
              status: true,
            },
          },
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              school: {
                select: {
                  id: true,
                  name: true,
                  address: true,
                },
              },
              class: {
                select: {
                  id: true,
                  grade: true,
                  section: true,
                  academicYear: true,
                },
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
  
    async update(id: string, updateParentDto: UpdateParentDto) {
      await this.findOne(id);
  
      return this.prisma.parent.update({
        where: { id },
        data: updateParentDto,
        include: {
          user: {
            select: {
              username: true,
              email: true,
              status: true,
            },
          },
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });
    }
  
    async remove(id: string) {
      const parent = await this.findOne(id);
  
      await this.prisma.$transaction(async (prisma) => {
        // Delete parent
        await prisma.parent.delete({ where: { id } });
  
        // Delete user
        await prisma.user.delete({ where: { id: parent.userId } });
      });
  
      return { message: 'Parent deleted successfully' };
    }
  
    async getChildren(id: string) {
      const parent = await this.findOne(id);
  
      return {
        parent: {
          id: parent.id,
          fullName: `${parent.firstName} ${parent.lastName}`,
          phone: parent.phone,
          relationship: parent.relationship,
        },
        student: parent.student,
      };
    }
  
    async getTelegramSubscribed(schoolId?: string) {
      const where: any = {
        isTelegramSubscribed: true,
      };
  
      if (schoolId) {
        where.student = { schoolId };
      }
  
      return this.prisma.parent.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          telegramChatId: true,
          student: {
            select: {
              firstName: true,
              lastName: true,
              class: {
                select: {
                  grade: true,
                  section: true,
                },
              },
            },
          },
        },
      });
    }
  }