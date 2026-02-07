import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ConflictException,
  } from '@nestjs/common';
  import { PrismaService } from '../prisma/prisma.service';
  import { CreateUserDto, UpdateUserDto, ChangePasswordDto } from './dto/user.dto';
  import { UserRole, UserStatus } from '@prisma/client';
  import * as bcrypt from 'bcrypt';
  
  @Injectable()
  export class UsersService {
    constructor(private prisma: PrismaService) {}
  
    async create(createUserDto: CreateUserDto) {
      // Check if username already exists
      const existingUser = await this.prisma.user.findUnique({
        where: { username: createUserDto.username },
      });
  
      if (existingUser) {
        throw new ConflictException('Username already exists');
      }
  
      // Check if email already exists
      if (createUserDto.email) {
        const existingEmail = await this.prisma.user.findUnique({
          where: { email: createUserDto.email },
        });
  
        if (existingEmail) {
          throw new ConflictException('Email already exists');
        }
      }
  
      // Hash password
      const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
  
      // Create user
      const user = await this.prisma.user.create({
        data: {
          ...createUserDto,
          password: hashedPassword,
          status: createUserDto.status || UserStatus.ACTIVE,
        },
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });
  
      return user;
    }
  
    async findAll(role?: UserRole, status?: UserStatus) {
      const where: any = {};
  
      if (role) {
        where.role = role;
      }
  
      if (status) {
        where.status = status;
      }
  
      return this.prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    }
  
    async findOne(id: string) {
      const user = await this.prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });
  
      if (!user) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }
  
      return user;
    }
  
    async findByUsername(username: string) {
      return this.prisma.user.findUnique({
        where: { username },
      });
    }
  
    async update(id: string, updateUserDto: UpdateUserDto) {
      // Check if user exists
      await this.findOne(id);
  
      // If email is being updated, check if it's already taken
      if (updateUserDto.email) {
        const existingEmail = await this.prisma.user.findUnique({
          where: { email: updateUserDto.email },
        });
  
        if (existingEmail && existingEmail.id !== id) {
          throw new ConflictException('Email already exists');
        }
      }
  
      // If password is being updated, hash it
      if (updateUserDto.password) {
        updateUserDto.password = await bcrypt.hash(updateUserDto.password, 10);
      }
  
      return this.prisma.user.update({
        where: { id },
        data: updateUserDto,
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }
  
    async changePassword(id: string, changePasswordDto: ChangePasswordDto) {
      // Get user with password
      const user = await this.prisma.user.findUnique({
        where: { id },
      });
  
      if (!user) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }
  
      // Verify current password
      const isPasswordValid = await bcrypt.compare(
        changePasswordDto.currentPassword,
        user.password,
      );
  
      if (!isPasswordValid) {
        throw new BadRequestException('Current password is incorrect');
      }
  
      // Hash new password
      const hashedPassword = await bcrypt.hash(changePasswordDto.newPassword, 10);
  
      // Update password
      await this.prisma.user.update({
        where: { id },
        data: { password: hashedPassword },
      });
  
      return { message: 'Password changed successfully' };
    }
  
    async deactivate(id: string) {
      await this.findOne(id);
  
      return this.prisma.user.update({
        where: { id },
        data: { status: UserStatus.INACTIVE },
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          status: true,
        },
      });
    }
  
    async activate(id: string) {
      await this.findOne(id);
  
      return this.prisma.user.update({
        where: { id },
        data: { status: UserStatus.ACTIVE },
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          status: true,
        },
      });
    }
  
    async suspend(id: string) {
      await this.findOne(id);
  
      return this.prisma.user.update({
        where: { id },
        data: { status: UserStatus.SUSPENDED },
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          status: true,
        },
      });
    }
  
    async remove(id: string) {
      // Check if user exists
      await this.findOne(id);
  
      // Check if user has related records
      const hasStudent = await this.prisma.student.findFirst({
        where: { userId: id },
      });
  
      const hasTeacher = await this.prisma.teacher.findFirst({
        where: { userId: id },
      });
  
      const hasParent = await this.prisma.parent.findFirst({
        where: { userId: id },
      });
  
      if (hasStudent || hasTeacher || hasParent) {
        throw new BadRequestException(
          'Cannot delete user with related student, teacher, or parent records',
        );
      }
  
      return this.prisma.user.delete({
        where: { id },
      });
    }
  
    async getUserStatistics(id: string) {
      const user = await this.findOne(id);
  
      const stats: any = {
        user,
        statistics: {},
      };
  
      // Get statistics based on role
      if (user.role === UserRole.STUDENT) {
        const student = await this.prisma.student.findFirst({
          where: { userId: id },
        });
  
        if (student) {
          const attendanceCount = await this.prisma.attendanceLog.count({
            where: { studentId: student.id },
          });
  
          const paymentCount = await this.prisma.paymentRecord.count({
            where: { studentId: student.id },
          });
  
          stats.statistics = {
            totalAttendance: attendanceCount,
            totalPayments: paymentCount,
          };
        }
      } else if (user.role === UserRole.TEACHER) {
        const teacher = await this.prisma.teacher.findFirst({
          where: { userId: id },
        });
  
        if (teacher) {
          const attendanceCount = await this.prisma.attendanceLog.count({
            where: { teacherId: teacher.id },
          });
  
          stats.statistics = {
            totalAttendance: attendanceCount,
          };
        }
      }
  
      return stats;
    }
  }