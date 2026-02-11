import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HikvisionApiService } from './hikvision-api.service';
import { CreateDeviceDto, UpdateDeviceDto, RegisterFaceDto } from './dto/hikvision.dto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class HikvisionService {
  constructor(
    private prisma: PrismaService,
    private hikvisionApi: HikvisionApiService,
    private configService: ConfigService,
  ) {}

  // ────────────────────────────────────────────────────────
  // DEVICE MANAGEMENT
  // ────────────────────────────────────────────────────────

  async createDevice(createDeviceDto: CreateDeviceDto) {
    const { schoolId, deviceId, ipAddress, port, username, password } = createDeviceDto;

    // Check if school exists
    const school = await this.prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) {
      throw new NotFoundException('School not found');
    }

    // Test connection
    // const canConnect = await this.hikvisionApi.testConnection(
    //   ipAddress,
    //   port || 80,
    //   username,
    //   password,
    // );

    // if (!canConnect) {
    //   throw new BadRequestException('Cannot connect to device. Check IP, port, username, and password.');
    // }

    // Create device
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

    // If IP/port/credentials changed, test connection
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
  // FACE REGISTRATION
  // ────────────────────────────────────────────────────────

  async registerFace(registerFaceDto: RegisterFaceDto) {
    const { deviceId, studentId, teacherId, directorId, faceImage } = registerFaceDto;

    // Get device
    const device = await this.prisma.hikvisionDevice.findUnique({ where: { id: deviceId } });
    if (!device) {
      throw new NotFoundException('Device not found');
    }

    // Validate that exactly one person type is provided
    const personTypes = [studentId, teacherId, directorId].filter(Boolean);
    if (personTypes.length !== 1) {
      throw new BadRequestException('Provide exactly one of: studentId, teacherId, or directorId');
    }

    let personId: string;
    let personName: string;

    if (studentId) {
      const student = await this.prisma.student.findUnique({
        where: { id: studentId },
        select: { id: true, firstName: true, lastName: true },
      });
      if (!student) throw new NotFoundException('Student not found');
      personId = student.id;
      personName = `${student.firstName} ${student.lastName}`;
    } else if (teacherId) {
      const teacher = await this.prisma.teacher.findUnique({
        where: { id: teacherId },
        select: { id: true, firstName: true, lastName: true },
      });
      if (!teacher) throw new NotFoundException('Teacher not found');
      personId = teacher.id;
      personName = `${teacher.firstName} ${teacher.lastName}`;
    } else {
      const director = await this.prisma.director.findUnique({
        where: { id: directorId! },
        select: { id: true, firstName: true, lastName: true },
      });
      if (!director) throw new NotFoundException('Director not found');
      personId = director.id;
      personName = `${director.firstName} ${director.lastName}`;
    }

    // Register face to Hikvision device
    const success = await this.hikvisionApi.registerFace(
      device.ipAddress,
      device.port,
      device.username,
      device.password,
      personId,
      personName,
      faceImage,
    );

    if (!success) {
      throw new BadRequestException('Failed to register face to device');
    }

    return {
      success: true,
      message: `Face registered successfully for ${personName}`,
      personId,
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
  // EVENT WEBHOOK (Called by Hikvision device)
  // ────────────────────────────────────────────────────────

  async handleFaceRecognitionEvent(event: any) {
    // Extract person ID from event
    const personId = event.employeeNo || event.personId;
    const deviceId = event.deviceId;
    const timestamp = new Date(event.time || event.timestamp);

    if (!personId || !deviceId) {
      throw new BadRequestException('Invalid event data');
    }

    // Find device
    const device = await this.prisma.hikvisionDevice.findUnique({ where: { id: deviceId } });
    if (!device) {
      throw new NotFoundException('Device not found');
    }

    // Determine if student, teacher, or director
    const student = await this.prisma.student.findUnique({ where: { id: personId } });
    const teacher = await this.prisma.teacher.findUnique({ where: { id: personId } });
    const director = await this.prisma.director.findUnique({ where: { id: personId } });

    if (!student && !teacher && !director) {
      throw new NotFoundException('Person not found in database');
    }

    // Calculate attendance status
    const schoolStartHour = 8;
    const hour = timestamp.getHours();
    const minute = timestamp.getMinutes();
    const totalMinutes = hour * 60 + minute;
    const schoolStartMinutes = schoolStartHour * 60;

    const isLate = totalMinutes > schoolStartMinutes;
    const lateMinutes = isLate ? totalMinutes - schoolStartMinutes : 0;

    // Create attendance log
    const attendanceLog = await this.prisma.attendanceLog.create({
      data: {
        schoolId: device.schoolId,
        studentId: student?.id,
        teacherId: teacher?.id,
        directorId: director?.id,
        deviceId: device.id,
        date: timestamp,
        checkInTime: timestamp,
        status: isLate ? 'LATE' : 'PRESENT',
        lateMinutes,
      },
    });

    return {
      success: true,
      message: 'Attendance recorded',
      attendanceLog,
    };
  }
}