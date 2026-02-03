import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CheckInDto,
  CheckOutDto,
  CreateAttendanceDto,
  UpdateAttendanceDto,
  CreateAbsenceRecordDto,
  AttendanceReportDto,
} from './dto/attendance.dto';
import { AttendanceStatus } from '@prisma/client';

@Injectable()
export class AttendanceService {
  // School start time (8:00 AM)
  private readonly SCHOOL_START_HOUR = 8;
  private readonly SCHOOL_START_MINUTE = 0;

  constructor(private prisma: PrismaService) {}

  async checkIn(checkInDto: CheckInDto) {
    const { schoolId, studentId, teacherId, directorId, deviceId } = checkInDto;

    // Validate that at least one person is checking in
    if (!studentId && !teacherId && !directorId) {
      throw new BadRequestException(
        'Either studentId, teacherId, or directorId must be provided',
      );
    }

    // Check if already checked in today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingLog = await this.prisma.attendanceLog.findFirst({
      where: {
        date: {
          gte: today,
        },
        ...(studentId && { studentId }),
        ...(teacherId && { teacherId }),
        ...(directorId && { directorId }),
      },
    });

    if (existingLog) {
      throw new ConflictException('Already checked in today');
    }

    // Determine check-in time
    const checkInTime = checkInDto.checkInTime
      ? new Date(checkInDto.checkInTime)
      : new Date();

    // Calculate if late
    const { status, lateMinutes } = this.calculateAttendanceStatus(checkInTime);

    // Create attendance log
    const attendanceLog = await this.prisma.attendanceLog.create({
      data: {
        schoolId,
        studentId,
        teacherId,
        directorId,
        date: new Date(),
        checkInTime,
        status,
        lateMinutes,
        deviceId,
      },
      include: {
        student: {
          select: {
            id: true,
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
        teacher: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        director: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    // TODO: Send notification to parent if student is late
    if (studentId && status === AttendanceStatus.LATE) {
      await this.notifyParentAboutLateArrival(studentId, lateMinutes);
    }

    return attendanceLog;
  }

  async checkOut(checkOutDto: CheckOutDto) {
    const { attendanceLogId, checkOutTime } = checkOutDto;

    // Find attendance log
    const attendanceLog = await this.prisma.attendanceLog.findUnique({
      where: { id: attendanceLogId },
    });

    if (!attendanceLog) {
      throw new NotFoundException('Attendance log not found');
    }

    if (attendanceLog.checkOutTime) {
      throw new ConflictException('Already checked out');
    }

    // Update with checkout time
    return this.prisma.attendanceLog.update({
      where: { id: attendanceLogId },
      data: {
        checkOutTime: checkOutTime ? new Date(checkOutTime) : new Date(),
      },
    });
  }

  async create(createAttendanceDto: CreateAttendanceDto) {
    const {
      schoolId,
      studentId,
      teacherId,
      directorId,
      status,
      date,
      checkInTime,
      checkOutTime,
      lateMinutes,
      deviceId,
    } = createAttendanceDto;

    // Validate that at least one person is provided
    if (!studentId && !teacherId && !directorId) {
      throw new BadRequestException(
        'Either studentId, teacherId, or directorId must be provided',
      );
    }

    return this.prisma.attendanceLog.create({
      data: {
        schoolId,
        studentId,
        teacherId,
        directorId,
        status,
        date: date ? new Date(date) : new Date(),
        checkInTime: checkInTime ? new Date(checkInTime) : null,
        checkOutTime: checkOutTime ? new Date(checkOutTime) : null,
        lateMinutes: lateMinutes || 0,
        deviceId,
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

    if (schoolId) {
      where.schoolId = schoolId;
    }

    if (date) {
      const targetDate = new Date(date);
      targetDate.setHours(0, 0, 0, 0);
      const nextDay = new Date(targetDate);
      nextDay.setDate(nextDay.getDate() + 1);

      where.date = {
        gte: targetDate,
        lt: nextDay,
      };
    }

    if (studentId) {
      where.studentId = studentId;
    }

    if (classId) {
      where.student = {
        classId,
      };
    }

    return this.prisma.attendanceLog.findMany({
      where,
      include: {
        student: {
          select: {
            id: true,
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
        teacher: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        director: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: {
        date: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const log = await this.prisma.attendanceLog.findUnique({
      where: { id },
      include: {
        student: {
          select: {
            id: true,
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
        teacher: true,
        director: true,
      },
    });

    if (!log) {
      throw new NotFoundException('Attendance log not found');
    }

    return log;
  }

  async update(id: string, updateAttendanceDto: UpdateAttendanceDto) {
    await this.findOne(id);

    const updateData: any = {};

    if (updateAttendanceDto.status) {
      updateData.status = updateAttendanceDto.status;
    }

    if (updateAttendanceDto.checkInTime) {
      updateData.checkInTime = new Date(updateAttendanceDto.checkInTime);
    }

    if (updateAttendanceDto.checkOutTime) {
      updateData.checkOutTime = new Date(updateAttendanceDto.checkOutTime);
    }

    if (updateAttendanceDto.lateMinutes !== undefined) {
      updateData.lateMinutes = updateAttendanceDto.lateMinutes;
    }

    return this.prisma.attendanceLog.update({
      where: { id },
      data: updateData,
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    await this.prisma.attendanceLog.delete({
      where: { id },
    });

    return { message: 'Attendance log deleted successfully' };
  }

  // Absence Records
  async createAbsenceRecord(createAbsenceDto: CreateAbsenceRecordDto) {
    const { studentId, date, reason, isExcused, document } = createAbsenceDto;

    // Check if student exists
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    // Check if absence record already exists for this date
    const existingRecord = await this.prisma.absenceRecord.findUnique({
      where: {
        studentId_date: {
          studentId,
          date: new Date(date),
        },
      },
    });

    if (existingRecord) {
      throw new ConflictException(
        'Absence record already exists for this date',
      );
    }

    return this.prisma.absenceRecord.create({
      data: {
        studentId,
        date: new Date(date),
        reason,
        isExcused: isExcused || false,
        document,
      },
    });
  }

  async getAbsenceRecords(
    studentId?: string,
    startDate?: string,
    endDate?: string,
  ) {
    const where: any = {};

    if (studentId) {
      where.studentId = studentId;
    }

    if (startDate || endDate) {
      where.date = {};
      if (startDate) {
        where.date.gte = new Date(startDate);
      }
      if (endDate) {
        where.date.lte = new Date(endDate);
      }
    }

    return this.prisma.absenceRecord.findMany({
      where,
      include: {
        student: {
          select: {
            id: true,
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
      orderBy: {
        date: 'desc',
      },
    });
  }

  // Reports
  async generateReport(reportDto: AttendanceReportDto) {
    const { schoolId, startDate, endDate, classId, studentId } = reportDto;

    const where: any = { schoolId };

    if (startDate || endDate) {
      where.date = {};
      if (startDate) {
        where.date.gte = new Date(startDate);
      }
      if (endDate) {
        where.date.lte = new Date(endDate);
      }
    }

    if (studentId) {
      where.studentId = studentId;
    } else if (classId) {
      where.student = {
        classId,
      };
    }

    const logs = await this.prisma.attendanceLog.findMany({
      where,
      include: {
        student: {
          select: {
            id: true,
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

    // Calculate statistics
    const stats = {
      total: logs.length,
      present: logs.filter((l) => l.status === AttendanceStatus.PRESENT).length,
      late: logs.filter((l) => l.status === AttendanceStatus.LATE).length,
      absent: logs.filter((l) => l.status === AttendanceStatus.ABSENT).length,
      excused: logs.filter((l) => l.status === AttendanceStatus.EXCUSED).length,
      averageLateMinutes:
        logs.filter((l) => l.status === AttendanceStatus.LATE).length > 0
          ? logs
              .filter((l) => l.status === AttendanceStatus.LATE)
              .reduce((sum, l) => sum + l.lateMinutes, 0) /
            logs.filter((l) => l.status === AttendanceStatus.LATE).length
          : 0,
    };

    return {
      statistics: stats,
      logs,
    };
  }

  async getTodayAttendance(schoolId: string, classId?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const where: any = {
      schoolId,
      date: {
        gte: today,
      },
    };

    if (classId) {
      where.student = {
        classId,
      };
    }

    return this.prisma.attendanceLog.findMany({
      where,
      include: {
        student: {
          select: {
            id: true,
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
      orderBy: {
        checkInTime: 'asc',
      },
    });
  }

  // Helper functions
  private calculateAttendanceStatus(checkInTime: Date): {
    status: AttendanceStatus;
    lateMinutes: number;
  } {
    const schoolStartTime = new Date(checkInTime);
    schoolStartTime.setHours(
      this.SCHOOL_START_HOUR,
      this.SCHOOL_START_MINUTE,
      0,
      0,
    );

    if (checkInTime <= schoolStartTime) {
      return {
        status: AttendanceStatus.PRESENT,
        lateMinutes: 0,
      };
    }

    const lateMinutes = Math.floor(
      (checkInTime.getTime() - schoolStartTime.getTime()) / (1000 * 60),
    );

    return {
      status: AttendanceStatus.LATE,
      lateMinutes,
    };
  }

  private async notifyParentAboutLateArrival(
    studentId: string,
    lateMinutes: number,
  ) {
    // TODO: Implement SMS/Telegram notification
    // This will be implemented in notifications module
    console.log(
      `Student ${studentId} is late by ${lateMinutes} minutes. Notifying parents...`,
    );
  }
}
