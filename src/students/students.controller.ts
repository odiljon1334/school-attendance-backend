import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
  Delete,
  Patch,
} from '@nestjs/common';
import { StudentsService } from './students.service';
import { CreateStudentDto, UpdateStudentDto } from './dto/student.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('students')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createStudentDto: CreateStudentDto) {
    return this.studentsService.create(createStudentDto);
  }

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
    @Query('classId') classId?: string,
  ) {
    return this.studentsService.findAll(schoolId, classId);
  }

  @Get(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
    UserRole.STUDENT,
    UserRole.PARENT,
  )
  findOne(@Param('id') id: string) {
    return this.studentsService.findOne(id);
  }

  @Get(':id/statistics')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
    UserRole.STUDENT,
    UserRole.PARENT,
  )
  getStatistics(@Param('id') id: string) {
    return this.studentsService.getStatistics(id);
  }

  @Get(':id/attendance')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
    UserRole.STUDENT,
    UserRole.PARENT,
  )
  getAttendanceHistory(
    @Param('id') id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.studentsService.getAttendanceHistory(id, startDate, endDate);
  }

  @Get(':id/absences')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
    UserRole.PARENT,
  )
  getAbsenceRecords(@Param('id') id: string) {
    return this.studentsService.getAbsenceRecords(id);
  }

  @Get(':id/payments')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.PARENT,
  )
  getPaymentHistory(@Param('id') id: string) {
    return this.studentsService.getPaymentHistory(id);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
  update(@Param('id') id: string, @Body() updateStudentDto: UpdateStudentDto) {
    return this.studentsService.update(id, updateStudentDto);
  }

  @Delete(':id/remove')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string) {
    console.log('Deleting student with ID:', id);
    return this.studentsService.remove(id);
  }
}
