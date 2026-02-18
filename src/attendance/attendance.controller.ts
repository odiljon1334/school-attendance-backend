// src/attendance/attendance.controller.ts - WITH HIKVISION WEBHOOK

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
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CreateAttendanceDto, UpdateAttendanceDto } from './dto/attendance.dto';

@Controller('attendance')
export class AttendanceController {
  private readonly logger = new Logger(AttendanceController.name);

  constructor(private readonly attendanceService: AttendanceService) {}

  // ==========================================
  // ✅ NEW: HIKVISION WEBHOOK (NO AUTH)
  // ==========================================
  @Post('turnstile/event')
  @HttpCode(HttpStatus.OK)
  async handleTurnstileEvent(@Body() body: any) {
    try {
      this.logger.log('Turnstile event received:', JSON.stringify(body));

      // Parse Hikvision event
      const event = this.parseHikvisionEvent(body);

      if (!event) {
        this.logger.warn('Invalid event format');
        return { success: false, message: 'Invalid event format' };
      }

      // Process attendance with photo
      await this.attendanceService.handleTurnstileEvent(event);

      return { success: true, message: 'Event processed' };
    } catch (error) {
      this.logger.error('Error handling turnstile event:', error);
      return { success: false, message: error.message };
    }
  }

  // ✅ Parse Hikvision event format
  private parseHikvisionEvent(body: any) {
    try {
      // Hikvision sends different formats, handle both:
      
      // Format 1: Standard Hikvision
      if (body.PersonID || body.personId) {
        return {
          personId: body.PersonID || body.personId,
          deviceId: body.DeviceID || body.deviceId || 'UNKNOWN',
          timestamp: body.Time || body.timestamp || new Date().toISOString(),
          eventType: body.EventCode || body.eventType || 'CheckIn',
          capturePhoto: body.CaptureImage || body.capturePhoto || body.captureImage,
        };
      }

      // Format 2: Custom/Alternative
      if (body.facePersonId || body.faceId) {
        return {
          personId: body.facePersonId || body.faceId,
          deviceId: body.deviceId || 'UNKNOWN',
          timestamp: body.timestamp || new Date().toISOString(),
          eventType: body.eventType || 'CheckIn',
          capturePhoto: body.photo || body.image || body.capturePhoto,
        };
      }

      return null;
    } catch (error) {
      this.logger.error('Error parsing event:', error);
      return null;
    }
  }

  // ✅ NEW: TEST ENDPOINT (for development)
  @Post('turnstile/test')
  @HttpCode(HttpStatus.OK)
  async testTurnstileEvent(@Body() body: {
    facePersonId: string;
    deviceId?: string;
    photoBase64?: string;
  }) {
    this.logger.log('Test event received');

    await this.attendanceService.handleTurnstileEvent({
      personId: body.facePersonId,
      deviceId: body.deviceId || 'TEST_DEVICE',
      timestamp: new Date().toISOString(),
      eventType: 'CheckIn',
      capturePhoto: body.photoBase64,
    });

    return { success: true, message: 'Test event processed' };
  }

  // ==========================================
  // EXISTING ENDPOINTS (WITH AUTH)
  // ==========================================
  
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
  )
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
    @Query('schoolId') schoolId?: string,
    @Query('date') date?: string,
    @Query('studentId') studentId?: string,
    @Query('teacherId') teacherId?: string,
    @Query('classId') classId?: string,
  ) {
    return this.attendanceService.findAll(schoolId, date, studentId, classId);
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
  getTodayAttendance(
    @Param('schoolId') schoolId: string,
    @Query('classId') classId?: string,
  ) {
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
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
  )
  update(
    @Param('id') id: string,
    @Body() updateAttendanceDto: UpdateAttendanceDto,
  ) {
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