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
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import {
  CheckInDto,
  CheckOutDto,
  CreateAttendanceDto,
  UpdateAttendanceDto,
  CreateAbsenceRecordDto,
  AttendanceReportDto,
} from './dto/attendance.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  // Check-in endpoint (for devices or manual entry)
  @Post('check-in')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
  )
  @HttpCode(HttpStatus.CREATED)
  checkIn(@Body() checkInDto: CheckInDto) {
    return this.attendanceService.checkIn(checkInDto);
  }

  // Check-out endpoint
  @Post('check-out')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
  )
  @HttpCode(HttpStatus.OK)
  checkOut(@Body() checkOutDto: CheckOutDto) {
    return this.attendanceService.checkOut(checkOutDto);
  }

  // Manual attendance entry
  @Post()
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

  // Get all attendance logs with filters
  @Get()
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
    @Query('classId') classId?: string,
  ) {
    return this.attendanceService.findAll(schoolId, date, studentId, classId);
  }

  // Get today's attendance for a school
  @Get('today/:schoolId')
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

  // Generate attendance report
  @Post('report')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  generateReport(@Body() reportDto: AttendanceReportDto) {
    return this.attendanceService.generateReport(reportDto);
  }

  // Get single attendance log
  @Get(':id')
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

  // Update attendance log
  @Patch(':id')
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

  // Delete attendance log
  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN, UserRole.DIRECTOR)
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string) {
    return this.attendanceService.remove(id);
  }

  // Absence Records
  @Post('absence')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
  )
  @HttpCode(HttpStatus.CREATED)
  createAbsenceRecord(@Body() createAbsenceDto: CreateAbsenceRecordDto) {
    return this.attendanceService.createAbsenceRecord(createAbsenceDto);
  }

  @Get('absence/records')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
    UserRole.PARENT,
  )
  getAbsenceRecords(
    @Query('studentId') studentId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.attendanceService.getAbsenceRecords(
      studentId,
      startDate,
      endDate,
    );
  }
}
