import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService) {}

  async create(createAttendanceDto: any) {
    return this.prisma.attendance.create({
      data: {
        schoolId: createAttendanceDto.schoolId,
        studentId: createAttendanceDto.studentId,
        teacherId: createAttendanceDto.teacherId,
        directorId: createAttendanceDto.directorId,
        date: new Date(createAttendanceDto.date),
        status: createAttendanceDto.status,
        checkInTime: createAttendanceDto.checkInTime,
        checkOutTime: createAttendanceDto.checkOutTime,
        lateMinutes: createAttendanceDto.lateMinutes,
        deviceId: createAttendanceDto.deviceId,
        notes: createAttendanceDto.notes,
      },
      include: {
        student: true,
        teacher: true,
        director: true,
      },
    });
  }

  async findAll(
    schoolId?: string,
    date?: string,
    studentId?: string,
    classId?: string,
  ) {
    const where: any = {};

    if (schoolId) where.schoolId = schoolId;
    if (studentId) where.studentId = studentId;
    if (date) {
      const parsedDate = new Date(date);
      parsedDate.setHours(0, 0, 0, 0);
      const nextDay = new Date(parsedDate);
      nextDay.setDate(nextDay.getDate() + 1);
      where.date = { gte: parsedDate, lt: nextDay };
    }

    // Filter by classId through student relation
    if (classId) {
      where.student = { classId };
    }

    return this.prisma.attendance.findMany({
      where,
      include: {
        student: {
          include: { class: true },
        },
        teacher: true,
        director: true,
      },
      orderBy: { date: 'desc' },
    });
  }

  async getTodayAttendance(schoolId: string, classId?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const where: any = {
      schoolId,
      date: { gte: today, lt: tomorrow },
    };

    if (classId) {
      where.student = { classId };
    }

    const attendances = await this.prisma.attendance.findMany({
      where,
      include: {
        student: {
          include: { class: true },
        },
        teacher: true,
        director: true,
      },
    });

    // Group stats
    const studentAttendance = attendances.filter(a => a.studentId);
    const teacherAttendance = attendances.filter(a => a.teacherId);

    return {
      date: today.toISOString().split('T')[0],
      students: {
        present: studentAttendance.filter(a => a.status === 'PRESENT').length,
        late: studentAttendance.filter(a => a.status === 'LATE').length,
        absent: studentAttendance.filter(a => a.status === 'ABSENT').length,
        excused: studentAttendance.filter(a => a.status === 'EXCUSED').length,
        total: studentAttendance.length,
      },
      teachers: {
        present: teacherAttendance.filter(a => a.status === 'PRESENT').length,
        late: teacherAttendance.filter(a => a.status === 'LATE').length,
        absent: teacherAttendance.filter(a => a.status === 'ABSENT').length,
        total: teacherAttendance.length,
      },
      records: attendances,
    };
  }

  async findOne(id: string) {
    const attendance = await this.prisma.attendance.findUnique({
      where: { id },
      include: {
        student: true,
        teacher: true,
        director: true,
        school: true,
      },
    });

    if (!attendance) {
      throw new NotFoundException(`Attendance record with ID ${id} not found`);
    }

    return attendance;
  }

  async update(id: string, updateAttendanceDto: any) {
    const existing = await this.prisma.attendance.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException(`Attendance record with ID ${id} not found`);
    }

    return this.prisma.attendance.update({
      where: { id },
      data: {
        status: updateAttendanceDto.status,
        checkInTime: updateAttendanceDto.checkInTime,
        checkOutTime: updateAttendanceDto.checkOutTime,
        lateMinutes: updateAttendanceDto.lateMinutes,
        notes: updateAttendanceDto.notes,
      },
      include: {
        student: true,
        teacher: true,
        director: true,
      },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.attendance.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException(`Attendance record with ID ${id} not found`);
    }

    await this.prisma.attendance.delete({ where: { id } });
    return { message: 'Attendance record deleted successfully' };
  }
}