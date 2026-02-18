import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDirectorDto, UpdateDirectorDto } from './dto/director.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class DirectorsService {
  constructor(private prisma: PrismaService) {}

  async create(createDirectorDto: CreateDirectorDto) {
    // Create user account first
    const user = await this.prisma.user.create({
      data: {
        username: createDirectorDto.username,
        password: await bcrypt.hash(createDirectorDto.password, 10),
        email: createDirectorDto.email,
        role: 'DIRECTOR',
        status: 'ACTIVE',
      },
    });

    // Create director
    const director = await this.prisma.director.create({
      data: {
        userId: user.id,
        schoolId: createDirectorDto.schoolId,
        firstName: createDirectorDto.firstName,
        lastName: createDirectorDto.lastName,
        phone: createDirectorDto.phone,
        telegramId: createDirectorDto.telegramId,
        photo: createDirectorDto.photo, // ✅ BASE64 STRING
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
        school: true,
      },
    });

    return director;
  }

  async findByUserId(userId: string, options?: any) {
    if (!userId) {
      throw new BadRequestException('User ID taqdim etilmadi');
    }
  
    const director = await this.prisma.director.findFirst({
      where: { userId: userId },
      ...options,
    });
  
    if (!director) {
      throw new NotFoundException('Direktor topilmadi');
    }
  
    return director;
  }

  async findAll(schoolId?: string) {
    const where: any = {};
    
    if (schoolId) {
      where.schoolId = schoolId;
    }

    return this.prisma.director.findMany({
      where,
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
        school: true,
        _count: {
          select: {
            attendances: true,
          },
        },
      },
      orderBy: {
        lastName: 'asc',
      },
    });
  }

  async findOne(id: string) {
    const director = await this.prisma.director.findUnique({
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
        school: {
          include: {
            district: true, // ✅ ADDED for breadcrumbs
          },
        },
        attendances: {
          orderBy: {
            date: 'desc',
          },
          take: 30,
        },
      },
    });

    if (!director) {
      throw new NotFoundException(`Director with ID ${id} not found`);
    }

    return director;
  }

  async update(id: string, updateDirectorDto: UpdateDirectorDto) {
    // Check if director exists
    const existingDirector = await this.prisma.director.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!existingDirector) {
      throw new NotFoundException(`Director with ID ${id} not found`);
    }

    // Update user if password or email changed
    if (updateDirectorDto.password || updateDirectorDto.email) {
      const userData: any = {};
      
      if (updateDirectorDto.email) {
        userData.email = updateDirectorDto.email;
      }
      
      if (updateDirectorDto.password) {
        userData.password = await bcrypt.hash(updateDirectorDto.password, 10);
      }

      await this.prisma.user.update({
        where: { id: existingDirector.userId },
        data: userData,
      });
    }

    // Update director
    const director = await this.prisma.director.update({
      where: { id },
      data: {
        firstName: updateDirectorDto.firstName,
        lastName: updateDirectorDto.lastName,
        phone: updateDirectorDto.phone,
        telegramId: updateDirectorDto.telegramId,
        photo: updateDirectorDto.photo, // ✅ BASE64 STRING
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
        school: true,
      },
    });

    return director;
  }

  async remove(id: string) {
    // Check if director exists
    const director = await this.prisma.director.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!director) {
      throw new NotFoundException(`Director with ID ${id} not found`);
    }

    // Delete related records
    await this.prisma.attendance.deleteMany({ where: { directorId: id } });

    // Delete director
    await this.prisma.director.delete({ where: { id } });

    // Delete user account
    await this.prisma.user.delete({ where: { id: director.userId } });

    return { message: 'Director deleted successfully' };
  }

  // Get director attendance statistics
  async getAttendanceStats(directorId: string, startDate?: Date, endDate?: Date) {
    const where: any = { directorId };

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = startDate;
      if (endDate) where.date.lte = endDate;
    }

    const attendances = await this.prisma.attendance.findMany({
      where,
      orderBy: { date: 'desc' },
    });

    const total = attendances.length;
    const present = attendances.filter(a => a.status === 'PRESENT').length;
    const late = attendances.filter(a => a.status === 'LATE').length;
    const absent = attendances.filter(a => a.status === 'ABSENT').length;

    return {
      total,
      present,
      late,
      absent,
      attendanceRate: total > 0 ? ((present + late) / total * 100).toFixed(2) : '0',
    };
  }

  // ✅ GET PROFILE - Used by /directors/me endpoint
  async getProfile(userId: string) {
    const director = await this.prisma.director.findFirst({
      where: { userId },
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
        school: {
          include: {
            district: true, // ✅ IMPORTANT for breadcrumbs
          },
        },
      },
    });

    if (!director) {
      throw new NotFoundException('Director profile not found');
    }

    return director; // ✅ Return full director object (not just partial)
  }
}