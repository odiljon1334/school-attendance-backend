import {
  Controller,
  Post,
  Get,
  UseInterceptors,
  UploadedFile,
  Body,
  UseGuards,
  BadRequestException,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
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

  @Get('template/students')
  @UseGuards(JwtAuthGuard)
  downloadStudentTemplate(@Res() res: Response) {
    const csv =
      'Класс,Фамилия,Имя,Отчество,Телефон,Пол\n' +
      '9-A,Иванов,Иван,Иванович,+996700123456,мальчик\n' +
      '9-A,Иванова,Мария,,+996700654321,девочка\n';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="students_template.csv"');
    res.send('\uFEFF' + csv); // BOM for Excel UTF-8
  }

  @Get('template/teachers')
  @UseGuards(JwtAuthGuard)
  downloadTeacherTemplate(@Res() res: Response) {
    const csv =
      'Фамилия,Имя,Отчество,Телефон,Пол,employeeNo\n' +
      'Иванов,Иван,Иванович,+996700123456,мальчик,\n' +
      'Иванова,Мария,,+996700654321,девочка,\n';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="teachers_template.csv"');
    res.send('\uFEFF' + csv); // BOM for Excel UTF-8
  }
}