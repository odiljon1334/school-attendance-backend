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
  Req,
  Res,
  NotFoundException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { StudentsService } from './students.service';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CreateStudentDto, UpdateStudentDto } from './dto/student.dto';

@Controller('students')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Post()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
  )
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createStudentDto: CreateStudentDto) {
    return this.studentsService.create(createStudentDto);
  }

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.MINISTRY,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
  )
  findAll(
    @Req() req: Request,
    @Query('schoolId') schoolId?: string,
    @Query('classId') classId?: string,
  ) {
    const user = (req as any).user;
    const restrictedRoles = [UserRole.SCHOOL_ADMIN, UserRole.DIRECTOR, UserRole.TEACHER];
    const isRestricted = (user?.role && restrictedRoles.includes(user.role)) || (!user?.role && user?.schoolId);
    if (isRestricted) schoolId = user.schoolId;
    return this.studentsService.findAll(schoolId, classId);
  }

  // ✅ Dedicated photo endpoint — binary JPEG, browser cache 1 kun
  // List API da base64 yubormaymiz, frontend bu endpoint orqali lazy load qiladi
  @Get(':id/photo')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.MINISTRY,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
    UserRole.PARENT,
  )
  async getPhoto(@Param('id') id: string, @Res() res: Response) {
    const student = await this.studentsService.getPhotoById(id);
    if (!student?.photo) throw new NotFoundException('Photo not found');

    const raw = student.photo.startsWith('data:')
      ? student.photo.split(',')[1]
      : student.photo;

    const buffer = Buffer.from(raw, 'base64');
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=86400', // 1 kun browser cache
      'ETag': `"${id}"`,
    });
    res.send(buffer);
  }

  @Get('photo-status')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  getPhotoStatus(@Query('schoolId') schoolId: string) {
    return this.studentsService.getPhotoStatus(schoolId);
  }

  @Get(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.MINISTRY,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
    UserRole.PARENT,
  )
  findOne(@Param('id') id: string) {
    return this.studentsService.findOne(id);
  }

  @Get(':id/attendance')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.MINISTRY,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
    UserRole.PARENT,
  )
  getAttendanceStats(
    @Param('id') id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.studentsService.getAttendanceStats(
      id,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Patch(':id/transfer')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  transfer(
    @Param('id') id: string,
    @Body() dto: { classId: string; schoolId?: string },
  ) {
    return this.studentsService.transferStudent(id, dto.classId, dto.schoolId);
  }

  @Patch(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
  )
  update(@Param('id') id: string, @Body() updateStudentDto: UpdateStudentDto) {
    return this.studentsService.update(id, updateStudentDto);
  }

  @Delete('school/:schoolId/all')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN)
  @HttpCode(HttpStatus.OK)
  removeAllBySchool(@Param('schoolId') schoolId: string) {
    return this.studentsService.removeAllBySchool(schoolId);
  }

  @Delete(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
  )
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string) {
    return this.studentsService.remove(id);
  }
}