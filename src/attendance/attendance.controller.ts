import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
  Logger,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CreateAttendanceDto, UpdateAttendanceDto } from './dto/attendance.dto';

type TurnstileTestDto = {
  personId: string;
  deviceId?: string;
  photoBase64?: string;
  timestamp?: string;
  eventType?: string;
};

@Controller('attendance')
export class AttendanceController {
  private readonly logger = new Logger(AttendanceController.name);

  constructor(private readonly attendanceService: AttendanceService) {}

  // ==========================================
  // ✅ REPORT (Frontend ishlatadi)
  // ==========================================
  @Post('report')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
  )
  generateReport(
    @Body()
    dto: {
      schoolId: string;
      startDate?: string;
      endDate?: string;
      classId?: string;
      studentId?: string;
      teacherId?: string;
    },
  ) {
    return this.attendanceService.generateReport(dto);
  }

  // ==========================================
  // ✅ TURNSTILE TEST (DEV/QA uchun)
  // ==========================================
  @Post('turnstile/test')
  @HttpCode(HttpStatus.OK)
  async testTurnstileEvent(@Body() body: TurnstileTestDto) {
    if (!body?.personId) throw new BadRequestException('personId is required');

    this.logger.log(`Turnstile TEST event: ${body.personId}`);

    await this.attendanceService.handleTurnstileEvent({
      personId: body.personId,
      deviceId: body.deviceId || 'TEST_DEVICE',
      timestamp: body.timestamp || new Date().toISOString(),
      eventType: body.eventType || 'FACE_RECOGNITION',
      capturePhoto: body.photoBase64,
    });

    return { success: true, message: 'Test event processed' };
  }

  // ==========================================
  // ✅ TODAY STATS (Frontend ishlatadi)
  // ==========================================
  @Get('stats/today/:schoolId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
  )
  getTodayStats(@Param('schoolId') schoolId: string) {
    return this.attendanceService.getTodayStats(schoolId);
  }

  // ==========================================
  // ✅ DATE STATS — haftalik/kunlik grafik uchun
  // GET /attendance/stats/date/:schoolId?date=YYYY-MM-DD
  // ==========================================
  @Get('stats/date/:schoolId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
  )
  getStatsByDate(
    @Param('schoolId') schoolId: string,
    @Query('date') date: string,
  ) {
    if (!date) throw new BadRequestException('date query param required (YYYY-MM-DD)');
    return this.attendanceService.getStatsByDate(schoolId, date);
  }

  // ==========================================
  // ✅ TOP STUDENTS (Frontend ishlatadi)
  // ==========================================
  @Get('top-students/:schoolId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
  )
  getTopStudents(@Param('schoolId') schoolId: string, @Query('limit') limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : 10;
    return this.attendanceService.getTopStudents(schoolId, parsedLimit);
  }

  // ==========================================
  // ✅ CRUD (Frontend attendance yuboradi)
  // ==========================================
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN, UserRole.DIRECTOR, UserRole.TEACHER)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createAttendanceDto: CreateAttendanceDto) {
    return this.attendanceService.create(createAttendanceDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
  )
  findAll(
    @Req() req: Request,
    @Query('schoolId') schoolId?: string,
    @Query('date') date?: string,
    @Query('studentId') studentId?: string,
    @Query('teacherId') teacherId?: string,
    @Query('classId') classId?: string,
  ) {
    const user = (req as any).user;
    const restrictedRoles = [UserRole.SCHOOL_ADMIN, UserRole.DIRECTOR, UserRole.TEACHER];
    const isRestricted = (user?.role && restrictedRoles.includes(user.role)) || (!user?.role && user?.schoolId);
    if (isRestricted) schoolId = user.schoolId;
    return this.attendanceService.findAll(schoolId, date, studentId, teacherId, classId);
  }

  @Get('today/:schoolId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
  )
  getTodayAttendance(@Param('schoolId') schoolId: string, @Query('classId') classId?: string) {
    return this.attendanceService.getTodayAttendance(schoolId, classId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
  )
  findOne(@Param('id') id: string) {
    return this.attendanceService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN, UserRole.DIRECTOR, UserRole.TEACHER)
  update(@Param('id') id: string, @Body() updateAttendanceDto: UpdateAttendanceDto) {
    return this.attendanceService.update(id, updateAttendanceDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN, UserRole.DIRECTOR)
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string) {
    return this.attendanceService.remove(id);
  }
}