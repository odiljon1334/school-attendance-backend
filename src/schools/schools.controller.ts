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
  ForbiddenException,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { SchoolsService } from './schools.service';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CreateSchoolDto, UpdateSchoolDto } from './dto/school.dto';

@Controller('schools')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SchoolsController {
  constructor(private readonly schoolsService: SchoolsService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createSchoolDto: CreateSchoolDto) {
    return this.schoolsService.create(createSchoolDto);
  }

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
  )
  findAll(@Req() req: Request, @Query('districtId') districtId?: string) {
    const user = (req as any).user;
    const restrictedRoles = [UserRole.SCHOOL_ADMIN, UserRole.DIRECTOR, UserRole.TEACHER];
    const isRestricted = (user?.role && restrictedRoles.includes(user.role)) || (!user?.role && user?.schoolId);
    if (isRestricted) return this.schoolsService.findAll(undefined, user.schoolId);
    return this.schoolsService.findAll(districtId);
  }

  @Get('bulk-statistics')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  getBulkStatistics(@Req() req: Request, @Query('districtId') districtId: string) {
    const user = (req as any).user;
    const restrictedRoles = [UserRole.SCHOOL_ADMIN, UserRole.DIRECTOR, UserRole.TEACHER];
    const isRestricted = (user?.role && restrictedRoles.includes(user.role)) || (!user?.role && user?.schoolId);
    if (isRestricted) return this.schoolsService.getBulkStatistics(undefined, user.schoolId);
    return this.schoolsService.getBulkStatistics(districtId);
  }

  @Get(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  findOne(@Param('id') id: string) {
    return this.schoolsService.findOne(id);
  }

  @Get(':id/statistics')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  getStatistics(@Param('id') id: string) {
    return this.schoolsService.getStatistics(id);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
  update(@Param('id') id: string, @Body() updateSchoolDto: UpdateSchoolDto) {
    return this.schoolsService.update(id, updateSchoolDto);
  }

  // ✅ Faqat SUPER_ADMIN: login va parol almashtirish
  @Patch(':id/credentials')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  updateCredentials(
    @Param('id') id: string,
    @Body('username') username: string,
    @Body('password') password: string,
  ) {
    return this.schoolsService.updateCredentials(id, username, password);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN)
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string) {
    return this.schoolsService.remove(id);
  }
}