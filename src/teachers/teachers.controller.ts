import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { TeachersService } from './teachers.service';
import { CreateTeacherDto, UpdateTeacherDto } from './dto/teacher.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('teachers')
export class TeachersController {
  constructor(private readonly teachersService: TeachersService) {}

  // ==========================================
  // ✅ CREATE TEACHER
  // ==========================================
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createTeacherDto: CreateTeacherDto) {
    return this.teachersService.create(createTeacherDto);
  }

  // ==========================================
  // ✅ SYNC PHOTOS TO TURNSTILE
  // ==========================================
  @Post('sync-photos/:schoolId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN)
  @HttpCode(HttpStatus.OK)
  syncPhotosToTurnstile(@Param('schoolId') schoolId: string) {
    return this.teachersService.syncPhotosToTurnstile(schoolId);
  }

  // ==========================================
  // ✅ GET ALL TEACHERS (with type filter)
  // ==========================================
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
    @Query('type') type?: 'TEACHER' | 'DIRECTOR',
  ) {
    const user = (req as any).user;
    const restrictedRoles = [UserRole.SCHOOL_ADMIN, UserRole.DIRECTOR, UserRole.TEACHER];
    if (user?.role && restrictedRoles.includes(user.role)) {
      schoolId = user.schoolId;
    }
    return this.teachersService.findAll(schoolId, type);
  }

  // ==========================================
  // ✅ GET DIRECTORS ONLY
  // ==========================================
  @Get('directors')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
  )
  findDirectors(@Query('schoolId') schoolId?: string) {
    return this.teachersService.findDirectors(schoolId);
  }

  // ==========================================
  // ✅ GET TEACHERS ONLY
  // ==========================================
  @Get('teachers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  findTeachers(@Query('schoolId') schoolId?: string) {
    return this.teachersService.findTeachers(schoolId);
  }

  // ==========================================
  // ✅ SET AS DIRECTOR (SuperAdmin only)
  // ==========================================
  @Patch(':id/set-director')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  setAsDirector(@Param('id') id: string) {
    return this.teachersService.setAsDirector(id);
  }

  // ==========================================
  // ✅ SET AS TEACHER (SuperAdmin only)
  // ==========================================
  @Patch(':id/set-teacher')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  setAsTeacher(@Param('id') id: string) {
    return this.teachersService.setAsTeacher(id);
  }

  // ==========================================
  // ✅ GET ONE TEACHER
  // ==========================================
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
    return this.teachersService.findOne(id);
  }

  // ==========================================
  // ✅ GET ATTENDANCE STATS
  // ==========================================
  @Get(':id/attendance-stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
  )
  getAttendanceStats(
    @Param('id') id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.teachersService.getAttendanceStats(
      id,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  // ==========================================
  // ✅ GET PROFILE BY PHONE
  // ==========================================
  @Get('profile/phone/:phone')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
  )
  getProfileByPhone(@Param('phone') phone: string) {
    return this.teachersService.getProfileByPhone(phone);
  }

  // ==========================================
  // ✅ GET PROFILE BY FACE ID
  // ==========================================
  @Get('profile/face/:facePersonId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  getProfileByFaceId(@Param('facePersonId') facePersonId: string) {
    return this.teachersService.getProfileByFaceId(facePersonId);
  }

  // ==========================================
  // ✅ UPDATE TEACHER
  // ==========================================
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN, UserRole.DIRECTOR)
  update(@Param('id') id: string, @Body() updateTeacherDto: UpdateTeacherDto) {
    return this.teachersService.update(id, updateTeacherDto);
  }

  // ==========================================
  // ✅ DELETE TEACHER
  // ==========================================
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN)
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string) {
    return this.teachersService.remove(id);
  }
}