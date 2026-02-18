import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClassesService {
  constructor(private prisma: PrismaService) {}

  async create(createClassDto: any) {
    // Check if class already exists
    const existing = await this.prisma.class.findFirst({
      where: {
        schoolId: createClassDto.schoolId,
        grade: createClassDto.grade,
        section: createClassDto.section,
        academicYear: createClassDto.academicYear,
      },
    });

    if (existing) {
      throw new ConflictException(
        `Class ${createClassDto.grade}-${createClassDto.section} already exists for ${createClassDto.academicYear}`,
      );
    }

    return this.prisma.class.create({
      data: {
        schoolId: createClassDto.schoolId,
        grade: createClassDto.grade,
        section: createClassDto.section,
        academicYear: createClassDto.academicYear,
      },
      include: {
        school: true,
        _count: { select: { students: true } },
        // ✅ QO'SHILDI: O'qituvchini ko'rsatish uchun
        teacherClasses: {
          include: {
            teacher: true
          }
        }
      },
    });
  }

  async findAll(schoolId?: string, academicYear?: string) {
    const where: any = {};
    if (schoolId) where.schoolId = schoolId;
    if (academicYear) where.academicYear = academicYear;
  
    return this.prisma.class.findMany({
      where,
      include: {
        school: true,
        _count: { select: { students: true } },
        // ✅ QO'SHILDI: Sinf rahbarini frontendda chiqarish uchun
        teacherClasses: {
          include: {
            teacher: true
          }
        }
      },
      orderBy: [{ grade: 'asc' }, { section: 'asc' }],
    });
  }

  async findOne(id: string) {
    const cls = await this.prisma.class.findUnique({
      where: { id },
      include: {
        school: true,
        students: {
          include: {
            parents: true,
          },
        },
        _count: {
          select: { students: true },
        },
      },
    });

    if (!cls) {
      throw new NotFoundException(`Class with ID ${id} not found`);
    }

    return cls;
  }

  async update(id: string, updateClassDto: any) {
    const existing = await this.prisma.class.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException(`Class with ID ${id} not found`);
    }

    return this.prisma.class.update({
    where: { id },
    data: {
      grade: updateClassDto.grade,
      section: updateClassDto.section,
      academicYear: updateClassDto.academicYear,
    },
    include: {
      school: true,
      _count: { select: { students: true } },
      // ✅ QO'SHILDI: Update dan keyin ham ma'lumotni qaytarish uchun
      teacherClasses: {
        include: {
          teacher: true
        }
      }
    },
  });
  }

  async remove(id: string) {
    const cls = await this.prisma.class.findUnique({
      where: { id },
      include: {
        _count: {
          select: { students: true },
        },
      },
    });

    if (!cls) {
      throw new NotFoundException(`Class with ID ${id} not found`);
    }

    if (cls._count.students > 0) {
      throw new ConflictException(
        `Cannot delete class with ${cls._count.students} students. Move students first.`,
      );
    }

    await this.prisma.class.delete({ where: { id } });
    return { message: 'Class deleted successfully' };
  }
}