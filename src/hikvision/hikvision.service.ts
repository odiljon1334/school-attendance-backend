// src/hikvision/hikvision.service.ts - UPDATED VERSION

import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HikvisionApiService } from './hikvision-api.service';
import { CreateDeviceDto, UpdateDeviceDto, RegisterFaceDto } from './dto/hikvision.dto';
import { ConfigService } from '@nestjs/config';
import { PayrollService } from '../payroll/payroll.service';

@Injectable()
export class HikvisionService {
  constructor(
    private prisma: PrismaService,
    private hikvisionApi: HikvisionApiService,
    private payrollService: PayrollService,  
    private configService: ConfigService,
  ) {}

  // ────────────────────────────────────────────────────────
  // DEVICE MANAGEMENT (No changes needed)
  // ────────────────────────────────────────────────────────

  async createDevice(createDeviceDto: CreateDeviceDto) {
    const { schoolId, deviceId, ipAddress, port, username, password } = createDeviceDto;

    const school = await this.prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) {
      throw new NotFoundException('School not found');
    }

    return this.prisma.hikvisionDevice.create({
      data: {
        ...createDeviceDto,
        port: port || 80,
        isActive: createDeviceDto.isActive !== false,
      },
      include: {
        school: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
    });
  }

  async findAll(schoolId?: string) {
    const where: any = {};
    if (schoolId) {
      where.schoolId = schoolId;
    }

    return this.prisma.hikvisionDevice.findMany({
      where,
      include: {
        school: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        _count: {
          select: {
            attendanceLogs: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const device = await this.prisma.hikvisionDevice.findUnique({
      where: { id },
      include: {
        school: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        _count: {
          select: {
            attendanceLogs: true,
          },
        },
      },
    });

    if (!device) {
      throw new NotFoundException(`Device with ID ${id} not found`);
    }

    return device;
  }

  async update(id: string, updateDeviceDto: UpdateDeviceDto) {
    const device = await this.findOne(id);

    if (
      updateDeviceDto.ipAddress ||
      updateDeviceDto.port ||
      updateDeviceDto.username ||
      updateDeviceDto.password
    ) {
      const canConnect = await this.hikvisionApi.testConnection(
        updateDeviceDto.ipAddress || device.ipAddress,
        updateDeviceDto.port || device.port,
        updateDeviceDto.username || device.username,
        updateDeviceDto.password || device.password,
      );

      if (!canConnect) {
        throw new BadRequestException('Cannot connect to device with new settings.');
      }
    }

    return this.prisma.hikvisionDevice.update({
      where: { id },
      data: updateDeviceDto,
      include: {
        school: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.hikvisionDevice.delete({ where: { id } });
    return { message: 'Device deleted successfully' };
  }

  async testDevice(id: string) {
    const device = await this.findOne(id);

    const canConnect = await this.hikvisionApi.testConnection(
      device.ipAddress,
      device.port,
      device.username,
      device.password,
    );

    if (!canConnect) {
      return {
        success: false,
        message: 'Cannot connect to device',
      };
    }

    const info = await this.hikvisionApi.getDeviceInfo(
      device.ipAddress,
      device.port,
      device.username,
      device.password,
    );

    return {
      success: true,
      message: 'Device is online',
      deviceInfo: info,
    };
  }

  // ────────────────────────────────────────────────────────
  // FACE REGISTRATION - UPDATED
  // ────────────────────────────────────────────────────────

  async registerFace(registerFaceDto: RegisterFaceDto) {
    const { deviceId, studentId, teacherId, directorId, faceImage } = registerFaceDto;

    const device = await this.prisma.hikvisionDevice.findUnique({ where: { id: deviceId } });
    if (!device) {
      throw new NotFoundException('Device not found');
    }

    const personTypes = [studentId, teacherId, directorId].filter(Boolean);
    if (personTypes.length !== 1) {
      throw new BadRequestException('Provide exactly one of: studentId, teacherId, or directorId');
    }

    let personId: string;
    let personName: string;
    let facePersonId: string;

    if (studentId) {
      const student = await this.prisma.student.findUnique({
        where: { id: studentId },
        select: { id: true, firstName: true, lastName: true },
      });
      if (!student) throw new NotFoundException('Student not found');
      personId = student.id;
      personName = `${student.firstName} ${student.lastName}`;
      
      // ✅ GENERATE UNIQUE FACE ID
      facePersonId = `STU_${student.id}`;
      
    } else if (teacherId) {
      const teacher = await this.prisma.teacher.findUnique({
        where: { id: teacherId },
        select: { id: true, firstName: true, lastName: true },
      });
      if (!teacher) throw new NotFoundException('Teacher not found');
      personId = teacher.id;
      personName = `${teacher.firstName} ${teacher.lastName}`;
      
      // ✅ GENERATE UNIQUE FACE ID
      facePersonId = `TCH_${teacher.id}`;
      
    } else {
      const director = await this.prisma.director.findUnique({
        where: { id: directorId! },
        select: { id: true, firstName: true, lastName: true },
      });
      if (!director) throw new NotFoundException('Director not found');
      personId = director.id;
      personName = `${director.firstName} ${director.lastName}`;
      
      // ✅ GENERATE UNIQUE FACE ID
      facePersonId = `DIR_${director.id}`;
    }

    // Register face to Hikvision device
    const success = await this.hikvisionApi.registerFace(
      device.ipAddress,
      device.port,
      device.username,
      device.password,
      facePersonId,  // ✅ Use unique face ID
      personName,
      faceImage,
    );

    if (!success) {
      throw new BadRequestException('Failed to register face to device');
    }

    // ✅ SAVE FACE ID TO DATABASE
    if (studentId) {
      await this.prisma.student.update({
        where: { id: studentId },
        data: { facePersonId },
      });
    } else if (teacherId) {
      await this.prisma.teacher.update({
        where: { id: teacherId },
        data: { facePersonId },
      });
    } else {
      await this.prisma.director.update({
        where: { id: directorId! },
        data: { facePersonId },
      });
    }

    return {
      success: true,
      message: `Face registered successfully for ${personName}`,
      personId,
      facePersonId,
      deviceId: device.id,
    };
  }

  async deleteFace(deviceId: string, personId: string) {
    const device = await this.prisma.hikvisionDevice.findUnique({ where: { id: deviceId } });
    if (!device) {
      throw new NotFoundException('Device not found');
    }

    const success = await this.hikvisionApi.deleteFace(
      device.ipAddress,
      device.port,
      device.username,
      device.password,
      personId,
    );

    if (!success) {
      throw new BadRequestException('Failed to delete face from device');
    }

    return {
      success: true,
      message: 'Face deleted successfully',
    };
  }

  // ────────────────────────────────────────────────────────
  // EVENT WEBHOOK - COMPLETELY REWRITTEN ✅
  // ────────────────────────────────────────────────────────

  async handleFaceRecognitionEvent(event: any) {
    // Extract person ID from event
    const facePersonId = event.employeeNo || event.personId || event.facePersonId;
    const deviceId = event.deviceId;
    const timestamp = new Date(event.time || event.timestamp || Date.now());

    if (!facePersonId || !deviceId) {
      throw new BadRequestException('Invalid event data: missing facePersonId or deviceId');
    }

    // Find device
    const device = await this.prisma.hikvisionDevice.findUnique({ where: { id: deviceId } });
    if (!device) {
      throw new NotFoundException('Device not found');
    }

    // ✅ DETERMINE PERSON TYPE FROM FACE ID PREFIX
    let personType: 'STUDENT' | 'TEACHER' | 'DIRECTOR' | null = null;
    
    if (facePersonId.startsWith('STU_')) {
      personType = 'STUDENT';
    } else if (facePersonId.startsWith('TCH_')) {
      personType = 'TEACHER';
    } else if (facePersonId.startsWith('DIR_')) {
      personType = 'DIRECTOR';
    }

    // ✅ FIND PERSON BY FACE ID
    const student = personType === 'STUDENT' 
      ? await this.prisma.student.findUnique({ where: { facePersonId } })
      : null;
      
    const teacher = personType === 'TEACHER'
      ? await this.prisma.teacher.findUnique({ where: { facePersonId } })
      : null;
      
    const director = personType === 'DIRECTOR'
      ? await this.prisma.director.findUnique({ where: { facePersonId } })
      : null;

    if (!student && !teacher && !director) {
      throw new NotFoundException(`Person not found with facePersonId: ${facePersonId}`);
    }

    // ✅ ROUTE TO APPROPRIATE HANDLER
    if (student) {
      return this.handleStudentAttendance(student, device, timestamp);
    } else if (teacher) {
      return this.handleTeacherAttendance(teacher, device, timestamp);
    } else if (director) {
      return this.handleDirectorAttendance(director, device, timestamp);
    }
  }

  // ✅ PRIVATE: Handle student attendance (existing logic)
  private async handleStudentAttendance(student: any, device: any, timestamp: Date) {
    const schoolStartHour = 8;
    const hour = timestamp.getHours();
    const minute = timestamp.getMinutes();
    const totalMinutes = hour * 60 + minute;
    const schoolStartMinutes = schoolStartHour * 60;

    const isLate = totalMinutes > schoolStartMinutes;
    const lateMinutes = isLate ? totalMinutes - schoolStartMinutes : 0;

    const attendanceLog = await this.prisma.attendanceLog.create({
      data: {
        schoolId: device.schoolId,
        studentId: student.id,
        deviceId: device.id,
        date: timestamp,
        checkInTime: timestamp,
        status: isLate ? 'LATE' : 'PRESENT',
        lateMinutes,
      },
    });

    return {
      success: true,
      type: 'STUDENT',
      person: {
        id: student.id,
        name: `${student.firstName} ${student.lastName}`,
      },
      status: isLate ? 'LATE' : 'PRESENT',
      lateMinutes,
      attendanceLog,
    };
  }

  // ✅ NEW: Handle teacher attendance with payroll integration
  private async handleTeacherAttendance(teacher: any, device: any, timestamp: Date) {
    // Determine check type (IN or OUT)
    const today = new Date(timestamp);
    today.setHours(0, 0, 0, 0);

    const lastAttendance = await this.prisma.teacherAttendance.findUnique({
      where: {
        teacherId_date: {
          teacherId: teacher.id,
          date: today,
        },
      },
    });

    const checkType = !lastAttendance || !lastAttendance.checkInTime ? 'IN' : 'OUT';

    // ✅ USE PAYROLL SERVICE
    const attendance = await this.payrollService.processAttendance(
      teacher.id,
      checkType,
      timestamp,
    );

    // Also create AttendanceLog for compatibility
    await this.prisma.attendanceLog.create({
      data: {
        schoolId: device.schoolId,
        teacherId: teacher.id,
        deviceId: device.id,
        date: timestamp,
        checkInTime: checkType === 'IN' ? timestamp : null,
        checkOutTime: checkType === 'OUT' ? timestamp : null,
        status: 'PRESENT',
      },
    });

    return {
      success: true,
      type: 'TEACHER',
      checkType,
      person: {
        id: teacher.id,
        name: `${teacher.firstName} ${teacher.lastName}`,
      },
      attendance,
    };
  }

  // ✅ NEW: Handle director attendance
  private async handleDirectorAttendance(director: any, device: any, timestamp: Date) {
    const schoolStartHour = 8;
    const hour = timestamp.getHours();
    const minute = timestamp.getMinutes();
    const totalMinutes = hour * 60 + minute;
    const schoolStartMinutes = schoolStartHour * 60;

    const isLate = totalMinutes > schoolStartMinutes;
    const lateMinutes = isLate ? totalMinutes - schoolStartMinutes : 0;

    const attendanceLog = await this.prisma.attendanceLog.create({
      data: {
        schoolId: device.schoolId,
        directorId: director.id,
        deviceId: device.id,
        date: timestamp,
        checkInTime: timestamp,
        status: isLate ? 'LATE' : 'PRESENT',
        lateMinutes,
      },
    });

    return {
      success: true,
      type: 'DIRECTOR',
      person: {
        id: director.id,
        name: `${director.firstName} ${director.lastName}`,
      },
      status: isLate ? 'LATE' : 'PRESENT',
      lateMinutes,
      attendanceLog,
    };
  }
}