import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CsvImportService } from './csv-import.service';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('csv-import')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CsvImportController {
  constructor(private readonly csvImportService: CsvImportService) {}

  @Post('teachers')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async importTeachers(
    @UploadedFile() file: Express.Multer.File,
    @Body('schoolId') schoolId: string,
  ) {
    if (!file) throw new BadRequestException('File is required');
    if (!schoolId) throw new BadRequestException('School ID is required');

    const validation = this.csvImportService.validateTeacherCSV(file);
    if (!validation.valid) {
      throw new BadRequestException({
        message: 'CSV format xato',
        errors: validation.errors,
      });
    }

    const result = await this.csvImportService.importTeachers(file, schoolId);
    return { message: 'Import completed', ...result };
  }

  @Post('students')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async importStudents(
    @UploadedFile() file: Express.Multer.File,
    @Body('schoolId') schoolId: string,
  ) {
    if (!file) throw new BadRequestException('File is required');
    if (!schoolId) throw new BadRequestException('School ID is required');

    const validation = this.csvImportService.validateStudentCSV(file);
    if (!validation.valid) {
      throw new BadRequestException({
        message: 'CSV format xato',
        errors: validation.errors,
      });
    }

    const result = await this.csvImportService.importStudents(file, schoolId);
    return { message: 'Import completed', ...result };
  }

  @Post('validate/teachers')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async validateTeachers(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File is required');
    return this.csvImportService.validateTeacherCSV(file);
  }

  @Post('validate/students')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async validateStudents(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File is required');
    return this.csvImportService.validateStudentCSV(file);
  }
}