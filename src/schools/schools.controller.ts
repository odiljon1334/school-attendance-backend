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
  findAll(@Query('districtId') districtId?: string) {
    return this.schoolsService.findAll(districtId);
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

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN)
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string) {
    return this.schoolsService.remove(id);
  }
}