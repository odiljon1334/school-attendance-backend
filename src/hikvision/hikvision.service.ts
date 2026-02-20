import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HikvisionApiService } from './hikvision-api.service';
import { CreateDeviceDto, UpdateDeviceDto, RegisterFaceDto } from './dto/hikvision.dto';
import { PayrollService } from '../payroll/payroll.service';
import { AttendanceStatus } from '@prisma/client';

@Injectable()
export class HikvisionService {
  private readonly logger = new Logger('HikvisionService');

  constructor(
    private prisma: PrismaService,
    private hikvisionApi: HikvisionApiService,
    private payrollService: PayrollService,
  ) {}

  // ────────────────────────────────────────────────────────
  // DEVICE MANAGEMENT
  // ────────────────────────────────────────────────────────

  async createDevice(dto: CreateDeviceDto) {
    const school = await this.prisma.school.findUnique({ where: { id: dto.schoolId } });
    if (!school) throw new NotFoundException('School not found');

    return this.prisma.hikvisionDevice.create({
      data: { ...dto, port: dto.port || 80 },
    });
  }

  async findAll(schoolId?: string) {
    return this.prisma.hikvisionDevice.findMany({
      where: schoolId ? { schoolId } : {},
      include: { school: { select: { name: true, code: true } } },
    });
  }

  async findOne(id: string) {
    const device = await this.prisma.hikvisionDevice.findUnique({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');
    return device;
  }

  async testDevice(id: string) {
    const device = await this.findOne(id);
    const online = await this.hikvisionApi.testConnection(
      device.ipAddress, device.port, device.username, device.password
    );
    return { success: online, message: online ? 'Online' : 'Offline' };
  }

  async update(id: string, dto: UpdateDeviceDto) {
    await this.findOne(id);
    return this.prisma.hikvisionDevice.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.hikvisionDevice.delete({ where: { id } });
  }

  // ────────────────────────────────────────────────────────
  // FACE REGISTRATION
  // ────────────────────────────────────────────────────────

  async registerFace(dto: RegisterFaceDto) {
    const device = await this.findOne(dto.deviceId);
    
    let personData: { id: string, name: string, prefix: string };
    
    if (dto.studentId) {
      const s = await this.prisma.student.findUnique({ where: { id: dto.studentId } });
      if (!s) throw new NotFoundException('Student not found');
      personData = { id: s.id, name: `${s.firstName} ${s.lastName}`, prefix: 'STU' };
    } else if (dto.teacherId) {
      const t = await this.prisma.teacher.findUnique({ where: { id: dto.teacherId } });
      if (!t) throw new NotFoundException('Teacher not found');
      personData = { id: t.id, name: `${t.firstName} ${t.lastName}`, prefix: 'TCH' };
    }

    const facePersonId = `${personData.prefix}_${personData.id}`;

    const success = await this.hikvisionApi.registerFace(
      device.ipAddress, device.port, device.username, device.password,
      facePersonId, personData.name, dto.faceImage
    );

    if (!success) throw new BadRequestException('Hikvision registration failed');

    const updatePayload = { data: { facePersonId } };
    if (dto.studentId) await this.prisma.student.update({ where: { id: dto.studentId }, ...updatePayload });
    else if (dto.teacherId) await this.prisma.teacher.update({ where: { id: dto.teacherId }, ...updatePayload });

    return { success: true, facePersonId };
  }

  async deleteFace(deviceId: string, facePersonId: string) {
    const device = await this.findOne(deviceId);
    const success = await this.hikvisionApi.deleteFace(
      device.ipAddress, device.port, device.username, device.password, facePersonId
    );
    return { success };
  }

  // ────────────────────────────────────────────────────────
  // WEBHOOK HANDLER
  // ────────────────────────────────────────────────────────

  async handleFaceRecognitionEvent(event: any) {
    const facePersonId = event.employeeNo || event.personId;
    if (!facePersonId) return { success: false, message: 'No face ID found' };

    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // 1. Shaxs turini aniqlash va mos handlerga yuborish
    if (facePersonId.startsWith('STU_')) {
      const student = await this.prisma.student.findUnique({ where: { facePersonId } });
      if (student) return this.processStudentAttendance(student, today, now);
    } 
    
    if (facePersonId.startsWith('TCH_')) {
      const teacher = await this.prisma.teacher.findUnique({ where: { facePersonId } });
      if (teacher) return this.processTeacherAttendance(teacher, today, now);
    }

    return { success: false, message: 'Person not recognized' };
  }

  private async processStudentAttendance(student: any, today: Date, now: Date) {
    const isLate = now.getHours() > 8 || (now.getHours() === 8 && now.getMinutes() > 15);
    const lateMinutes = isLate ? (now.getHours() - 8) * 60 + (now.getMinutes() - 0) : 0;

    await this.saveGeneralAttendance(student.schoolId, 'studentId', student.id, today, now, isLate, lateMinutes);
    return { success: true, type: 'STUDENT' };
  }

  private async processTeacherAttendance(teacher: any, today: Date, now: Date) {
    // Payroll uchun TeacherAttendance holatini tekshirish
    const lastAt = await this.prisma.teacherAttendance.findUnique({
      where: { teacherId_date: { teacherId: teacher.id, date: today } }
    });

    // TypeScript xatosi tuzatildi:
    const checkType = !lastAt || !lastAt.checkInTime ? 'IN' : 'OUT';
    
    // 1. Payroll mantiqi
    await this.payrollService.processAttendance(teacher.id, checkType, now);
    
    // 2. Umumiy davomat (Attendance modeli)
    await this.saveGeneralAttendance(teacher.schoolId, 'teacherId', teacher.id, today, now);
    
    return { success: true, type: 'TEACHER', checkType };
  }

  private async processDirectorAttendance(director: any, today: Date, now: Date) {
    await this.saveGeneralAttendance(director.schoolId, 'directorId', director.id, today, now);
    return { success: true, type: 'DIRECTOR' };
  }

  // Umumiy Attendance jadvali uchun yordamchi metod
  private async saveGeneralAttendance(
    schoolId: string, 
    personKey: string, 
    personId: string, 
    date: Date, 
    timestamp: Date,
    isLate: boolean = false,
    lateMinutes: number = 0
  ) {
    return this.prisma.attendance.upsert({
      where: { 
        [`${personKey}_date`]: { [personKey]: personId, date } 
      } as any,
      update: { 
        checkOutTime: timestamp 
      },
      create: {
        schoolId,
        [personKey]: personId,
        date,
        status: isLate ? AttendanceStatus.LATE : AttendanceStatus.PRESENT,
        checkInTime: timestamp,
        lateMinutes: isLate ? lateMinutes : 0,
      } as any
    });
  }
}