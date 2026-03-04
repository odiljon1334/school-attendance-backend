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
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { PaymentsService } from './payments.service';
import {
  CreatePaymentDto,
  UpdatePaymentDto,
  PaymentReportDto,
  WaivePaymentDto,
} from './dto/payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { BillingPlan, PaymentStatus, UserRole } from '@prisma/client';

@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN, UserRole.DIRECTOR)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createPaymentDto: CreatePaymentDto) {
    return this.paymentsService.create(createPaymentDto);
  }

  @Get()
  async findAll(
    @Query('schoolId') schoolId?: string,
    @Query('studentId') studentId?: string,
    @Query('classId') classId?: string,
    @Query('status') status?: PaymentStatus,
    @Query('plan') plan?: BillingPlan,
    @Query('periodKey') periodKey?: string,
  ) {
    return this.paymentsService.findAll({ schoolId, studentId, classId, status, plan, periodKey });
  }

  @Get('unpaid/:schoolId')
  getUnpaidStudents(@Param('schoolId') schoolId: string) {
    return this.paymentsService.getUnpaidStudents(schoolId);
  }

  @Post('report/json')
  generateReport(@Body() reportDto: PaymentReportDto) {
    return this.paymentsService.generateReport(reportDto);
  }

  @Post('report')
  async reportXlsx(
    @Body() dto: { schoolId: string; startDate?: string; endDate?: string },
    @Res() res: Response,
  ) {
    const buffer = await this.paymentsService.buildExcelReport(dto);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="payments_${Date.now()}.xlsx"`);

    return res.send(Buffer.from(buffer as any));
  }

  @Get(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.PARENT,
  )
  findOne(@Param('id') id: string) {
    return this.paymentsService.findOne(id);
  }

  @Post(':id/mark-paid')
  markAsPaid(@Param('id') id: string) {
    return this.paymentsService.markAsPaid(id);
  }

  @Post(':id/waive')
  waive(@Param('id') id: string, @Body() dto: WaivePaymentDto) {
    return this.paymentsService.waive(id, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updatePaymentDto: UpdatePaymentDto) {
    return this.paymentsService.update(id, updatePaymentDto);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string) {
    return this.paymentsService.remove(id);
  }
}