import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDistrictDto, UpdateDistrictDto } from './dto/district.dto';

@Injectable()
export class DistrictsService {
  constructor(private prisma: PrismaService) {}

  async create(createDistrictDto: CreateDistrictDto) {
    // Check if code already exists
    const existingDistrict = await this.prisma.district.findUnique({
      where: { code: createDistrictDto.code },
    });

    if (existingDistrict) {
      throw new ConflictException('District code already exists');
    }

    return this.prisma.district.create({
      data: createDistrictDto,
    });
  }

  async findAll() {
    return this.prisma.district.findMany({
      include: {
        schools: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        _count: {
          select: {
            schools: true,
            districtAdmin: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const district = await this.prisma.district.findUnique({
      where: { id },
      include: {
        schools: {
          select: {
            id: true,
            name: true,
            code: true,
            address: true,
            phone: true,
            email: true,
          },
        },
        districtAdmin: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            user: {
              select: {
                username: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!district) {
      throw new NotFoundException(`District with ID ${id} not found`);
    }

    return district;
  }

  async update(id: string, updateDistrictDto: UpdateDistrictDto) {
    // Check if district exists
    await this.findOne(id);

    // Check if new code already exists (if updating code)
    if (updateDistrictDto.code) {
      const existingDistrict = await this.prisma.district.findUnique({
        where: { code: updateDistrictDto.code },
      });

      if (existingDistrict && existingDistrict.id !== id) {
        throw new ConflictException('District code already exists');
      }
    }

    return this.prisma.district.update({
      where: { id },
      data: updateDistrictDto,
    });
  }

  async remove(id: string) {
    // Check if district exists
    await this.findOne(id);

    // Check if district has schools
    const schoolCount = await this.prisma.school.count({
      where: { districtId: id },
    });

    if (schoolCount > 0) {
      throw new ConflictException(
        `Cannot delete district with ${schoolCount} schools. Please delete or reassign schools first.`,
      );
    }

    return this.prisma.district.delete({
      where: { id },
    });
  }

  async getStatistics(id: string) {
    const district = await this.findOne(id);

    const stats = await this.prisma.district.findUnique({
      where: { id },
      select: {
        _count: {
          select: {
            schools: true,
            districtAdmin: true,
          },
        },
      },
    });

    // Get total students and teachers across all schools in district
    const schools = await this.prisma.school.findMany({
      where: { districtId: id },
      select: {
        _count: {
          select: {
            students: true,
            teachers: true,
          },
        },
      },
    });

    const totalStudents = schools.reduce(
      (sum, school) => sum + school._count.students,
      0,
    );
    const totalTeachers = schools.reduce(
      (sum, school) => sum + school._count.teachers,
      0,
    );

    return {
      district: {
        id: district.id,
        name: district.name,
        region: district.region,
        code: district.code,
      },
      statistics: {
        totalSchools: stats._count.schools,
        totalAdmins: stats._count.districtAdmin,
        totalStudents,
        totalTeachers,
      },
    };
  }
}
