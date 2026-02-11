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
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CreateAttendanceDto, UpdateAttendanceDto } from './dto/attendance.dto';

@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  // Manual attendance
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

  // Get all with filters
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
    @Query('teacherId') teacherId?: string,
    @Query('classId') classId?: string,
  ) {
    return this.attendanceService.findAll(schoolId, date, studentId, classId);
  }

  // Today's attendance for school
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

  // Get single record
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

  // Update attendance
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

  // Delete attendance
  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN, UserRole.DIRECTOR)
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string) {
    return this.attendanceService.remove(id);
  }
}